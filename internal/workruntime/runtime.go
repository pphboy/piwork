// Package workruntime starts only Docker-inspected, generation-scoped pi-agentd
// instances. The Work coordinator remains responsible for durable acceptance,
// desired state, resource intents, and publication of a ready route.
package workruntime

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/netip"
	"path/filepath"
	"reflect"
	"regexp"
	"slices"
	"strconv"
	"time"

	"github.com/moby/moby/api/types/container"

	"google.golang.org/protobuf/proto"
	"piwork/internal/agentclient"
	"piwork/internal/contracts"
	"piwork/internal/diagnostics"
	"piwork/internal/dockerengine"
	"piwork/internal/imagestatic"
	"piwork/internal/internaltls"
	"piwork/internal/rpc/agentv1"
	"piwork/internal/safefs"
)

var ErrContext = errors.New("captured Work context is invalid")
var ErrAgents = errors.New("captured AGENTS instructions are invalid")
var ErrAgentExited = errors.New("Work Agent exited before readiness")
var ErrAgentTimeout = errors.New("Work Agent did not become ready")
var ErrAgentAddress = errors.New("Work Agent has no unique private network address")

var packageToolName = regexp.MustCompile(`^package:((?:@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*):[A-Za-z0-9_-]{1,64}$`)
var serviceToolNames = []string{"deployment_context", "service_create", "service_list", "service_get", "service_update", "service_start", "service_stop", "service_restart", "service_remove", "service_retry", "operation_get", "service_logs"}

type Model struct {
	Provider, ID string
	API          string
	Capabilities json.RawMessage
	BaseURL      *string
	Credential   []byte
}

type StartSpec struct {
	Scope                      internaltls.Scope
	ImageID                    string
	ContextID                  string
	ContextDirectory           string
	Model                      Model
	InitializationOnly         bool
	HistoryMigration           *contracts.WorkHistoryMigration
	workHistorySchema          int64
	CorrelationID              string
	Observe                    func(diagnostics.Event) error `json:"-"`
	AfterCredentialPublication func(context.Context) error   `json:"-"`
	AfterContainerCreate       func(context.Context) error   `json:"-"`
	AdoptExisting              bool                          `json:"-"`
}

type Started struct {
	ContainerID      string
	Address          string
	Client           *agentclient.Client
	LogPolicyVersion int64
	scope            internaltls.Scope
	contextID        string
	verified         bool
	readiness        *agentv1.ReadinessResponse
}

func (s Started) VerifiedReadiness() *agentv1.ReadinessResponse {
	if !s.verified || s.readiness == nil {
		return nil
	}
	return proto.Clone(s.readiness).(*agentv1.ReadinessResponse)
}

type Runtime struct {
	Docker    *dockerengine.Runtime
	Inspector *dockerengine.ImageInspector
	TLS       *internaltls.Manager
	Endpoint  string
}

type captured struct {
	config   contracts.WorkConfig
	metadata contracts.WorkContextMetadata
}

// ReadCapturedContext validates a Core-owned immutable context without
// contacting Docker, loading packages, or executing captured content.
func ReadCapturedContext(spec StartSpec) (contracts.WorkConfig, contracts.WorkContextMetadata, error) {
	value, err := readCaptured(spec)
	return value.config, value.metadata, err
}

