package coreapp

import (
	"context"
	"errors"
	"math"
	"sync"
	"time"

	"piwork/internal/contracts"
	"piwork/internal/dockerengine"
)

const preparationAttemptTimeout = 10 * time.Minute

var preparationNames = [...]string{"docker", "agent", "packageHelper", "defaultContext", "fileHelper", "snapshotHelper"}

type PreparationComponent struct {
	State             string  `json:"state"`
	Attempt           int     `json:"attempt"`
	RetryAfterSeconds *int    `json:"retryAfterSeconds"`
	Code              *string `json:"code"`
}

type Preparation struct {
	Version    int                             `json:"version"`
	Ready      bool                            `json:"ready"`
	Components map[string]PreparationComponent `json:"components"`
}

type preparationEntry struct {
	PreparationComponent
	retryAt time.Time
}

type preparationRequest struct {
	generation                uint64
	profile                   RuntimeProfile
	configured, administrator bool
}

type imagePreparation struct {
	done  chan struct{}
	image dockerengine.PreparedImage
	err   error
}

type imagePreparationKey struct {
	revision  int64
	reference string
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
	imagesMu    sync.Mutex
	images      map[imagePreparationKey]*imagePreparation
	// Test seams replace external effects, not the scheduler or public state.
	executeForTest              func(context.Context, string, RuntimeProfile) error
	pullForTest                 func(context.Context, string) (dockerengine.PreparedImage, error)
	probeForTest                func(context.Context) error
	retryDelay                  func(int) time.Duration
	attemptTimeout              time.Duration
	probeInterval, probeTimeout time.Duration
}

