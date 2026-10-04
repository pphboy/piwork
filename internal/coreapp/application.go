package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"google.golang.org/grpc"

	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/diagnostics"
	"piwork/internal/dockerengine"
	"piwork/internal/identity"
	"piwork/internal/internaltls"
	"piwork/internal/packageprepare"
	"piwork/internal/safefs"
	"piwork/internal/skillartifact"
	"piwork/internal/workfiles"
	"piwork/internal/workruntime"
)

type Initialization struct {
	Administrator *struct{ Account, Password string }
	Runtime       *RuntimeInput
}
type Options struct {
	DataDirectory          string
	OperatorCredentialPath string
	Initialization         Initialization
	DockerOptions          dockerengine.SelectionOptions
	PackageHelperImage     string
	FileHelperImage        string
	SnapshotHelperImage    string
	AgentGRPCListen        string
	AgentGRPCAdvertise     string
	WorkDrainTimeout       time.Duration
	WorkStopTimeout        time.Duration
	ShutdownTimeout        time.Duration
	// Later lifecycle/file/package/snapshot modules register actual recovery
	// and shutdown here. With no registration, an installation with durable
	// Work/job records remains RECOVERING; it cannot be advertised as ready.
	Recover         func(context.Context, *Application) error
	Shutdown        func(context.Context, *Application) error
	DependencyCheck func(context.Context, *Application, RuntimeProfile) error
}
type Status struct {
	State  string `json:"state"`
	Ready  bool   `json:"ready"`
	Checks struct {
		Administrator            bool `json:"administrator"`
		RuntimeConfigured        bool `json:"runtimeConfigured"`
		RuntimeAvailable         bool `json:"runtimeAvailable"`
		FilesystemMigrationReady bool `json:"filesystemMigrationReady"`
	} `json:"checks"`
}
type Application struct {
	prepareBrainForTest   func(context.Context) (packageprepare.Result, error)
	Store                 *corestore.Store
	Identity              *identity.Service
	Settings              *Settings
	files                 *corestore.PlatformFiles
	inspectionRoot        *safefs.Root
	engine                *dockerengine.Engine
	inspector             *dockerengine.ImageInspector
	dockerRuntime         *dockerengine.Runtime
	agentTLS              *internaltls.Manager
	workRuntime           *workruntime.Runtime
	agentRoutes           workruntime.Routes
	options               Options
	ctx                   context.Context
	cancel                context.CancelFunc
	mu                    sync.Mutex
	skillMu               sync.Mutex
	skillUploads          atomic.Int32
	packageUploads        atomic.Int32
	packageWG             sync.WaitGroup
	packageSlots          chan struct{}
	packageRunning        sync.Map
	packageStorageMu      sync.Mutex
	packagesRecovered     bool
	fileMu                sync.Mutex
	fileImageCaptured     bool
	fileImageID           string
	fileEpoch             int64
	fileJobs              sync.Map
	fileRecoveryLocks     sync.Map
	fileRecoveryActive    sync.Map
	fileWG                sync.WaitGroup
	snapshotMu            sync.Mutex
	snapshotStorageMu     sync.Mutex
	snapshotImageCaptured bool
	snapshotImageID       string
	snapshotsRecovered    bool
	snapshotRunning       sync.Map
	snapshotTransfers     sync.Map
	snapshotWG            sync.WaitGroup
	workLocks             sync.Map
	workQueueMu           sync.Mutex
	workQueues            map[string]chan struct{}
	workWG                sync.WaitGroup
	workApplyWorkers      sync.Map
	serviceEffects        sync.Map
	serviceRecovering     sync.Map
	recoveryOnce          sync.Once
	recoveryWG            sync.WaitGroup
	state                 string
	status                Status
	closed                bool
	refresh               chan struct{}
	refreshWG             sync.WaitGroup
	server                *http.Server
	listener              net.Listener
	serveDone             chan error
	serviceServer         *grpc.Server
	serviceListener       net.Listener
	serviceGateway        *serviceGateway
}