func readCaptured(spec StartSpec) (captured, error) {
	if spec.Scope.WorkID == "" || spec.Scope.Generation < 1 || spec.Scope.InstanceID == "" || spec.ContextID == "" || spec.ImageID == "" || spec.ContextDirectory == "" || spec.Model.Provider == "" || spec.Model.ID == "" {
		return captured{}, ErrContext
	}
	root, err := safefs.OpenExistingRoot(spec.ContextDirectory)
	if err != nil {
		return captured{}, ErrContext
	}
	defer root.Close()
	configuration, err := root.ReadPublishedFile("config.json", 2<<20)
	if err != nil {
		return captured{}, ErrContext
	}
	config, err := contracts.Decode[contracts.WorkConfig](bytes.NewReader(configuration), "WorkConfigSchema", 2<<20)
	if err != nil || filepath.Base(spec.ContextDirectory) != spec.ContextID || filepath.Base(filepath.Dir(spec.ContextDirectory)) != "contexts" || filepath.Base(filepath.Dir(filepath.Dir(spec.ContextDirectory))) != spec.Scope.WorkID {
		return captured{}, ErrContext
	}
	metadataJSON, err := root.ReadPublishedFile("metadata.json", 2<<20)
	if err != nil {
		return captured{}, ErrContext
	}
	metadata, err := contracts.Decode[contracts.WorkContextMetadata](bytes.NewReader(metadataJSON), "WorkContextMetadataSchema", 2<<20)
	if err != nil || metadata.WorkId != spec.Scope.WorkID || metadata.SnapshotId != spec.ContextID || string(metadata.ImageIdentity) != spec.ImageID || len(metadata.Skills) != len(config.Skills) || len(metadata.PackageBindings) != len(config.Packages) {
		return captured{}, ErrContext
	}
	for index, skill := range metadata.Skills {
		if skill.Name != string(config.Skills[index]) || skill.Identity == "" {
			return captured{}, ErrContext
		}
	}
	for index, binding := range metadata.PackageBindings {
		if binding.Name != string(config.Packages[index].Name) || binding.NameKey == "" || binding.Artifact.ContentDigest == "" {
			return captured{}, ErrContext
		}
	}
	agents, err := root.ReadPublishedFile("AGENTS.md", 256<<10)
	if err != nil || string(agents) != config.AgentsMd {
		return captured{}, errors.Join(ErrContext, ErrAgents)
	}
	return captured{config: config, metadata: metadata}, nil
}

func (r *Runtime) Prepare(ctx context.Context, spec StartSpec) error {
	_, err := r.prepare(ctx, spec)
	return err
}

func (r *Runtime) prepare(ctx context.Context, spec StartSpec) (imagestatic.Capabilities, error) {
	if r == nil || r.Docker == nil || r.Inspector == nil || r.TLS == nil {
		return imagestatic.Capabilities{}, ErrContext
	}
	capabilities, err := r.Inspector.InspectNativeAgent(ctx, spec.ImageID)
	if err != nil {
		return capabilities, err
	}
	if _, err := r.Docker.EnsureNetwork(ctx, spec.Scope.WorkID); err != nil {
		return capabilities, err
	}
	if _, err := r.Docker.EnsureVolume(ctx, spec.Scope.WorkID, "work-private"); err != nil {
		return capabilities, err
	}
	if _, err := r.Docker.EnsureVolume(ctx, spec.Scope.WorkID, "work-workspace"); err != nil {
		return capabilities, err
	}
	return capabilities, nil
}

