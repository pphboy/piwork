package coreapp

import (
	"context"
	"database/sql"
	"errors"
	"math"
	"sync"
	"time"

	"piwork/internal/agentclient"
	"piwork/internal/contracts"
	"piwork/internal/diagnostics"
	"piwork/internal/dockerengine"
	"piwork/internal/preparationcache"
)

const preparationAttemptTimeout = 10 * time.Minute

var preparationNames = [...]string{"docker", "agent", "packageHelper", "defaultContext", "fileHelper", "snapshotHelper"}
var preparationSchedule = [...]string{"docker", "agent", "fileHelper", "snapshotHelper", "packageHelper", "defaultContext"}

type PreparationComponent = contracts.PreparationComponent
type Preparation = contracts.Preparation

type preparationEntry struct {
	PreparationComponent
	retryAt time.Time
}

type preparationRequest struct {
	generation                uint64
	defaultRevision           int64
	profile                   RuntimeProfile
	configured, administrator bool
	recoverable               bool
}

type imagePreparationKey struct {
	revision  int64
	reference string
	engine    uint64
}

// State and admission use Application.mu. The coordinator is the sole owner
// of active jobs; neither readers nor a configuration request wait for them.
type runtimePreparation struct {
	app         *Application
	entries     map[string]preparationEntry
	request     preparationRequest
	wake        chan struct{}
	changed     chan struct{}
	started     bool
	invalidated bool
	cancel      context.CancelFunc
	images      *preparationcache.Cache[imagePreparationKey, dockerengine.PreparedImage]
	// Recovery is owned by the Core lifetime, not a default-config generation.
	recoveryStarted  bool
	recoveryReady    bool
	recoveryFailed   bool
	recoveryWake     chan struct{}
	recoveryFull     bool
	recoveryTargets  map[string]struct{}
	recoveryCancel   context.CancelFunc
	packageStarted   bool
	packageWake      chan struct{}
	packageCancel    context.CancelFunc
	engineEpoch      uint64
	engineOnline     bool
	engineScope      string
	engineGeneration uint64
	engineContext    context.Context
	engineCancel     context.CancelFunc
	// Test seams replace external effects, not the scheduler or public state.
	executeForTest              func(context.Context, string, RuntimeProfile) error
	pullForTest                 func(context.Context, string) (dockerengine.PreparedImage, error)
	probeForTest                func(context.Context) error
	identityForTest             func(context.Context) (string, uint64, error)
	recoveryForTest             func(context.Context) error
	recoveryTargetsForTest      func(context.Context, []string) error
	packageRecoveryForTest      func(context.Context) error
	retryDelay                  func(int) time.Duration
	attemptTimeout              time.Duration
	probeInterval, probeTimeout time.Duration
}

func newRuntimePreparation(app *Application) *runtimePreparation {
	lifecycle := app.ctx
	if lifecycle == nil {
		lifecycle = context.Background()
	}
	p := &runtimePreparation{app: app, entries: map[string]preparationEntry{}, wake: make(chan struct{}, 1), recoveryWake: make(chan struct{}, 1), recoveryTargets: make(map[string]struct{}), packageWake: make(chan struct{}, 1), changed: make(chan struct{}), images: preparationcache.New[imagePreparationKey](lifecycle, preparationcache.Options[dockerengine.PreparedImage]{Clone: clonePreparedImage}), retryDelay: preparationRetryDelay, attemptTimeout: preparationAttemptTimeout, probeInterval: 2 * time.Second, probeTimeout: 3 * time.Second}
	for _, name := range preparationNames {
		p.entries[name] = preparationEntry{PreparationComponent: PreparationComponent{State: "unconfigured", Code: preparationCode("RUNTIME_UNCONFIGURED")}}
	}
	return p
}

func preparationCode(code string) *string { return &code }

func preparationRetryDelay(failures int) time.Duration {
	delays := [...]time.Duration{time.Second, 5 * time.Second, 15 * time.Second, 30 * time.Second, time.Minute}
	if failures < 1 {
		failures = 1
	}
	if failures > len(delays) {
		failures = len(delays)
	}
	return delays[failures-1]
}