func New(ctx context.Context, options Options) (_ *Application, returned error) {
	if err := validateServiceRPCOptions(options); err != nil {
		return nil, err
	}
	if err := normalizeShutdownOptions(&options); err != nil {
		return nil, err
	}
	if options.OperatorCredentialPath != "" {
		parent, err := filepath.Abs(filepath.Dir(options.OperatorCredentialPath))
		if err != nil {
			return nil, ErrOperatorCredential
		}
		stage, err := filepath.Abs(filepath.Join(options.DataDirectory, "runtime", "platform"))
		if err != nil {
			return nil, ErrOperatorCredential
		}
		// Reject a credential placed in the publication-temp namespace before
		// opening files or running crash recovery: it must never be mistaken
		// for an abandoned temporary file and removed.
		if parent == stage && strings.HasPrefix(filepath.Base(options.OperatorCredentialPath), "publish-") {
			return nil, ErrOperatorCredential
		}
	}
	if options.Initialization.Administrator != nil {
		admin := options.Initialization.Administrator
		if err := identity.ValidatePassword(admin.Password); err != nil {
			return nil, err
		}
		if !regexpAccount(admin.Account) {
			return nil, contracts.NewError("INVALID_REQUEST", "account")
		}
	}
	if options.Initialization.Runtime != nil {
		if err := ValidateRuntime(*options.Initialization.Runtime); err != nil {
			return nil, err
		}
	}
	storeOptions := corestore.Options{Directory: options.DataDirectory}
	if options.OperatorCredentialPath != "" {
		parent, err := filepath.Abs(filepath.Dir(options.OperatorCredentialPath))
		if err != nil {
			return nil, corestore.ErrStorage
		}
		directory, err := filepath.Abs(options.DataDirectory)
		if err != nil {
			return nil, corestore.ErrStorage
		}
		if parent == directory {
			storeOptions.OperatorCredentialName = filepath.Base(options.OperatorCredentialPath)
		}
	}
	store, err := corestore.Open(ctx, storeOptions)
	if err != nil {
		return nil, err
	}
	files, err := store.OpenPlatformFiles()
	if err != nil {
		store.Close()
		return nil, err
	}
	settings := NewSettings(store, files)
	if err := files.SetOperatorPath(options.OperatorCredentialPath); err != nil {
		files.Close()
		store.Close()
		return nil, ErrOperatorCredential
	}
	if err := settings.EnsureOperator(ctx); err != nil {
		files.Close()
		store.Close()
		return nil, err
	}
	id, err := identity.New(ctx, store, identity.Options{})
	if err != nil {
		files.Close()
		store.Close()
		return nil, err
	}
	keep := false
	defer func() {
		if !keep {
			id.Close()
			files.Close()
			store.Close()
		}
	}()
	hasAdmin, err := id.HasEnabledAdministrator(ctx)
	if err != nil {
		return nil, err
	}
	if !hasAdmin && options.Initialization.Administrator != nil {
		admin := options.Initialization.Administrator
		if _, err := id.Bootstrap(ctx, admin.Account, admin.Password); err != nil {
			return nil, err
		}
	}
	_, configured, err := settings.LoadRuntime()
	if err != nil {
		return nil, err
	}
	if !configured && options.Initialization.Runtime != nil {
		if _, err := settings.ConfigureRuntime(*options.Initialization.Runtime); err != nil {
			return nil, err
		}
	}
	root, err := files.OpenInspectionRoot()
	if err != nil {
		return nil, err
	}
	lifetime, cancel := context.WithCancel(context.Background())
	a := &Application{Store: store, Identity: id, Settings: settings, files: files, inspectionRoot: root, options: options, ctx: lifetime, cancel: cancel, state: "STORE_OPEN", refresh: make(chan struct{}, 1), serveDone: make(chan error, 1)}
	a.serviceGateway = newServiceGateway(a)
	a.packageSlots = make(chan struct{}, 2)
	if err := store.Write(ctx, func(tx *sql.Tx) error {
		var err error
		a.fileEpoch, err = corestore.NextFileCoreEpoch(tx)
		return err
	}); err != nil {
		root.Close()
		cancel()
		return nil, err
	}
	// A crash after publishing bytes but before committing the catalog can
	// leave an unreferenced digest or staging directory. Reclaim it before
	// this Core accepts another Skill operation.
	if err := skillartifact.CleanupOrphans(store); err != nil {
		root.Close()
		cancel()
		return nil, err
	}
	if err := store.Write(ctx, corestore.RecoverContextPackageLeases); err != nil {
		root.Close()
		cancel()
		return nil, err
	}
	if err := a.recoverPackageUploadFiles(ctx); err != nil {
		root.Close()
		cancel()
		return nil, err
	}
	a.status.Checks.FilesystemMigrationReady = true
	if err := a.recoverDiagnosticAttempts(ctx); err != nil {
		root.Close()
		cancel()
		return nil, err
	}
	keep = true
	a.startPackageUploadCollector()
	return a, nil
}
func regexpAccount(s string) bool {
	if len(s) < 1 || len(s) > 128 {
		return false
	}
	for i, c := range s {
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') {
			continue
		}
		if i == 0 || !strings.ContainsRune("._:-", c) {
			return false
		}
	}
	return true
}