func (r *Runtime) Start(ctx context.Context, spec StartSpec) (result Started, err error) {
	if spec.CorrelationID != "" {
		ctx = diagnostics.WithPerformanceIfAbsent(ctx, diagnostics.PerformanceIdentity{CorrelationID: spec.CorrelationID, WorkID: spec.Scope.WorkID})
	}
	var performance *diagnostics.PerformanceSpan
	defer func() { performance.End(err) }()
	stage, code, containerID := "context-validate", "CONTEXT_NOT_FOUND", ""
	emit := func(outcome string) error {
		if spec.Observe == nil {
			return nil
		}
		return spec.Observe(diagnostics.Event{Component: "core", Stage: stage, Outcome: outcome, Code: code})
	}
	defer func() {
		if err == nil {
			return
		}
		failure := &diagnostics.Failure{Cause: err, Code: code, Stage: stage, Collection: contracts.DiagnosticCollection{State: "not-attempted"}}
		if containerID != "" && ctx.Err() == nil {
			failure = r.initializationFailure(ctx, spec, containerID, err, stage, code)
		}
		if spec.Observe != nil {
			if failure.Stage != stage {
				failure.Cause = errors.Join(failure.Cause, spec.Observe(diagnostics.Event{Component: "core", Stage: stage, Outcome: "failed", Code: failure.Code, SkillName: failure.SkillName}))
			}
			err = errors.Join(failure, spec.Observe(diagnostics.Event{Component: "core", Stage: failure.Stage, Outcome: "failed", Code: failure.Code, SkillName: failure.SkillName}))
		} else {
			err = failure
		}
	}()
	if err = emit("started"); err != nil {
		return result, err
	}
	captured, err := readCaptured(spec)
	if err != nil {
		return result, err
	}
	if err = emit("succeeded"); err != nil {
		return result, err
	}
	stage, code = "runtime-prepare", "RUNTIME_PREPARE_FAILED"
	performance = diagnostics.BeginPerformance(ctx, "runtime-prepare")
	if err = emit("started"); err != nil {
		return result, err
	}
	capabilities, err := r.prepare(ctx, spec)
	if err != nil {
		return result, err
	}
	spec.workHistorySchema = capabilities.WorkHistorySchema
	performance.End(nil)
	if err = emit("succeeded"); err != nil {
		return result, err
	}
	stage, code = "runtime-start", "RUNTIME_START_FAILED"
	performance = diagnostics.BeginPerformance(ctx, "container-start")
	if err = emit("started"); err != nil {
		return result, err
	}
	network, err := r.Docker.EnsureNetwork(ctx, spec.Scope.WorkID)
	if err != nil {
		return result, err
	}
	private, err := r.Docker.EnsureVolume(ctx, spec.Scope.WorkID, "work-private")
	if err != nil {
		return result, err
	}
	workspace, err := r.Docker.EnsureVolume(ctx, spec.Scope.WorkID, "work-workspace")
	if err != nil {
		return result, err
	}
	identity, err := r.TLS.EnsureGeneration(ctx, spec.Scope)
	if err != nil {
		return result, err
	}
	endpoint := r.Endpoint
	if endpoint == "" {
		endpoint = "piwork-core:7172"
	}
	serviceControl, err := r.TLS.WriteServiceControlConfig(ctx, spec.Scope, endpoint)
	if err != nil {
		return result, err
	}
	config := agentConfig(spec, captured.config, identity)
	config.ServiceControl.Present = true
	config.ServiceControl.Value.Endpoint = endpoint
	config.ServiceControl.Value.ServerName = "piwork-core"
	config.ServiceControl.Value.CaCertificatePath = "/etc/piwork/control/installation-ca.crt"
	config.ServiceControl.Value.ClientCertificatePath = "/etc/piwork/control/agent-service-client.crt"
	config.ServiceControl.Value.ClientPrivateKeyPath = "/etc/piwork/control/agent-service-client.key"
	configPath, err := r.TLS.WriteAgentConfig(ctx, spec.Scope, config)
	if err != nil {
		return result, err
	}
	mounts := []dockerengine.ContainerMount{
		{Type: "volume", Source: private.Name, Target: "/var/data", CopyImageData: true},
		{Type: "volume", Source: workspace.Name, Target: "/var/data/workspace", CopyImageData: true},
		{Type: "bind", Source: spec.ContextDirectory, Target: "/run/piwork", ReadOnly: true},
		{Type: "bind", Source: configPath, Target: "/etc/piwork/runtime.json", ReadOnly: true},
		{Type: "bind", Source: serviceControl, Target: "/etc/piwork/service-control.json", ReadOnly: true},
		{Type: "bind", Source: identity.CACertificatePath, Target: "/etc/piwork/tls/installation-ca.crt", ReadOnly: true},
		{Type: "bind", Source: identity.ServerCertificatePath, Target: "/etc/piwork/tls/agent-server.crt", ReadOnly: true},
		{Type: "bind", Source: identity.ServerPrivateKeyPath, Target: "/etc/piwork/tls/agent-server.key", ReadOnly: true},
		{Type: "bind", Source: identity.CACertificatePath, Target: "/etc/piwork/control/installation-ca.crt", ReadOnly: true},
		{Type: "bind", Source: identity.ServiceClientCertificatePath, Target: "/etc/piwork/control/agent-service-client.crt", ReadOnly: true},
		{Type: "bind", Source: identity.ServiceClientPrivateKeyPath, Target: "/etc/piwork/control/agent-service-client.key", ReadOnly: true},
		{Type: "tmpfs", Target: "/tmp"},
	}
	if spec.Model.Provider != "piwork-deterministic" {
		secret, err := r.TLS.WriteModelCredential(ctx, spec.Scope, spec.Model.Credential)
		if err != nil {
			return result, err
		}
		mounts = append(mounts, dockerengine.ContainerMount{Type: "bind", Source: secret, Target: "/run/secrets/model-api-key", ReadOnly: true})
	}
	if spec.AfterCredentialPublication != nil {
		if err := spec.AfterCredentialPublication(ctx); err != nil {
			return result, err
		}
	}
	agent := agentIdentity(spec.Scope, spec.ContextID)
	ensured, err := r.Docker.EnsureContainer(ctx, dockerengine.ContainerSpec{
		Identity: agent, Image: spec.ImageID, Command: []string{"--config", "/etc/piwork/runtime.json"},
		User: "10001:10001", CPUMillis: captured.config.Resources.AgentCpuMillis, MemoryBytes: captured.config.Resources.AgentMemoryBytes,
		WorkingDirectory: "/var/data/workspace", ControlHost: "piwork-core",
		Network: &dockerengine.ContainerNetwork{Name: network.Name, WorkID: spec.Scope.WorkID, Aliases: []string{"agentd"}}, Mounts: mounts,
	})
	if err != nil {
		return result, err
	}
	containerID = ensured.ID
	if spec.AfterContainerCreate != nil {
		if err := spec.AfterContainerCreate(ctx); err != nil {
			return result, err
		}
	}
	view, err := r.Docker.StartContainer(ctx, agent)
	if err != nil {
		return result, err
	}
	address, err := solePrivateAddress(view, network.Name)
	if err != nil {
		return result, err
	}
	client, err := agentclient.Open(ctx, r.TLS, spec.Scope, address)
	if err != nil {
		return result, err
	}
	if err = emit("succeeded"); err != nil {
		client.Close()
		return result, err
	}
	stage, code = "readiness", "AGENT_READINESS_TIMEOUT"
	performance.End(nil)
	performance = diagnostics.BeginPerformance(ctx, "readiness-rpc")
	if err = emit("started"); err != nil {
		client.Close()
		return result, err
	}
	readiness, err := waitReady(ctx, r.Docker, agent, ensured.ID, client, spec, captured)
	performance.End(err)
	if err != nil {
		client.Close()
		return result, err
	}
	if spec.Observe != nil {
		if err = r.collectInitializationDiagnostics(ctx, spec, agent, ensured.ID); err != nil {
			client.Close()
			return result, err
		}
	}
	if err = emit("succeeded"); err != nil {
		client.Close()
		return result, err
	}
	return Started{ContainerID: ensured.ID, Address: address, Client: client, LogPolicyVersion: ensured.LogPolicyVersion, scope: spec.Scope, contextID: spec.ContextID, verified: true, readiness: readiness}, nil
}