func preparationFailure(name string, err error) (state, code string) {
	if errors.Is(err, dockerengine.ErrImageReference) || errors.Is(err, dockerengine.ErrSpecification) || errors.Is(err, dockerengine.ErrImageIncompatible) || errors.Is(err, dockerengine.ErrAPIVersion) {
		return "failed", "IMAGE_INCOMPATIBLE"
	}
	if name == "docker" {
		return "retrying", "DOCKER_UNAVAILABLE"
	}
	if name == "defaultContext" {
		return "retrying", "CONTEXT_PREPARATION_FAILED"
	}
	return "retrying", "IMAGE_UNAVAILABLE"
}

func (p *runtimePreparation) notifyLocked() {
	close(p.changed)
	p.changed = make(chan struct{})
}

// The default-creation environment and the recovered Work inventory are
// independent prerequisites of the aggregate base readiness state.
func (p *runtimePreparation) updateBaseStateLocked() {
	if p.app.closed {
		return
	}
	request := p.request
	state := "RECOVERING"
	switch {
	case !request.administrator:
		state = "ADMIN_REQUIRED"
	case !request.configured:
		state = "RUNTIME_NOT_CONFIGURED"
	case p.invalidated:
		state = "RECOVERING"
	default:
		for _, name := range []string{"docker", "agent", "packageHelper", "defaultContext"} {
			entry := p.entries[name]
			if entry.State == "failed" || entry.State == "retrying" {
				state = "RUNTIME_UNAVAILABLE"
				break
			}
		}
		if p.recoveryFailed {
			state = "RUNTIME_UNAVAILABLE"
		}
		if p.entries["docker"].State == "ready" && p.entries["agent"].State == "ready" && p.entries["packageHelper"].State == "ready" && p.entries["defaultContext"].State == "ready" && p.recoveryReady && !p.recoveryFailed {
			state = "READY"
		}
	}
	p.app.state = state
	p.app.status.Ready = state == "READY"
	p.app.status.Checks.RuntimeAvailable = state == "READY"
}

func (p *runtimePreparation) wakeRecoveryLocked() {
	p.recoveryFull = true
	p.signalRecoveryLocked()
}

func (p *runtimePreparation) signalRecoveryLocked() {
	select {
	case p.recoveryWake <- struct{}{}:
	default:
	}
}

func (a *Application) wakeWorkRecovery(workIDs ...string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if !a.closed && a.preparation != nil && a.preparation.recoveryStarted {
		p := a.preparation
		if len(workIDs) == 0 {
			p.wakeRecoveryLocked()
			return
		}
		for _, id := range workIDs {
			if id != "" {
				p.recoveryTargets[id] = struct{}{}
			}
		}
		p.signalRecoveryLocked()
	}
}

func (p *runtimePreparation) startRecoveryLocked() {
	if p.app.closed {
		return
	}
	if !p.recoveryStarted {
		p.recoveryStarted = true
		p.app.recoveryWG.Add(1)
		go p.recoveryLoop()
	}
	p.wakeRecoveryLocked()
	if p.app.dockerRuntime != nil || p.packageRecoveryForTest != nil {
		if !p.packageStarted {
			p.packageStarted = true
			p.app.recoveryWG.Add(1)
			go p.packageRecoveryLoop()
		}
		select {
		case p.packageWake <- struct{}{}:
		default:
		}
	}
}

// Core package recovery must precede the built-in brain, but cannot depend on
// default configuration: existing Works may be waiting for its cleanup.
func (a *Application) ensureCorePackageRecovery(ctx context.Context) error {
	select {
	case a.packageRecoveryGate <- struct{}{}:
		defer func() { <-a.packageRecoveryGate }()
	case <-ctx.Done():
		return ctx.Err()
	}
	a.mu.Lock()
	p := a.preparation
	epoch, online := p.engineEpoch, p.engineOnline && !a.closed
	a.mu.Unlock()
	if !online {
		return dockerengine.ErrUnavailable
	}
	if a.packagesRecoveredEpoch == epoch {
		return nil
	}
	var err error
	if p.packageRecoveryForTest != nil {
		err = p.packageRecoveryForTest(ctx)
	} else {
		err = a.recoverCorePackageJobs(ctx, "core")
	}
	if err != nil {
		return err
	}
	a.mu.Lock()
	current := ctx.Err() == nil && !a.closed && p.engineOnline && p.engineEpoch == epoch
	a.mu.Unlock()
	if !current {
		return errWorkSuperseded
	}
	a.packagesRecoveredEpoch = epoch
	return nil
}