func (a *Application) Listen(address ListenAddress) (ListenAddress, error) {
	a.mu.Lock()
	if a.closed || a.server != nil {
		a.mu.Unlock()
		return ListenAddress{}, errors.New("Core application cannot listen twice")
	}
	bindHost := address.Host
	if strings.EqualFold(bindHost, "localhost") {
		bindHost = "127.0.0.1"
	}
	listener, err := net.Listen("tcp", net.JoinHostPort(bindHost, stringsPort(address.Port)))
	if err != nil {
		a.mu.Unlock()
		return ListenAddress{}, errors.New("Core HTTP listener is unavailable")
	}
	a.listener = listener
	a.state = "LISTENING"
	a.server = &http.Server{Handler: http.HandlerFunc(a.route), ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 31 * time.Minute, IdleTimeout: 90 * time.Second, MaxHeaderBytes: 32 << 10, BaseContext: func(net.Listener) context.Context { return a.ctx }}
	server := a.server
	a.mu.Unlock()
	go func() {
		err := server.Serve(listener)
		if errors.Is(err, http.ErrServerClosed) {
			err = nil
		}
		a.serveDone <- err
	}()
	// The socket is already available to health/control clients during runtime
	// checking. Missing admin/runtime and Engine failures do not exit Core.
	_ = a.RefreshRuntime(a.ctx)
	actual := listener.Addr().(*net.TCPAddr)
	return ListenAddress{actual.IP.String(), actual.Port}, nil
}
func stringsPort(port int) string { return strconv.Itoa(port) }
func (a *Application) setState(state string, admin, configured, available bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.closed {
		return
	}
	a.state = state
	a.status = Status{State: state, Ready: state == "READY"}
	a.status.Checks.Administrator = admin
	a.status.Checks.RuntimeConfigured = configured
	a.status.Checks.RuntimeAvailable = available
	a.status.Checks.FilesystemMigrationReady = true
}
func (a *Application) Status() Status {
	a.mu.Lock()
	defer a.mu.Unlock()
	status := a.status
	status.State = a.state
	status.Ready = a.state == "READY"
	return status
}

var errRecoveryRequired = errors.New("startup recovery handlers are required")