// Adopt verifies a running exact-identity Agent without publishing material or
// creating a container. Its credential mount remains generation-owned.
func (r *Runtime) Adopt(ctx context.Context, spec StartSpec) (Started, error) {
	var result Started
	if r == nil || r.Docker == nil || r.Inspector == nil || r.TLS == nil {
		return result, ErrContext
	}
	captured, err := readCaptured(spec)
	if err != nil {
		return result, err
	}
	capabilities, err := r.Inspector.InspectNativeAgent(ctx, spec.ImageID)
	if err != nil {
		return result, err
	}
	spec.workHistorySchema = capabilities.WorkHistorySchema
	files, err := r.TLS.ExistingAgentFiles(ctx, spec.Scope)
	if err != nil {
		return result, err
	}
	endpoint := r.Endpoint
	if endpoint == "" {
		endpoint = "piwork-core:7172"
	}
	expected := agentConfig(spec, captured.config, files.Identity)
	expected.CorrelationId = files.AgentConfig.CorrelationId
	expected.ServiceControl.Present = true
	expected.ServiceControl.Value.Endpoint = endpoint
	expected.ServiceControl.Value.ServerName = "piwork-core"
	expected.ServiceControl.Value.CaCertificatePath = "/etc/piwork/control/installation-ca.crt"
	expected.ServiceControl.Value.ClientCertificatePath = "/etc/piwork/control/agent-service-client.crt"
	expected.ServiceControl.Value.ClientPrivateKeyPath = "/etc/piwork/control/agent-service-client.key"
	control := files.ServiceConfig.ServiceControl
	if !reflect.DeepEqual(expected, files.AgentConfig) || control.Endpoint != endpoint || control.ServerName != "piwork-core" || control.CACertificatePath != "/etc/piwork/control/installation-ca.crt" || control.ClientCertificatePath != "/etc/piwork/control/agent-service-client.crt" || control.ClientPrivateKeyPath != "/etc/piwork/control/agent-service-client.key" {
		return result, ErrContext
	}
	agent := agentIdentity(spec.Scope, spec.ContextID)
	view, err := r.Docker.InspectContainer(ctx, agent)
	if err != nil || view == nil || view.State == nil || !view.State.Running || view.HostConfig == nil || view.NetworkSettings == nil || len(view.NetworkSettings.Networks) != 1 {
		if err == nil {
			err = dockerengine.ErrStateUnknown
		}
		return result, err
	}
	networkName := string(view.HostConfig.NetworkMode)
	if _, err := r.Docker.InspectNetwork(ctx, networkName, spec.Scope.WorkID); err != nil {
		return result, err
	}
	var private, workspace string
	for _, item := range view.HostConfig.Mounts {
		if string(item.Type) == "volume" {
			switch item.Target {
			case "/var/data":
				private = item.Source
			case "/var/data/workspace":
				workspace = item.Source
			}
		}
	}
	if _, err := r.Docker.InspectVolume(ctx, private, spec.Scope.WorkID, "work-private"); err != nil {
		return result, err
	}
	if _, err := r.Docker.InspectVolume(ctx, workspace, spec.Scope.WorkID, "work-workspace"); err != nil {
		return result, err
	}
	identity := files.Identity
	mounts := []dockerengine.ContainerMount{
		{Type: "volume", Source: private, Target: "/var/data", CopyImageData: true},
		{Type: "volume", Source: workspace, Target: "/var/data/workspace", CopyImageData: true},
		{Type: "bind", Source: spec.ContextDirectory, Target: "/run/piwork", ReadOnly: true},
		{Type: "bind", Source: files.AgentConfigPath, Target: "/etc/piwork/runtime.json", ReadOnly: true},
		{Type: "bind", Source: files.ServiceConfigPath, Target: "/etc/piwork/service-control.json", ReadOnly: true},
		{Type: "bind", Source: identity.CACertificatePath, Target: "/etc/piwork/tls/installation-ca.crt", ReadOnly: true},
		{Type: "bind", Source: identity.ServerCertificatePath, Target: "/etc/piwork/tls/agent-server.crt", ReadOnly: true},
		{Type: "bind", Source: identity.ServerPrivateKeyPath, Target: "/etc/piwork/tls/agent-server.key", ReadOnly: true},
		{Type: "bind", Source: identity.CACertificatePath, Target: "/etc/piwork/control/installation-ca.crt", ReadOnly: true},
		{Type: "bind", Source: identity.ServiceClientCertificatePath, Target: "/etc/piwork/control/agent-service-client.crt", ReadOnly: true},
		{Type: "bind", Source: identity.ServiceClientPrivateKeyPath, Target: "/etc/piwork/control/agent-service-client.key", ReadOnly: true},
		{Type: "tmpfs", Target: "/tmp"},
	}
	if files.CredentialPath != "" {
		mounts = append(mounts, dockerengine.ContainerMount{Type: "bind", Source: files.CredentialPath, Target: "/run/secrets/model-api-key", ReadOnly: true})
	}
	view, err = r.Docker.ValidateRunningContainer(ctx, dockerengine.ContainerSpec{
		Identity: agent, Image: spec.ImageID, Command: []string{"--config", "/etc/piwork/runtime.json"},
		User: "10001:10001", CPUMillis: captured.config.Resources.AgentCpuMillis, MemoryBytes: captured.config.Resources.AgentMemoryBytes,
		WorkingDirectory: "/var/data/workspace", ControlHost: "piwork-core",
		Network: &dockerengine.ContainerNetwork{Name: networkName, WorkID: spec.Scope.WorkID, Aliases: []string{"agentd"}}, Mounts: mounts,
	})
	if err != nil {
		return result, err
	}
	address, err := solePrivateAddress(view, networkName)
	if err != nil {
		return result, err
	}
	client, err := agentclient.OpenExisting(ctx, r.TLS, spec.Scope, address)
	if err != nil {
		return result, err
	}
	readiness, err := waitReady(ctx, r.Docker, agent, view.ID, client, spec, captured)
	if err != nil {
		client.Close()
		return result, err
	}
	return Started{ContainerID: view.ID, Address: address, Client: client, LogPolicyVersion: dockerengine.ObservedContainerLogPolicyVersion(view.HostConfig), scope: spec.Scope, contextID: spec.ContextID, verified: true, readiness: readiness}, nil
}