func (p *runtimePreparation) packageRecoveryLoop() {
	defer p.app.recoveryWG.Done()
	for {
		select {
		case <-p.app.ctx.Done():
			return
		case <-p.packageWake:
		}
		failures := 0
		for {
			p.app.mu.Lock()
			if p.app.closed || !p.engineOnline {
				p.app.mu.Unlock()
				break
			}
			epoch := p.engineEpoch
			attempt, cancel := context.WithTimeout(p.app.ctx, p.attemptTimeout)
			attempt = p.app.startupPerformance(attempt)
			p.packageCancel = cancel
			p.app.mu.Unlock()
			coreDone := make(chan error, 1)
			go func() { coreDone <- p.app.ensureCorePackageRecovery(attempt) }()
			workErr := p.app.recoverWorkPackageJobs(attempt)
			err := errors.Join(<-coreDone, workErr)
			cancel()
			p.app.mu.Lock()
			p.packageCancel = nil
			current := !p.app.closed && p.engineOnline && p.engineEpoch == epoch
			p.app.mu.Unlock()
			if !current || err == nil {
				break
			}
			failures++
			delay := time.NewTimer(p.retryDelay(failures))
			select {
			case <-p.app.ctx.Done():
				delay.Stop()
				return
			case <-p.packageWake:
				delay.Stop()
			case <-delay.C:
			}
		}
	}
}

func (p *runtimePreparation) executeRecovery(ctx context.Context, workIDs []string) error {
	if p.recoveryTargetsForTest != nil {
		return p.recoveryTargetsForTest(ctx, workIDs)
	}
	if p.recoveryForTest != nil {
		return p.recoveryForTest(ctx)
	}
	if p.app.options.Recover != nil {
		return p.app.options.Recover(ctx, p.app)
	}
	if p.app.workRuntime != nil {
		return p.app.recoverCapturedWorks(ctx, workIDs...)
	}
	return p.app.emptyRecovery(ctx)
}

// Only this goroutine performs startup inventories. Config changes never
// cancel it; a lost Engine cancels the active attempt and fences its result.
func (p *runtimePreparation) recoveryLoop() {
	defer p.app.recoveryWG.Done()
	for {
		select {
		case <-p.app.ctx.Done():
			return
		case <-p.recoveryWake:
		}
		p.app.mu.Lock()
		full := p.recoveryFull
		p.recoveryFull = false
		var workIDs []string
		if !full {
			for id := range p.recoveryTargets {
				workIDs = append(workIDs, id)
			}
		}
		clear(p.recoveryTargets)
		p.app.mu.Unlock()
		if !full && len(workIDs) == 0 {
			continue
		}
		failures := 0
		for {
			p.app.mu.Lock()
			if p.app.closed || p.app.ctx.Err() != nil {
				p.app.mu.Unlock()
				return
			}
			if !p.engineOnline {
				p.app.mu.Unlock()
				break
			}
			epoch := p.engineEpoch
			attempt, cancel := context.WithTimeout(p.app.ctx, p.attemptTimeout)
			attempt = p.app.startupPerformance(attempt)
			p.recoveryCancel = cancel
			p.app.mu.Unlock()
			span := diagnostics.BeginPerformance(attempt, "startup-recovery")
			err := p.executeRecovery(attempt, workIDs)
			if err == nil {
				err = attempt.Err()
			}
			span.End(err)
			cancel()
			p.app.mu.Lock()
			p.recoveryCancel = nil
			current := !p.app.closed && p.app.ctx.Err() == nil && p.engineEpoch == epoch && p.engineOnline
			if current {
				if full {
					p.recoveryReady = err == nil
					p.recoveryFailed = err != nil
				} else if err != nil {
					p.recoveryFailed = true
					p.wakeRecoveryLocked()
				}
				if err == nil && p.app.workRuntime != nil {
					p.app.recoveryOnce.Do(func() { p.app.recoveryWG.Add(1); go p.app.runtimeRecoveryLoop() })
				}
				p.updateBaseStateLocked()
				p.notifyLocked()
			}
			p.app.mu.Unlock()
			if !current {
				break
			}
			if err == nil {
				break
			}
			failures++
			delay := time.NewTimer(p.retryDelay(failures))
			select {
			case <-p.app.ctx.Done():
				delay.Stop()
				return
			case <-delay.C:
			}
		}
	}
}

