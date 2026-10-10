package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"math"
	"net"
	"strconv"
	"strings"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/status"
	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/internaltls"
	"piwork/internal/rpc/servicesv1"
	"piwork/internal/workaccess"
)

type serviceRPC struct {
	servicesv1.UnimplementedWorkServicesServer
	App *Application
}

func validateServiceRPCOptions(options Options) error {
	if options.AgentGRPCListen != "" {
		host, port, err := net.SplitHostPort(options.AgentGRPCListen)
		number, parseErr := strconv.Atoi(port)
		if err != nil || parseErr != nil || number < 0 || number > 65535 || host != "localhost" && net.ParseIP(host) == nil {
			return errors.New("service control listen address is invalid")
		}
	}
	if options.AgentGRPCAdvertise != "" {
		host, port, err := net.SplitHostPort(options.AgentGRPCAdvertise)
		number, parseErr := strconv.Atoi(port)
		if options.AgentGRPCListen == "" || err != nil || parseErr != nil || number < 1 || number > 65535 || host == "" || len(host) > 253 || strings.ContainsAny(host, "/\\@%\x00\r\n ") {
			return errors.New("service control advertised endpoint is invalid")
		}
	}
	return nil
}

func (a *Application) listenServiceRPC(ctx context.Context) error {
	if a.options.AgentGRPCListen == "" || a.serviceServer != nil {
		return nil
	}
	active := func(scope internaltls.Scope) bool {
		check, cancel := context.WithTimeout(a.ctx, 2*time.Second)
		defer cancel()
		return a.Store.Read(check, func(tx *sql.Tx) error {
			_, err := a.authorizeServiceTx(tx, serviceActor{Runtime: &scope}, scope.WorkID, workaccess.Metadata)
			if err != nil {
				_, err = a.historyMigrationPlanTx(tx, scope)
			}
			return err
		}) == nil
	}
	config, err := a.agentTLS.CoreServerConfig(ctx, active)
	if err != nil {
		return err
	}
	listener, err := net.Listen("tcp", a.options.AgentGRPCListen)
	if err != nil {
		return errors.New("Core service control listener is unavailable")
	}
	endpoint := a.options.AgentGRPCAdvertise
	if endpoint == "" {
		endpoint = net.JoinHostPort("piwork-core", strconv.Itoa(listener.Addr().(*net.TCPAddr).Port))
	}
	server := grpc.NewServer(grpc.Creds(credentials.NewTLS(config)), grpc.UnaryInterceptor(internaltls.ServiceUnaryInterceptor(a.Store.InstallationID(), active)), grpc.MaxRecvMsgSize(1<<20), grpc.MaxSendMsgSize(4<<20), grpc.MaxConcurrentStreams(64))
	servicesv1.RegisterWorkServicesServer(server, &serviceRPC{App: a})
	a.mu.Lock()
	if a.closed {
		a.mu.Unlock()
		server.Stop()
		listener.Close()
		return context.Canceled
	}
	a.serviceServer = server
	a.serviceListener = listener
	a.workRuntime.Endpoint = endpoint
	a.mu.Unlock()
	go func() {
		if err := server.Serve(listener); err != nil && a.ctx.Err() == nil {
			a.setState("RUNTIME_UNAVAILABLE", true, true, false)
		}
	}()
	return nil
}
func rpcServiceError(err error) error {
	if err == nil {
		return nil
	}
	var validation *serviceDefinitionValidationError
	if errors.As(err, &validation) {
		return status.Error(codes.InvalidArgument, "service definition is invalid")
	}
	if errors.Is(err, internaltls.ErrStale) {
		return status.Error(codes.FailedPrecondition, "runtime identity is inactive")
	}
	if errors.Is(err, internaltls.ErrIdentity) {
		return status.Error(codes.Unauthenticated, "runtime identity is invalid")
	}
	_, view := contracts.ProjectError(servicePublicError(err))
	code := codes.Unavailable
	switch view.Code {
	case "INVALID_REQUEST", "INVALID_JSON", "INVALID_SERVICE_DEFINITION":
		code = codes.InvalidArgument
	case "QUOTA_EXCEEDED":
		code = codes.ResourceExhausted
	case "REVISION_CONFLICT", "IDEMPOTENCY_CONFLICT", "CONFLICT":
		code = codes.Aborted
	case "WORK_SNAPSHOT_BUSY", "FAILED_PRECONDITION":
		code = codes.FailedPrecondition
	case "NOT_FOUND":
		code = codes.NotFound
	case "PERMISSION_DENIED":
		code = codes.PermissionDenied
	}
	return status.Error(code, view.Message)
}
func rpcActor(ctx context.Context) (serviceActor, string, error) {
	scope, ok := internaltls.ServicePrincipal(ctx)
	if !ok {
		return serviceActor{}, "", status.Error(codes.Unauthenticated, "runtime identity is required")
	}
	return serviceActor{Runtime: &scope}, scope.WorkID, nil
}