func (r *Runtime) collectInitializationDiagnostics(ctx context.Context, spec StartSpec, agent dockerengine.ContainerIdentity, containerID string) error {
	span := diagnostics.BeginPerformance(ctx, "diagnostic-collection")
	logs, err := r.Docker.Logs(ctx, agent, 200, containerID)
	if err != nil {
		span.End(err)
		return nil
	}
	for _, event := range diagnostics.ParseAgentLines(logs.Text, spec.Scope.WorkID, spec.CorrelationID) {
		if err := spec.Observe(event); err != nil {
			span.End(err)
			return err
		}
	}
	span.End(nil)
	return nil
}

// AgentContainerIdentity exposes the exact label set used when creating an
// Agent container so lifecycle logging can bind and archive that instance.
func AgentContainerIdentity(scope internaltls.Scope, contextID string) dockerengine.ContainerIdentity {
	return agentIdentity(scope, contextID)
}

func agentIdentity(scope internaltls.Scope, contextID string) dockerengine.ContainerIdentity {
	return dockerengine.ContainerIdentity{WorkID: scope.WorkID, Kind: "agent", LogicalID: "agentd", Labels: map[string]string{
		"piwork.generation": strconv.FormatInt(scope.Generation, 10), "piwork.instance_id": scope.InstanceID,
		"piwork.protocol_version": "v2", "piwork.context_identity": contextID,
	}}
}