func (a *Application) Preparation() Preparation {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.preparationLocked()
}

func (a *Application) preparationLocked() Preparation {
	result := Preparation{Version: 1, Ready: !a.closed, Components: map[string]PreparationComponent{}}
	for _, name := range preparationNames {
		entry := a.preparation.entries[name]
		component := entry.PreparationComponent
		if !entry.retryAt.IsZero() && component.State == "retrying" {
			delay := int(math.Max(0, math.Ceil(time.Until(entry.retryAt).Seconds())))
			component.RetryAfterSeconds = &delay
		}
		if a.closed {
			component.State, component.Code, component.RetryAfterSeconds = "failed", preparationCode("SHUTTING_DOWN"), nil
		}
		result.Components[name] = component
		result.Ready = result.Ready && component.State == "ready"
	}
	return result
}

// Invalidate at the runtime publication boundary, before a new persistent
// profile can be visible. A result from the old generation cannot publish READY.
func (a *Application) invalidateRuntimePreparation() {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.closed {
		return
	}
	p := a.preparation
	p.request.generation++
	p.invalidated = true
	if p.cancel != nil {
		p.cancel()
	}
	a.state = "RECOVERING"
	a.status.Ready = false
	p.notifyLocked()
}

func (a *Application) ScheduleRuntimeRefresh() error {
	admin, err := a.Identity.HasEnabledAdministrator(a.ctx)
	if err != nil {
		return err
	}
	a.Settings.mu.Lock()
	defer a.Settings.mu.Unlock()
	profile, configured, err := a.Settings.LoadRuntime()
	if err != nil {
		return err
	}
	// Catalog/default synchronization is local, transactional work. It must be
	// committed before config set returns, independently of registry access.
	if admin && configured {
		if err := a.ensureRuntimeCatalog(a.ctx, profile); err != nil {
			return err
		}
		if err := a.Store.SyncDefaultWorkRuntime(a.ctx, profile.Revision, runtimeImageCatalogID(profile.Revision), defaultModelReference(profile), defaultWorkConfiguration(profile)); err != nil {
			return err
		}
	}
	defaults, err := a.Store.DefaultWork(a.ctx)
	if err != nil {
		return err
	}
	var recoverable bool
	if !admin || !configured {
		if err := a.Store.Read(a.ctx, func(tx *sql.Tx) error {
			return tx.QueryRowContext(a.ctx, `SELECT EXISTS(SELECT 1 FROM works WHERE deleted_at IS NULL OR observed_state!='deleted')`).Scan(&recoverable)
		}); err != nil {
			return err
		}
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.closed {
		return context.Canceled
	}
	p := a.preparation
	if profile.Revision < p.request.profile.Revision {
		return nil
	}
	// Repeated in-process observation does not restart a completed or active
	// generation. HTTP status never calls this method at all.
	if p.started && !p.invalidated && defaults.Revision == p.request.defaultRevision && profile.Revision == p.request.profile.Revision && configured == p.request.configured && admin == p.request.administrator && recoverable == p.request.recoverable {
		return nil
	}
	p.request = preparationRequest{generation: p.request.generation + 1, defaultRevision: defaults.Revision, profile: profile, configured: configured, administrator: admin, recoverable: recoverable}
	p.invalidated = false
	if p.cancel != nil {
		p.cancel()
	}
	for _, name := range preparationNames {
		state, code := "pending", (*string)(nil)
		independent := recoverable && (name == "docker" || name == "fileHelper" || name == "snapshotHelper")
		if ((!admin || !configured) && !independent) || name == "fileHelper" && a.options.FileHelperImage == "" || name == "snapshotHelper" && a.options.SnapshotHelperImage == "" {
			state, code = "unconfigured", preparationCode("RUNTIME_UNCONFIGURED")
		}
		p.entries[name] = preparationEntry{PreparationComponent: PreparationComponent{State: state, Code: code}}
	}
	state := "RECOVERING"
	if !admin {
		state = "ADMIN_REQUIRED"
	} else if !configured {
		state = "RUNTIME_NOT_CONFIGURED"
	}
	a.state = state
	a.status = Status{State: state}
	a.status.Checks.Administrator, a.status.Checks.RuntimeConfigured, a.status.Checks.FilesystemMigrationReady = admin, configured, true
	p.notifyLocked()
	if !p.started {
		p.started = true
		a.refreshWG.Add(1)
		go p.loop()
	}
	select {
	case p.wake <- struct{}{}:
	default:
	}
	return nil
}

func (p *runtimePreparation) loop() {
	defer p.app.refreshWG.Done()
	var done chan struct{}
	for {
		select {
		case <-p.app.ctx.Done():
			p.app.mu.Lock()
			if p.cancel != nil {
				p.cancel()
			}
			p.app.mu.Unlock()
			if done != nil {
				<-done
			}
			return
		case <-p.wake:
		}
		p.app.mu.Lock()
		if p.cancel != nil {
			p.cancel()
		}
		p.app.mu.Unlock()
		if done != nil {
			<-done
		}
		p.app.mu.Lock()
		if p.app.closed {
			p.app.mu.Unlock()
			return
		}
		for len(p.wake) > 0 {
			<-p.wake
		}
		request := p.request
		ctx, cancel := context.WithCancel(p.app.ctx)
		ctx = p.app.startupPerformance(ctx)
		ctx = context.WithValue(ctx, preparationGenerationKey{}, request.generation)
		ctx = context.WithValue(ctx, preparationRevisionKey{}, request.profile.Revision)
		ctx = context.WithValue(ctx, preparationDefaultKey{}, request.defaultRevision)
		p.cancel = cancel
		done = make(chan struct{})
		p.app.mu.Unlock()
		go func(done chan struct{}) { defer close(done); p.run(ctx, request) }(done)
	}
}

type preparationGenerationKey struct{}
type preparationRevisionKey struct{}
type preparationDefaultKey struct{}
type preparationEngineKey struct{}

func (p *runtimePreparation) currentLocked(ctx context.Context) bool {
	generation, _ := ctx.Value(preparationGenerationKey{}).(uint64)
	epoch, scoped := ctx.Value(preparationEngineKey{}).(uint64)
	return !p.app.closed && ctx.Err() == nil && (generation == 0 || generation == p.request.generation) && (!scoped || p.engineOnline && epoch == p.engineEpoch)
}

type preparationResult struct {
	name        string
	err         error
	scope       string
	generation  uint64
	engineEpoch uint64
}
type preparationJob struct {
	active   bool
	failures int
}

func (p *runtimePreparation) run(ctx context.Context, request preparationRequest) {
	if (!request.administrator || !request.configured) && !request.recoverable {
		return
	}
	jobs := map[string]*preparationJob{}
	for _, name := range preparationNames {
		jobs[name] = &preparationJob{}
	}
	results := make(chan preparationResult, len(preparationNames)+1)
	var workers sync.WaitGroup
	defer workers.Wait()
	timer := time.NewTicker(100 * time.Millisecond)
	defer timer.Stop()
	probe := time.NewTicker(p.probeInterval)
	defer probe.Stop()
	active, probing := 0, false
	for {
		p.app.mu.Lock()
		if !p.currentLocked(ctx) {
			p.app.mu.Unlock()
			return
		}
		for _, name := range preparationSchedule {
			entry, job := p.entries[name], jobs[name]
			if active >= 3 || job.active || entry.State != "pending" && entry.State != "retrying" || time.Now().Before(entry.retryAt) {
				continue
			}
			if name != "docker" && p.entries["docker"].State != "ready" {
				continue
			}
			if name == "defaultContext" && (p.entries["agent"].State != "ready" || p.entries["packageHelper"].State != "ready") {
				continue
			}
			entry.State, entry.Code, entry.RetryAfterSeconds, entry.retryAt = "preparing", nil, nil, time.Time{}
			entry.Attempt++
			p.entries[name] = entry
			job.active, active = true, active+1
			workers.Add(1)
			epoch, engineCtx := p.engineEpoch, p.engineContext
			go func(name string, epoch uint64, engineCtx context.Context) {
				defer workers.Done()
				budget := p.attemptTimeout
				if name == "docker" {
					budget = p.probeTimeout
				}
				attempt, cancel := context.WithTimeout(ctx, budget)
				if name != "docker" {
					attempt = context.WithValue(attempt, preparationEngineKey{}, epoch)
					if engineCtx != nil {
						stop := context.AfterFunc(engineCtx, cancel)
						defer stop()
					}
				}
				phase := map[string]string{"docker": "startup-docker", "agent": "startup-agent", "packageHelper": "startup-package-helper", "defaultContext": "startup-default-context", "fileHelper": "startup-file-helper", "snapshotHelper": "startup-snapshot-helper"}[name]
				span := diagnostics.BeginPerformance(attempt, phase)
				err := p.execute(attempt, name, request.profile)
				var scope string
				var generation uint64
				if name == "docker" && err == nil {
					scope, generation, err = p.observeEngineIdentity(attempt)
				}
				span.End(err)
				cancel()
				select {
				case results <- preparationResult{name: name, err: err, scope: scope, generation: generation, engineEpoch: epoch}:
				case <-ctx.Done():
				}
			}(name, epoch, engineCtx)
		}
		p.notifyLocked()
		p.app.mu.Unlock()
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		case <-probe.C:
			p.app.mu.Lock()
			available := p.entries["docker"].State == "ready" && p.currentLocked(ctx)
			p.app.mu.Unlock()
			if available && !probing {
				probing = true
				workers.Add(1)
				go func() {
					defer workers.Done()
					check, cancel := context.WithTimeout(ctx, p.probeTimeout)
					err := p.probeEngine(check, request.profile)
					var scope string
					var generation uint64
					if err == nil {
						scope, generation, err = p.observeEngineIdentity(check)
					}
					cancel()
					select {
					case results <- preparationResult{name: "heartbeat", err: err, scope: scope, generation: generation}:
					case <-ctx.Done():
					}
				}()
			}
		case result := <-results:
			p.app.mu.Lock()
			if !p.currentLocked(ctx) {
				p.app.mu.Unlock()
				return
			}
			var revoked []*agentclient.Client
			if result.name == "heartbeat" {
				probing = false
				if result.err == nil && (result.scope != p.engineScope || result.generation != p.engineGeneration) {
					result.err = dockerengine.ErrUnavailable
				}
				if result.err == nil {
					p.app.mu.Unlock()
					continue
				}
				result.name = "docker"
			} else {
				jobs[result.name].active, active = false, active-1
				if result.name != "docker" && (!p.engineOnline || result.engineEpoch != p.engineEpoch) {
					entry := p.entries[result.name]
					entry.State, entry.Code, entry.retryAt, entry.RetryAfterSeconds = "pending", nil, time.Time{}, nil
					p.entries[result.name] = entry
					p.updateBaseStateLocked()
					p.notifyLocked()
					p.app.mu.Unlock()
					continue
				}
			}
			entry := p.entries[result.name]
			if result.err == nil {
				jobs[result.name].failures = 0
				entry.State, entry.Code, entry.retryAt, entry.RetryAfterSeconds = "ready", nil, time.Time{}, nil
			} else {
				jobs[result.name].failures++
				state, code := preparationFailure(result.name, result.err)
				entry.State, entry.Code = state, preparationCode(code)
				if state == "retrying" {
					entry.retryAt = time.Now().Add(p.retryDelay(jobs[result.name].failures))
				}
			}
			p.entries[result.name] = entry
			if result.name == "docker" {
				if result.err != nil {
					if p.engineOnline {
						p.engineEpoch++
					}
					p.engineOnline = false
					if p.engineCancel != nil {
						p.engineCancel()
						p.engineCancel, p.engineContext = nil, nil
					}
					p.engineScope, p.engineGeneration = "", 0
					p.app.fileMu.Lock()
					p.app.fileImageID, p.app.fileImageCaptured = "", false
					p.app.fileMu.Unlock()
					p.app.snapshotMu.Lock()
					p.app.snapshotImageID, p.app.snapshotImageCaptured = "", false
					p.app.snapshotMu.Unlock()
					revoked = p.app.revokeEngineWorkRoutes()
					p.recoveryReady = false
					if p.recoveryCancel != nil {
						p.recoveryCancel()
					}
					if p.packageCancel != nil {
						p.packageCancel()
					}
					for _, name := range preparationNames[1:] {
						previous := p.entries[name]
						if previous.State == "ready" {
							previous.State = "pending"
							p.entries[name] = previous
						}
					}
				} else {
					newEngine := !p.engineOnline
					if !p.engineOnline {
						p.engineEpoch++
						p.engineContext, p.engineCancel = context.WithCancel(p.app.ctx)
					}
					p.engineOnline = true
					p.engineScope, p.engineGeneration = result.scope, result.generation
					p.app.setWorkRoutesOnline(result.scope, result.generation)
					if newEngine || !p.recoveryStarted {
						p.startRecoveryLocked()
					}
				}
			}
			if result.name == "defaultContext" {
				if result.err == nil && (p.entries["docker"].State != "ready" || p.entries["agent"].State != "ready" || p.entries["packageHelper"].State != "ready") {
					entry.State = "pending"
					p.entries[result.name] = entry
				}
			}
			p.updateBaseStateLocked()
			p.notifyLocked()
			p.app.mu.Unlock()
			closeAgentClients(revoked)
		}
	}
}