func rpcDefinitionInput(value *servicesv1.ServiceDefinition) (json.RawMessage, error) {
	if value == nil || value.MemoryBytes > uint64(contracts.MaxSafeInteger) {
		return nil, contracts.NewError("INVALID_REQUEST", "definition")
	}
	mounts := []any{}
	for _, item := range value.Mounts {
		if item == nil {
			return nil, contracts.NewError("INVALID_REQUEST", "mounts")
		}
		mounts = append(mounts, map[string]any{"source": item.Source, "target": item.Target, "readOnly": item.ReadOnly})
	}
	ports := []any{}
	for _, item := range value.Ports {
		if item == nil {
			return nil, contracts.NewError("INVALID_REQUEST", "ports")
		}
		ports = append(ports, map[string]any{"name": item.Name, "containerPort": item.ContainerPort, "protocol": item.Protocol})
	}
	environment := value.Environment
	if environment == nil {
		environment = map[string]string{}
	}
	definition := map[string]any{"name": value.Name, "image": map[string]string{"reference": value.GetImage().GetReference()}, "command": value.Command, "args": append([]string{}, value.Args...), "environment": environment, "secretRefs": append([]string{}, value.SecretRefs...), "workingDirectory": value.WorkingDirectory, "mounts": mounts, "ports": ports, "cpuMillis": value.CpuMillis, "memoryBytes": value.MemoryBytes, "enabled": value.Enabled, "required": value.Required, "restartPolicy": value.RestartPolicy}
	if value.Readiness != nil {
		input := value.Readiness
		probe := map[string]any{"kind": input.Kind, "deadlineMs": input.DeadlineMs, "timeoutMs": input.TimeoutMs}
		if input.PortName != "" {
			probe["portName"] = input.PortName
		}
		if input.Path != "" {
			probe["path"] = input.Path
		}
		if len(input.Command) > 0 {
			probe["command"] = input.Command
		}
		definition["readiness"] = probe
	}
	return json.Marshal(definition)
}
func rpcAcceptance(value acceptedServiceOperation) *servicesv1.Acceptance {
	return &servicesv1.Acceptance{WorkId: value.WorkID, ServiceId: value.ServiceID, OperationId: value.OperationID, CorrelationId: value.CorrelationID, Reused: value.Reused}
}
func (server *serviceRPC) definition(ctx context.Context, value *servicesv1.ServiceDefinition, serviceID string, expected uint32, key string) (*servicesv1.Acceptance, error) {
	actor, workID, err := rpcActor(ctx)
	if err != nil {
		return nil, err
	}
	if key == "" || len(key) > 256 {
		return nil, status.Error(codes.InvalidArgument, "idempotency key is invalid")
	}
	raw, err := rpcDefinitionInput(value)
	if err != nil {
		return nil, rpcServiceError(err)
	}
	accepted, err := server.App.acceptServiceDefinition(ctx, actor, workID, serviceID, int64(expected), raw, key)
	if err != nil {
		return nil, rpcServiceError(err)
	}
	if !accepted.Reused {
		server.App.cancelServiceEffects(workID)
	}
	server.App.enqueueWork(workID)
	return rpcAcceptance(accepted), nil
}
func (server *serviceRPC) CreateService(ctx context.Context, request *servicesv1.CreateServiceRequest) (*servicesv1.Acceptance, error) {
	return server.definition(ctx, request.Definition, "", 0, request.IdempotencyKey)
}
func (server *serviceRPC) UpdateService(ctx context.Context, request *servicesv1.UpdateServiceRequest) (*servicesv1.Acceptance, error) {
	return server.definition(ctx, request.Definition, request.ServiceId, request.ExpectedRevision, request.IdempotencyKey)
}
func (server *serviceRPC) action(ctx context.Context, request *servicesv1.MutateServiceRequest, action string) (*servicesv1.Acceptance, error) {
	actor, workID, err := rpcActor(ctx)
	if err != nil {
		return nil, err
	}
	if request.IdempotencyKey == "" || len(request.IdempotencyKey) > 256 {
		return nil, status.Error(codes.InvalidArgument, "idempotency key is invalid")
	}
	accepted, err := server.App.acceptServiceAction(ctx, actor, workID, request.ServiceId, action, request.IdempotencyKey)
	if err != nil {
		return nil, rpcServiceError(err)
	}
	if !accepted.Reused {
		server.App.cancelServiceEffects(workID)
	}
	server.App.enqueueWork(workID)
	return rpcAcceptance(accepted), nil
}
func (server *serviceRPC) StartService(ctx context.Context, r *servicesv1.MutateServiceRequest) (*servicesv1.Acceptance, error) {
	return server.action(ctx, r, "start")
}
func (server *serviceRPC) StopService(ctx context.Context, r *servicesv1.MutateServiceRequest) (*servicesv1.Acceptance, error) {
	return server.action(ctx, r, "stop")
}
func (server *serviceRPC) RestartService(ctx context.Context, r *servicesv1.MutateServiceRequest) (*servicesv1.Acceptance, error) {
	return server.action(ctx, r, "restart")
}
func (server *serviceRPC) RemoveService(ctx context.Context, r *servicesv1.MutateServiceRequest) (*servicesv1.Acceptance, error) {
	return server.action(ctx, r, "remove")
}
func (server *serviceRPC) RetryService(ctx context.Context, r *servicesv1.MutateServiceRequest) (*servicesv1.Acceptance, error) {
	return server.action(ctx, r, "retry")
}