// StopAgent confirms the exact current generation has stopped. It deliberately
// retains both volumes and the container identity for same-installation resume.
// The coordinator closes admission and drains before calling this method.
func (r *Runtime) StopAgent(ctx context.Context, scope internaltls.Scope, contextID string, timeout time.Duration) error {
	if r == nil || r.Docker == nil || scope.WorkID == "" || scope.Generation < 1 || scope.InstanceID == "" || contextID == "" || timeout < 0 || timeout > 30*time.Second {
		return ErrContext
	}
	seconds := int((timeout + time.Second - 1) / time.Second)
	view, err := r.Docker.StopContainer(ctx, agentIdentity(scope, contextID), seconds)
	if err != nil {
		return err
	}
	if view == nil || view.State == nil || view.State.Running {
		return dockerengine.ErrStateUnknown
	}
	return nil
}

func agentConfig(spec StartSpec, work contracts.WorkConfig, identity internaltls.GenerationIdentity) contracts.AgentRuntimeConfig {
	config := contracts.AgentRuntimeConfig{Version: 1, WorkId: spec.Scope.WorkID, Generation: spec.Scope.Generation, InstanceId: spec.Scope.InstanceID, Listen: "0.0.0.0:7443", DataDirectory: "/var/data", Deterministic: spec.Model.Provider == "piwork-deterministic"}
	config.FeedbackListen = contracts.Supplied("0.0.0.0:7444")
	config.ContextConfigPath = contracts.Supplied("/run/piwork/config.json")
	config.AgentsMdPath = contracts.Supplied("/run/piwork/AGENTS.md")
	config.ContextIdentity = contracts.Supplied(spec.ContextID)
	config.InitializationOnly = contracts.Supplied(spec.InitializationOnly)
	if spec.HistoryMigration != nil {
		config.HistoryMigration = contracts.Supplied(*spec.HistoryMigration)
	}
	config.ResolvedTools = contracts.Supplied(builtInTools(work.Tools))
	if spec.CorrelationID != "" {
		config.CorrelationId = contracts.Supplied(spec.CorrelationID)
	}
	config.Model.Provider, config.Model.Id = spec.Model.Provider, spec.Model.ID
	if spec.Model.API != "" {
		config.Model.Api = contracts.Supplied(contracts.ModelApi(spec.Model.API))
	}
	if len(spec.Model.Capabilities) > 0 {
		config.Model.Capabilities = contracts.Supplied(spec.Model.Capabilities)
	}
	if spec.Model.BaseURL != nil {
		config.Model.BaseUrl = contracts.Supplied(*spec.Model.BaseURL)
	}
	if !config.Deterministic {
		config.Model.CredentialPath = contracts.Supplied("/run/secrets/model-api-key")
	}
	config.Tls.CaCertificatePath = internaltls.AgentCAPath
	config.Tls.ServerCertificatePath = internaltls.AgentCertificatePath
	config.Tls.ServerPrivateKeyPath = internaltls.AgentKeyPath
	config.Tls.ExpectedClientCommonName = identity.ClientCommonName
	return config
}