func (a *Application) startupPerformance(ctx context.Context) context.Context {
	if a.logs == nil {
		return ctx
	}
	ctx = diagnostics.WithPerformanceWriter(ctx, a.consoleStderr())
	ctx = diagnostics.WithPerformanceSink(ctx, a.diagnosticSink())
	return diagnostics.WithPerformance(ctx, diagnostics.PerformanceIdentity{CorrelationID: "startup-" + a.logs.BootID()})
}

// A daemon without usable identity remains usable, but is never eligible for
// durable result reuse. A change to or from a known identity still fences all
// current Work routes on the next observation.
func (p *runtimePreparation) observeEngineIdentity(ctx context.Context) (string, uint64, error) {
	if p.identityForTest != nil {
		return p.identityForTest(ctx)
	}
	if p.executeForTest != nil || p.app.options.DependencyCheck != nil {
		return "", 0, nil
	}
	scope, generation, err := p.app.engine.VerificationIdentity(ctx)
	if ctx.Err() != nil {
		return "", 0, ctx.Err()
	}
	if err != nil {
		return "", generation, nil
	}
	return scope, generation, nil
}

func (p *runtimePreparation) probeEngine(ctx context.Context, profile RuntimeProfile) error {
	if p.probeForTest != nil {
		return p.probeForTest(ctx)
	}
	if p.app.options.DependencyCheck != nil {
		return p.app.options.DependencyCheck(ctx, p.app, profile)
	}
	return p.app.engine.Ping(ctx)
}