func rpcServiceView(value publicServiceView) (*servicesv1.ServiceView, error) {
	if value.DesiredRevision > math.MaxUint32 || value.AppliedRevision != nil && *value.AppliedRevision > math.MaxUint32 {
		return nil, status.Error(codes.Unavailable, "service revision is outside RPC range")
	}
	input := value.Definition
	definition := &servicesv1.ServiceDefinition{Name: input.Name, Image: &servicesv1.ServiceImage{Reference: input.Image.Reference}, Command: input.Command, Args: input.Args, Environment: map[string]string{}, SecretRefs: []string{}, WorkingDirectory: input.WorkingDirectory, CpuMillis: uint32(input.CpuMillis), MemoryBytes: uint64(input.MemoryBytes), Enabled: input.Enabled, Required: input.Required, RestartPolicy: input.RestartPolicy}
	for key, raw := range input.Environment {
		var text string
		if json.Unmarshal(raw, &text) != nil {
			return nil, rpcServiceError(corestore.ErrStorage)
		}
		definition.Environment[key] = text
	}
	for _, item := range input.Mounts {
		definition.Mounts = append(definition.Mounts, &servicesv1.ServiceMount{Source: item.Source, Target: item.Target, ReadOnly: item.ReadOnly})
	}
	for _, item := range input.Ports {
		definition.Ports = append(definition.Ports, &servicesv1.ServicePort{Name: string(item.Name), ContainerPort: uint32(item.ContainerPort), Protocol: item.Protocol})
	}
	if input.Readiness.Present {
		probe := input.Readiness.Value
		definition.Readiness = &servicesv1.ReadinessProbe{Kind: probe.Kind, PortName: string(probe.PortName.Value), Path: probe.Path.Value, Command: probe.Command.Value, DeadlineMs: uint32(probe.DeadlineMs.Value), TimeoutMs: uint32(probe.TimeoutMs.Value)}
	}
	result := &servicesv1.ServiceView{MemoryLimitMode: "unlimited", WorkId: value.WorkID, ServiceId: value.ServiceID, Name: value.Name, DesiredRevision: uint32(value.DesiredRevision), Enabled: value.Enabled, ObservedState: value.ObservedState, Definition: definition, CreatedAt: value.CreatedAt, Access: &servicesv1.ServiceAccess{Hostname: value.Access.Hostname, DefaultUrl: value.Access.DefaultURL, DefaultPortName: value.Access.DefaultPortName, Status: value.Access.Status}}
	if value.AppliedRevision != nil {
		revision := uint32(*value.AppliedRevision)
		result.AppliedRevision = &revision
	}
	for _, item := range value.Endpoints {
		result.Endpoints = append(result.Endpoints, &servicesv1.ServiceEndpoint{Name: string(item.Name), Protocol: item.Protocol, Host: item.Host, Port: uint32(item.Port), Url: item.Url.Value})
	}
	for _, item := range value.Access.Ports {
		result.Access.Ports = append(result.Access.Ports, &servicesv1.ServiceAccessPort{Name: item.Name, Port: uint32(item.Port), Url: item.URL})
	}
	if value.LastError != nil {
		result.LastError = &servicesv1.SafeError{Code: "SERVICE_FAILED", Message: "Service operation failed.", Remediation: "Inspect service logs and retry.", CorrelationId: value.ServiceID}
	}
	return result, nil
}
func (server *serviceRPC) GetService(ctx context.Context, request *servicesv1.ServiceIdRequest) (*servicesv1.ServiceView, error) {
	actor, workID, err := rpcActor(ctx)
	if err != nil {
		return nil, err
	}
	value, err := server.App.readService(ctx, actor, workID, request.ServiceId)
	if err != nil {
		return nil, rpcServiceError(err)
	}
	return rpcServiceView(value)
}
func (server *serviceRPC) ListServices(ctx context.Context, _ *servicesv1.Empty) (*servicesv1.ListServicesResponse, error) {
	actor, workID, err := rpcActor(ctx)
	if err != nil {
		return nil, err
	}
	values, err := server.App.listServices(ctx, actor, workID)
	if err != nil {
		return nil, rpcServiceError(err)
	}
	result := &servicesv1.ListServicesResponse{Services: []*servicesv1.ServiceView{}}
	for _, value := range values {
		view, err := rpcServiceView(value)
		if err != nil {
			return nil, err
		}
		result.Services = append(result.Services, view)
	}
	return result, nil
}
func (server *serviceRPC) GetOperation(ctx context.Context, request *servicesv1.OperationIdRequest) (*servicesv1.OperationView, error) {
	actor, workID, err := rpcActor(ctx)
	if err != nil {
		return nil, err
	}
	if err := server.App.Store.Read(ctx, func(tx *sql.Tx) error {
		_, err := server.App.authorizeServiceTx(tx, actor, workID, workaccess.Metadata)
		return err
	}); err != nil {
		return nil, rpcServiceError(err)
	}
	operation, err := server.App.Store.Operation(ctx, request.OperationId)
	if err != nil {
		return nil, rpcServiceError(err)
	}
	if operation.WorkID == nil || *operation.WorkID != workID || operation.ServiceID == nil || !isServiceOperation(operation.Kind) {
		return nil, status.Error(codes.NotFound, "operation was not found")
	}
	result := &servicesv1.OperationView{OperationId: operation.ID, WorkId: workID, ServiceId: *operation.ServiceID, Kind: operation.Kind, State: operation.State, CreatedAt: operation.CreatedAt, UpdatedAt: operation.UpdatedAt}
	if diagnostic, ok := safeServiceDiagnostic(operation.ErrorJSON, *operation.ServiceID).(map[string]any); ok {
		result.Error = &servicesv1.SafeError{Code: diagnostic["code"].(string), Message: diagnostic["message"].(string), Remediation: diagnostic["remediation"].(string), CorrelationId: operation.ID}
	}
	return result, nil
}
func (server *serviceRPC) ReadServiceLogs(ctx context.Context, request *servicesv1.ReadServiceLogsRequest) (*servicesv1.ServiceLogs, error) {
	actor, workID, err := rpcActor(ctx)
	if err != nil {
		return nil, err
	}
	lines := int(request.TailLines)
	if lines == 0 {
		lines = 100
	}
	view, err := server.App.serviceLogs(ctx, actor, workID, request.ServiceId, lines)
	if err != nil {
		return nil, rpcServiceError(err)
	}
	result := &servicesv1.ServiceLogs{ServiceId: view.ServiceID, Status: view.Status, Text: view.Text, Truncated: view.Truncated, CollectedAt: view.CollectedAt}
	if view.Reason != "" {
		result.Error = &servicesv1.SafeError{Code: "LOGS_UNAVAILABLE", Message: view.Reason, Remediation: "Verify the service instance and retry.", CorrelationId: view.ServiceID}
	}
	return result, nil
}
func (server *serviceRPC) GetDeploymentContext(ctx context.Context, _ *servicesv1.Empty) (*servicesv1.DeploymentContext, error) {
	actor, workID, err := rpcActor(ctx)
	if err != nil {
		return nil, err
	}
	var result *servicesv1.DeploymentContext
	err = server.App.Store.Read(ctx, func(tx *sql.Tx) error {
		work, err := server.App.authorizeServiceTx(tx, actor, workID, workaccess.Metadata)
		if err != nil {
			return err
		}
		var raw string
		if err := tx.QueryRow(`SELECT config_json FROM work_config_revisions WHERE work_id=? AND revision=?`, workID, work.DesiredRevision).Scan(&raw); err != nil {
			return err
		}
		config, err := contracts.Decode[contracts.WorkConfig](strings.NewReader(raw), "WorkConfigSchema", 2<<20)
		if err != nil {
			return err
		}
		usage, err := corestore.ReadQuotaUsage(tx, &workID)
		if err != nil {
			return err
		}
		availableCPU, availableMemory := max(int64(0), config.Resources.CpuMillis-usage.CPUMillis), max(int64(0), config.Resources.MemoryBytes-usage.MemoryBytes)
		result = &servicesv1.DeploymentContext{WorkId: workID, WorkspacePath: "/var/data/workspace", WorkspaceWritable: true, Lifecycle: work.DesiredState, TotalCpuMillis: uint32(config.Resources.CpuMillis), TotalMemoryBytes: uint64(config.Resources.MemoryBytes), AgentCpuMillis: uint32(config.Resources.AgentCpuMillis), AgentMemoryBytes: uint64(config.Resources.AgentMemoryBytes), AvailableCpuMillis: uint32(availableCPU), AvailableMemoryBytes: uint64(availableMemory), DefaultServiceCpuMillis: 250, DefaultServiceMemoryBytes: 0, ServiceMemoryPolicy: "unlimited", ApiVersion: "v2"}
		return nil
	})
	return result, rpcServiceError(err)
}