func builtInTools(policy contracts.ToolPolicy) []string {
	allowed, denied := make(map[string]bool), make(map[string]bool)
	for _, name := range policy.Allowed {
		allowed[string(name)] = true
	}
	for _, name := range policy.Denied {
		denied[string(name)] = true
	}
	result := []string{}
	for _, name := range []string{"read", "bash", "edit", "write", "grep", "find", "ls"} {
		if (len(allowed) == 0 || allowed[name]) && !denied[name] {
			result = append(result, name)
		}
	}
	return result
}

func solePrivateAddress(view *container.InspectResponse, networkName string) (string, error) {
	if view == nil || view.NetworkSettings == nil || len(view.NetworkSettings.Networks) != 1 {
		return "", ErrAgentAddress
	}
	endpoint := view.NetworkSettings.Networks[networkName]
	if endpoint == nil || !endpoint.IPAddress.IsValid() || endpoint.IPAddress.IsUnspecified() || endpoint.IPAddress.IsLoopback() || endpoint.IPAddress.IsMulticast() {
		return "", ErrAgentAddress
	}
	address := endpoint.IPAddress.Unmap()
	if _, err := netip.ParseAddr(address.String()); err != nil {
		return "", ErrAgentAddress
	}
	return address.String(), nil
}

func waitReady(ctx context.Context, docker *dockerengine.Runtime, identity dockerengine.ContainerIdentity, containerID string, client *agentclient.Client, spec StartSpec, captured captured) (*agentv1.ReadinessResponse, error) {
	readyCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		response, err := client.Readiness(readyCtx, spec.ContextID, spec.InitializationOnly)
		if err == nil {
			if spec.Model.API != "" && response.GetModelProviderContractVersion() != 1 {
				return nil, agentclient.ErrContextIncompatible
			}
			if spec.workHistorySchema != 0 && int64(response.GetWorkHistorySchemaVersion()) != spec.workHistorySchema {
				return nil, agentclient.ErrContextIncompatible
			}
			if err := verifyResources(response, captured); err != nil {
				return nil, err
			}
			return response, nil
		}
		if errors.Is(err, agentclient.ErrReadiness) {
			return nil, err
		}
		view, inspectErr := docker.InspectContainer(readyCtx, identity)
		if inspectErr != nil {
			if errors.Is(readyCtx.Err(), context.DeadlineExceeded) && ctx.Err() == nil {
				return nil, ErrAgentTimeout
			}
			return nil, inspectErr
		}
		if view == nil || view.ID != containerID || view.State == nil {
			return nil, ErrAgentExited
		}
		if !view.State.Running {
			return nil, ErrAgentExited
		}
		client.RetryReadinessConnection(err)
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-readyCtx.Done():
			return nil, ErrAgentTimeout
		case <-time.After(200 * time.Millisecond):
		}
	}
	return nil, ErrAgentTimeout
}

// VerifyResources is shared by activation and live public observations, so
// missing resources or stale digests cannot be reported ready by either path.
func VerifyResources(response *agentv1.ReadinessResponse, config contracts.WorkConfig, metadata contracts.WorkContextMetadata) error {
	if response == nil || len(config.Packages) != len(metadata.PackageBindings) || len(config.Skills) != len(metadata.Skills) {
		return agentclient.ErrReadiness
	}
	for i, binding := range metadata.PackageBindings {
		if binding.Name != string(config.Packages[i].Name) {
			return agentclient.ErrReadiness
		}
	}
	return verifyResources(response, captured{config: config, metadata: metadata})
}