func (p *runtimePreparation) execute(ctx context.Context, name string, profile RuntimeProfile) error {
	if p.executeForTest != nil {
		return p.executeForTest(ctx, name, profile)
	}
	a := p.app
	if name == "docker" {
		if a.options.DependencyCheck != nil {
			return a.options.DependencyCheck(ctx, a, profile)
		}
		if err := a.initializeDocker(ctx); err != nil {
			return err
		}
		// Existing-instance log indexing is best effort and must never gate
		// runtime readiness or Work recovery.
		a.recoverLogSources(ctx)
		return nil
	}
	if name == "defaultContext" {
		return a.prepareDefaultContext(ctx, profile)
	}
	if a.options.DependencyCheck != nil && (name == "agent" || name == "packageHelper") {
		return nil
	}
	if name == "fileHelper" {
		if err := a.captureFileHelper(ctx); err != nil {
			return err
		}
		_, err := a.recoverCoreFiles(ctx)
		return err
	}
	if name == "snapshotHelper" {
		if err := a.captureSnapshotHelper(ctx); err != nil {
			return err
		}
		if err := a.recoverSnapshotJobs(ctx, false); err != nil {
			return err
		}
		return nil
	}
	view, err := a.Settings.RuntimeView()
	if err != nil || view.Model == nil || !view.Model.CredentialAvailable {
		return contracts.NewError("RUNTIME_UNAVAILABLE", "")
	}
	ref := profile.AgentImage
	if name == "packageHelper" && a.options.PackageHelperImage != "" {
		ref = a.options.PackageHelperImage
	}
	_, err = p.prepareImage(ctx, "agent", ref)
	return err
}