func newRuntimePreparation(app *Application) *runtimePreparation {
	p := &runtimePreparation{app: app, entries: map[string]preparationEntry{}, wake: make(chan struct{}, 1), changed: make(chan struct{}), images: map[imagePreparationKey]*imagePreparation{}, retryDelay: preparationRetryDelay, attemptTimeout: preparationAttemptTimeout, probeInterval: 2 * time.Second, probeTimeout: 3 * time.Second}
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
	if p.started && !p.invalidated && profile.Revision == p.request.profile.Revision && configured == p.request.configured && admin == p.request.administrator {
		return nil
	}
	p.request = preparationRequest{generation: p.request.generation + 1, profile: profile, configured: configured, administrator: admin}
	p.invalidated = false
	if p.cancel != nil {
		p.cancel()
	}
	for _, name := range preparationNames {
		state, code := "pending", (*string)(nil)
		if !admin || !configured || name == "fileHelper" && a.options.FileHelperImage == "" || name == "snapshotHelper" && a.options.SnapshotHelperImage == "" {
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
		ctx = context.WithValue(ctx, preparationGenerationKey{}, request.generation)
		ctx = context.WithValue(ctx, preparationRevisionKey{}, request.profile.Revision)
		p.cancel = cancel
		done = make(chan struct{})
		p.app.mu.Unlock()
		go func(done chan struct{}) { defer close(done); p.run(ctx, request) }(done)
	}
}

type preparationGenerationKey struct{}
type preparationRevisionKey struct{}

func (p *runtimePreparation) currentLocked(ctx context.Context) bool {
	generation, _ := ctx.Value(preparationGenerationKey{}).(uint64)
	return !p.app.closed && ctx.Err() == nil && (generation == 0 || generation == p.request.generation)
}

type preparationResult struct {
	name string
	err  error
}
type preparationJob struct {
	active   bool
	failures int
}

func (p *runtimePreparation) run(ctx context.Context, request preparationRequest) {
	if !request.administrator || !request.configured {
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
		for _, name := range preparationNames {
			entry, job := p.entries[name], jobs[name]
			if active >= 2 || job.active || entry.State != "pending" && entry.State != "retrying" || time.Now().Before(entry.retryAt) {
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
			go func(name string) {
				defer workers.Done()
				budget := p.attemptTimeout
				if name == "docker" {
					budget = p.probeTimeout
				}
				attempt, cancel := context.WithTimeout(ctx, budget)
				err := p.execute(attempt, name, request.profile)
				cancel()
				select {
				case results <- preparationResult{name, err}:
				case <-ctx.Done():
				}
			}(name)
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
					cancel()
					select {
					case results <- preparationResult{"heartbeat", err}:
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
			if result.name == "heartbeat" {
				probing = false
				if result.err == nil {
					p.app.mu.Unlock()
					continue
				}
				result.name = "docker"
			} else {
				jobs[result.name].active, active = false, active-1
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
			if result.name == "docker" && result.err != nil {
				p.app.state = "RUNTIME_UNAVAILABLE"
				p.app.status.Checks.RuntimeAvailable = false
				for _, name := range preparationNames[1:] {
					previous := p.entries[name]
					if previous.State == "ready" {
						previous.State = "pending"
						p.entries[name] = previous
					}
				}
			}
			if result.name == "defaultContext" {
				if result.err == nil && p.entries["docker"].State == "ready" && p.entries["agent"].State == "ready" && p.entries["packageHelper"].State == "ready" {
					p.app.state = "READY"
					p.app.status.Checks.RuntimeAvailable = true
					if p.app.workRuntime != nil {
						p.app.recoveryOnce.Do(func() { p.app.recoveryWG.Add(1); go p.app.runtimeRecoveryLoop() })
					}
				} else if result.err == nil {
					entry.State = "pending"
					p.entries[result.name] = entry
				} else {
					p.app.state = "RUNTIME_UNAVAILABLE"
				}
			}
			if result.name == "agent" || result.name == "packageHelper" {
				if result.err != nil {
					p.app.state = "RUNTIME_UNAVAILABLE"
				}
			}
			if (result.name == "fileHelper" || result.name == "snapshotHelper") && result.err == nil && p.entries["defaultContext"].State == "ready" {
				// Revisit Works skipped behind durable helper-dependent intents.
				contextEntry := p.entries["defaultContext"]
				contextEntry.State = "pending"
				p.entries["defaultContext"] = contextEntry
			}
			p.notifyLocked()
			p.app.mu.Unlock()
		}
	}
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
		return a.initializeDocker(ctx)
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
	if err := a.ensureBundledBrain(ctx); err != nil {
		return err
	}
	if err := a.Store.SyncDefaultWorkRuntime(ctx, profile.Revision, runtimeImageCatalogID(profile.Revision), runtimeModelCatalogID(profile.Revision), defaultWorkConfiguration(profile)); err != nil {
		return err
	}
	if a.dockerRuntime != nil {
		if !a.packagesRecovered {
			if err := a.recoverCorePackageJobs(ctx); err != nil {
				return err
			}
			a.packagesRecovered = true
		}
		if err := a.resumeRetainedVolumePurges(ctx); err != nil {
			return err
		}
	}
	if a.options.Recover != nil {
		return a.options.Recover(ctx, a)
	}
	if a.workRuntime != nil {
		return a.recoverCapturedWorks(ctx)
	}
	return a.emptyRecovery(ctx)
}

// Merge pulls for an exact reference within a runtime revision. Success retains
// its immutable identity for that revision; failures remain retryable.
func (p *runtimePreparation) pullImage(ctx context.Context, ref string) (dockerengine.PreparedImage, error) {
	revision, _ := ctx.Value(preparationRevisionKey{}).(int64)
	key := imagePreparationKey{revision, ref}
	p.imagesMu.Lock()
	if previous, ok := p.images[key]; ok {
		p.imagesMu.Unlock()
		select {
		case <-ctx.Done():
			return dockerengine.PreparedImage{}, ctx.Err()
		case <-previous.done:
		}
		return previous.image, previous.err
	}
	call := &imagePreparation{done: make(chan struct{})}
	p.images[key] = call
	p.imagesMu.Unlock()
	if p.pullForTest != nil {
		call.image, call.err = p.pullForTest(ctx, ref)
	} else {
		call.image, call.err = p.app.engine.PrepareImage(ctx, ref)
	}
	if call.err == nil && ctx.Err() != nil {
		call.err = ctx.Err()
	}
	p.imagesMu.Lock()
	if call.err != nil {
		delete(p.images, key)
	}
	close(call.done)
	p.imagesMu.Unlock()
	return call.image, call.err
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