func verifyResources(response *agentv1.ReadinessResponse, captured captured) error {
	if len(response.GetLoadedSkills()) != len(captured.metadata.Skills) || len(response.GetPackageDiagnostics()) != 0 {
		return agentclient.ErrReadiness
	}
	for index, actual := range response.GetLoadedSkills() {
		expected := captured.metadata.Skills[index]
		if actual.GetName() != expected.Name || actual.GetIdentity() != expected.Identity || !actual.GetLoaded() {
			return agentclient.ErrReadiness
		}
	}
	builtIns := builtInTools(captured.config.Tools)
	if len(response.GetResolvedTools()) < len(builtIns) || !slices.Equal(response.GetResolvedTools()[:len(builtIns)], builtIns) {
		return agentclient.ErrReadiness
	}
	enabled := make(map[string]contracts.PiPackageArtifactMetadata)
	for index, selection := range captured.config.Packages {
		if selection.Enabled {
			enabled[string(selection.Name)] = captured.metadata.PackageBindings[index].Artifact
		}
	}
	if len(response.GetLoadedPackages()) != len(enabled) {
		return agentclient.ErrReadiness
	}
	for _, actual := range response.GetLoadedPackages() {
		expected, ok := enabled[actual.GetName()]
		if !ok || actual.GetContentDigest() != string(expected.ContentDigest) || int64(actual.GetExtensions()) != expected.ResourceCounts.Extensions || int64(actual.GetSkills()) != expected.ResourceCounts.Skills || int64(actual.GetPrompts()) != expected.ResourceCounts.Prompts || int64(actual.GetThemes()) != expected.ResourceCounts.Themes {
			return agentclient.ErrReadiness
		}
		delete(enabled, actual.GetName())
	}
	if len(enabled) != 0 {
		return agentclient.ErrReadiness
	}
	resources := make(map[string]map[string]int64)
	seenResourceNames := make(map[string]bool)
	for _, item := range response.GetPackageResources() {
		name, kind := item.GetPackageName(), item.GetKind()
		if item.GetName() == "" || kind != "extension" && kind != "skill" && kind != "prompt" && kind != "theme" {
			return agentclient.ErrReadiness
		}
		selected := false
		for _, entry := range captured.config.Packages {
			if string(entry.Name) == name && entry.Enabled {
				selected = true
				break
			}
		}
		if !selected {
			return agentclient.ErrReadiness
		}
		key := kind + ":" + item.GetName()
		if seenResourceNames[key] && kind != "extension" {
			return agentclient.ErrReadiness
		}
		seenResourceNames[key] = true
		if resources[name] == nil {
			resources[name] = make(map[string]int64)
		}
		resources[name][kind]++
	}
	for _, item := range response.GetLoadedPackages() {
		count := resources[item.GetName()]
		if count["extension"] != int64(item.GetExtensions()) || count["skill"] != int64(item.GetSkills()) || count["prompt"] != int64(item.GetPrompts()) || count["theme"] != int64(item.GetThemes()) {
			return agentclient.ErrReadiness
		}
	}
	allowed, denied := make(map[string]bool), make(map[string]bool)
	for _, name := range captured.config.Tools.Allowed {
		allowed[string(name)] = true
	}
	for _, name := range captured.config.Tools.Denied {
		denied[string(name)] = true
	}
	servers := make(map[string]bool)
	for _, server := range captured.config.McpServers {
		servers[string(server.ServerId)] = true
	}
	resolved := response.GetResolvedTools()
	seenTools := make(map[string]bool)
	actualServiceTools := []string{}
	for _, tool := range resolved {
		if seenTools[tool] {
			return agentclient.ErrReadiness
		}
		seenTools[tool] = true
	}
	for _, tool := range resolved[len(builtIns):] {
		if len(allowed) != 0 && !allowed[tool] || denied[tool] {
			return agentclient.ErrReadiness
		}
		if match := packageToolName.FindStringSubmatch(tool); match != nil {
			selected := false
			for _, entry := range captured.config.Packages {
				if string(entry.Name) == match[1] && entry.Enabled {
					selected = true
					break
				}
			}
			if !selected {
				return agentclient.ErrReadiness
			}
			continue
		}
		separator := -1
		for index, c := range tool {
			if c == '.' {
				separator = index
				break
			}
		}
		if separator < 1 || !servers[tool[:separator]] {
			return agentclient.ErrReadiness
		}
		if tool[:separator] == "work-services" {
			actualServiceTools = append(actualServiceTools, tool)
		}
	}
	expectedServiceTools := []string{}
	if servers["work-services"] {
		for _, name := range serviceToolNames {
			tool := "work-services." + name
			if (len(allowed) == 0 || allowed[tool]) && !denied[tool] {
				expectedServiceTools = append(expectedServiceTools, tool)
			}
		}
	}
	slices.Sort(actualServiceTools)
	slices.Sort(expectedServiceTools)
	if !slices.Equal(actualServiceTools, expectedServiceTools) {
		return agentclient.ErrReadiness
	}
	return nil
}