func (a *Application) RefreshRuntime(request context.Context) error {
	// Admission + WaitGroup registration share the closing mutex, preventing
	// shutdown from waiting while a new refresh is registered afterwards.
	a.mu.Lock()
	if a.closed {
		a.mu.Unlock()
		return context.Canceled
	}
	a.refreshWG.Add(1)
	a.mu.Unlock()
	defer a.refreshWG.Done()
	ctx, cancel := context.WithTimeout(request, time.Minute)
	defer cancel()
	stop := context.AfterFunc(a.ctx, cancel)
	defer stop()
	select {
	case a.refresh <- struct{}{}:
	case <-ctx.Done():
		return ctx.Err()
	}
	defer func() { <-a.refresh }()
	admin, err := a.Identity.HasEnabledAdministrator(ctx)
	if err != nil {
		return err
	}
	if !admin {
		a.setState("ADMIN_REQUIRED", false, false, false)
		return nil
	}
	profile, configured, err := a.Settings.LoadRuntime()
	if err != nil {
		a.setState("RUNTIME_UNAVAILABLE", true, false, false)
		return err
	}
	if !configured {
		a.setState("RUNTIME_NOT_CONFIGURED", true, false, false)
		return nil
	}
	a.setState("RECOVERING", true, true, false)
	if err := a.ensureRuntimeCatalog(ctx, profile); err != nil {
		return err
	}
	if a.options.DependencyCheck != nil {
		err = a.options.DependencyCheck(ctx, a, profile)
	} else {
		err = a.checkDocker(ctx, profile)
	}
	if err != nil {
		a.setState("RUNTIME_UNAVAILABLE", true, true, false)
		return contracts.NewError("RUNTIME_UNAVAILABLE", "")
	}
	if err := a.ensureBundledBrain(ctx); err != nil {
		a.setState("RUNTIME_UNAVAILABLE", true, true, false)
		return contracts.NewError("RUNTIME_UNAVAILABLE", "")
	}
	if err := a.Store.SyncDefaultWorkRuntime(ctx, profile.Revision, runtimeImageCatalogID(profile.Revision), runtimeModelCatalogID(profile.Revision), defaultWorkConfiguration(profile)); err != nil {
		return err
	}
	if a.dockerRuntime != nil && !a.packagesRecovered {
		if err := a.recoverCorePackageJobs(ctx); err != nil {
			return err
		}
		a.packagesRecovered = true
	}
	if a.dockerRuntime != nil {
		if err := a.resumeRetainedVolumePurges(ctx); err != nil {
			return err
		}
	}
	a.captureFileHelper(ctx)
	a.captureSnapshotHelper(ctx)
	if !a.snapshotsRecovered && a.dockerRuntime != nil {
		if err := a.recoverSnapshotJobs(ctx, false); err != nil {
			return err
		}
		a.snapshotsRecovered = true
	}
	if a.options.Recover != nil {
		err = a.options.Recover(ctx, a)
	} else if a.workRuntime != nil {
		err = a.recoverCapturedWorks(ctx)
	} else {
		err = a.emptyRecovery(ctx)
	}
	if err != nil {
		a.setState("RECOVERING", true, true, true)
		return err
	}
	latest, _, err := a.Settings.LoadRuntime()
	if err != nil {
		return err
	}
	if latest.Revision != profile.Revision {
		return contracts.NewError("REVISION_CONFLICT", "")
	}
	a.setState("READY", true, true, true)
	if a.workRuntime != nil {
		a.recoveryOnce.Do(func() {
			a.recoveryWG.Add(1)
			go a.runtimeRecoveryLoop()
		})
	}
	return nil
}
func (a *Application) checkDocker(ctx context.Context, profile RuntimeProfile) error {
	if a.engine == nil {
		endpoint, err := dockerengine.SelectEndpoint(a.options.DockerOptions)
		if err != nil {
			return err
		}
		engine, err := dockerengine.Connect(ctx, endpoint)
		if err != nil {
			return err
		}
		inspector, err := dockerengine.NewImageInspector(ctx, engine, a.inspectionRoot, a.Store)
		if err != nil {
			engine.Close()
			return err
		}
		a.engine = engine
		a.inspector = inspector
	}
	view, err := a.Settings.RuntimeView()
	if err != nil || view.Model == nil || !view.Model.CredentialAvailable {
		return contracts.NewError("RUNTIME_UNAVAILABLE", "")
	}
	image, err := a.engine.PrepareImage(ctx, profile.AgentImage)
	if err != nil {
		return err
	}
	if _, err = a.inspector.InspectNativeAgent(ctx, image.ID); err != nil {
		return err
	}
	if a.workRuntime == nil {
		resources, err := dockerengine.NewRuntime(a.engine, a.Store.InstallationID(), func(ctx context.Context, plan dockerengine.ResourcePlan) error {
			return a.Store.RecordResourceIntent(ctx, corestore.ResourceIntent{WorkID: plan.WorkID, Kind: plan.Kind, LogicalID: plan.LogicalID, Name: plan.Name, Labels: plan.Labels})
		}, []string{a.options.DataDirectory})
		if err != nil {
			return err
		}
		resources.SetPackageSettler(func(ctx context.Context, plan dockerengine.ResourcePlan) error {
			return a.Store.SettlePackageCreation(ctx, plan.WorkID, plan.Kind, plan.LogicalID, plan.Name)
		})
		manager, err := internaltls.Open(filepath.Join(a.options.DataDirectory, "runtime", "agent-tls"), a.Store)
		if err != nil {
			return err
		}
		a.dockerRuntime = resources
		a.agentTLS = manager
		a.workRuntime = &workruntime.Runtime{Docker: resources, Inspector: a.inspector, TLS: manager}
	}
	return a.listenServiceRPC(ctx)
}
func (a *Application) emptyRecovery(ctx context.Context) error {
	// This guard keeps staged implementation honest. Actual durable workload
	// recovery is implemented by tasks 5/6/8/9, not a no-op startup hook.
	var n int
	err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		return tx.QueryRowContext(ctx, `SELECT (SELECT count(*) FROM works)+(SELECT count(*) FROM pi_package_jobs)+(SELECT count(*) FROM work_file_jobs)+(SELECT count(*) FROM snapshot_jobs)`).Scan(&n)
	})
	if err != nil {
		return err
	}
	if n != 0 {
		return errRecoveryRequired
	}
	return nil
}
func (a *Application) Close(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, a.options.ShutdownTimeout)
	defer cancel()
	a.mu.Lock()
	if a.closed {
		a.mu.Unlock()
		return nil
	}
	a.closed = true
	a.state = "SHUTTING_DOWN"
	server := a.server
	serviceServer := a.serviceServer
	a.mu.Unlock()
	a.workQueueMu.Lock()
	a.cancel()
	a.workQueueMu.Unlock()
	a.Identity.Close()
	var result error
	if serviceServer != nil {
		stopped := make(chan struct{})
		go func() { serviceServer.GracefulStop(); close(stopped) }()
		select {
		case <-stopped:
		case <-ctx.Done():
			serviceServer.Stop()
			result = errors.New("Core service control shutdown was not confirmed")
		}
	}
	if server != nil {
		httpContext, stopHTTP := context.WithTimeout(ctx, a.options.WorkDrainTimeout)
		err := server.Shutdown(httpContext)
		stopHTTP()
		if err != nil {
			server.Close()
			result = errors.New("Core HTTP shutdown was not confirmed")
		}
	}
	finished := make(chan struct{})
	go func() { a.refreshWG.Wait(); close(finished) }()
	select {
	case <-finished:
	case <-ctx.Done():
		result = errors.New("Core runtime shutdown was not confirmed")
	}
	workersDone := make(chan struct{})
	go func() { a.workWG.Wait(); a.packageWG.Wait(); a.fileWG.Wait(); a.snapshotWG.Wait(); close(workersDone) }()
	select {
	case <-workersDone:
	case <-ctx.Done():
		result = errors.New("Core Work coordination did not stop")
	}
	recoveryDone := make(chan struct{})
	go func() { a.recoveryWG.Wait(); close(recoveryDone) }()
	select {
	case <-recoveryDone:
	case <-ctx.Done():
		result = errors.New("Core recovery coordination did not stop")
	}
	if a.options.Shutdown != nil {
		if err := a.options.Shutdown(ctx, a); err != nil {
			result = errors.New("Core workload shutdown was not confirmed")
		}
	} else if err := a.shutdownCapturedWorks(ctx); err != nil {
		result = errors.New("Core workload shutdown was not confirmed")
	}
	if a.engine != nil {
		a.engine.Close()
	}
	if a.agentTLS != nil {
		a.agentTLS.Close()
	}
	a.inspectionRoot.Close()
	a.files.Close()
	if err := a.Store.Close(); err != nil {
		result = errors.New("Core storage shutdown was not confirmed")
	}
	return result
}

func send(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(value)
}
func (a *Application) route(w http.ResponseWriter, r *http.Request) {
	trace := &operationTrace{app: a, correlation: string(requestCorrelation()), preacceptDiagnostics: diagnostics.Empty()}
	r = r.WithContext(context.WithValue(r.Context(), traceKey{}, trace))
	defer func() {
		if failure := recover(); failure != nil {
			if failure == http.ErrAbortHandler {
				panic(failure)
			}
			contracts.WriteError(w, contracts.NewError("INTERNAL_ERROR", ""))
		}
	}()
	if workfiles.IsRawTarget(r.RequestURI) {
		a.serveFiles(w, r)
		return
	}
	if err := a.handle(w, r); err != nil {
		if strings.HasPrefix(r.URL.Path, "/api/v1/admin/") {
			status, view := contracts.ProjectAdminError(err, requestCorrelation())
			send(w, status, view)
		} else {
			if trace.preacceptFailed {
				status, view := contracts.ProjectError(err)
				raw, _ := json.Marshal(view)
				var body map[string]any
				_ = json.Unmarshal(raw, &body)
				body["correlationId"] = trace.correlation
				send(w, status, body)
			} else {
				contracts.WriteError(w, err)
			}
		}
	}
}