func (a *Application) prepareDefaultContext(ctx context.Context, profile RuntimeProfile) error {
	// Recover accepted Core package jobs before the built-in package checks its
	// scope gate; otherwise an interrupted job could prevent its own recovery.
	if a.dockerRuntime != nil {
		if err := a.ensureCorePackageRecovery(ctx); err != nil {
			return err
		}
	}
	if err := a.ensureBundledBrain(ctx); err != nil {
		return err
	}
	if err := a.Store.SyncDefaultWorkRuntime(ctx, profile.Revision, runtimeImageCatalogID(profile.Revision), runtimeModelCatalogID(profile.Revision), defaultWorkConfiguration(profile)); err != nil {
		return err
	}
	if err := a.prewarmDefaultWork(ctx, profile); err != nil {
		return err
	}
	if a.dockerRuntime != nil {
		if err := a.resumeRetainedVolumePurges(ctx); err != nil {
			return err
		}
	}
	return a.confirmDefaultPreparationRevision(ctx)
}

// Merge pulls for an exact reference within a runtime revision. Success retains
// its immutable identity for that revision; failures remain retryable.
func (p *runtimePreparation) pullImage(ctx context.Context, ref string) (dockerengine.PreparedImage, error) {
	revision, _ := ctx.Value(preparationRevisionKey{}).(int64)
	p.app.mu.Lock()
	epoch, engineCtx := p.engineEpoch, p.engineContext
	if expected, scoped := ctx.Value(preparationEngineKey{}).(uint64); scoped && (!p.engineOnline || expected != epoch) {
		p.app.mu.Unlock()
		return dockerengine.PreparedImage{}, errWorkSuperseded
	}
	p.app.mu.Unlock()
	key := imagePreparationKey{revision: revision, reference: ref, engine: epoch}
	return p.images.Get(ctx, key, func(shared context.Context) (dockerengine.PreparedImage, error) {
		attempt, cancel := context.WithCancel(shared)
		defer cancel()
		if engineCtx != nil {
			stop := context.AfterFunc(engineCtx, cancel)
			defer stop()
		}
		if p.pullForTest != nil {
			return p.pullForTest(attempt, ref)
		}
		return p.app.engine.PrepareImage(attempt, ref)
	})
}

func clonePreparedImage(value dockerengine.PreparedImage) dockerengine.PreparedImage {
	value.RepoDigests = append([]string(nil), value.RepoDigests...)
	if value.Labels != nil {
		labels := make(map[string]string, len(value.Labels))
		for key, label := range value.Labels {
			labels[key] = label
		}
		value.Labels = labels
	}
	return value
}

func (p *runtimePreparation) prepareImage(ctx context.Context, kind, ref string) (dockerengine.PreparedImage, error) {
	image, err := p.pullImage(ctx, ref)
	if err != nil {
		return image, err
	}
	if image.OS != "linux" || image.Architecture != "amd64" {
		return image, dockerengine.ErrImageIncompatible
	}
	switch kind {
	case "agent":
		_, err = p.app.inspector.InspectNativeAgent(ctx, image.ID)
	case "file":
		_, err = p.app.inspector.InspectNativeFileHelper(ctx, image.ID)
	case "snapshot":
		_, err = p.app.inspector.InspectNativeSnapshotHelper(ctx, image.ID)
	}
	return image, err
}

func (p *runtimePreparation) waitForBase(ctx context.Context) error {
	for {
		p.app.mu.Lock()
		state, closed, changed := p.app.state, p.app.closed, p.changed
		p.app.mu.Unlock()
		if closed {
			return context.Canceled
		}
		switch state {
		case "READY", "ADMIN_REQUIRED", "RUNTIME_NOT_CONFIGURED":
			return nil
		case "RUNTIME_UNAVAILABLE":
			return contracts.NewError("RUNTIME_UNAVAILABLE", "")
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-p.app.ctx.Done():
			return context.Canceled
		case <-changed:
		}
	}
}
