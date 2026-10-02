//go:build integration

package dockerengine

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"net"
	"net/url"
	"os"
	"path/filepath"
	goruntime "runtime"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/moby/moby/api/types/container"
	"github.com/moby/moby/api/types/mount"
	"github.com/moby/moby/api/types/network"
	"github.com/moby/moby/client"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/status"
	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/internaltls"
	"piwork/internal/rpc/agentv1"
	"piwork/internal/rpc/servicesv1"
	"piwork/internal/testsupport"
)

// This is a TLS/protocol fixture, not a business Core or a Core gate. The
// server uses the real Go peer policy; the container runs complete TS Agent.
type tlsDeploymentFixture struct {
	servicesv1.UnimplementedWorkServicesServer
	called     chan internaltls.Scope
	inactivate func()
}

func (f *tlsDeploymentFixture) GetDeploymentContext(ctx context.Context, _ *servicesv1.Empty) (*servicesv1.DeploymentContext, error) {
	scope, ok := internaltls.ServicePrincipal(ctx)
	if !ok {
		return nil, status.Error(codes.Unauthenticated, "principal absent")
	}
	f.called <- scope
	f.inactivate()
	return &servicesv1.DeploymentContext{WorkId: scope.WorkID, WorkspacePath: "/var/data/workspace", WorkspaceWritable: true, ApiVersion: "v2"}, nil
}

func TestRealTSAgentNativeMutualTLSWithoutHostTools(t *testing.T) {
	t.Setenv("PATH", filepath.Join(t.TempDir(), "no-host-tools"))
	host := os.Getenv("PIWORK_TEST_DOCKER_HOST")
	if host == "" {
		host = "unix:///var/run/docker.sock"
	}
	endpoint, err := SelectEndpoint(SelectionOptions{DockerHost: host, DockerConfig: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	engine, err := Connect(context.Background(), endpoint)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { engine.Close() })
	scope, err := testsupport.NewScope()
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("TLS installation scope: %s", scope.ID())
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := scope.Cleanup(ctx, engine.api); err != nil {
			t.Error(err)
		}
	})
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	image, nativeImage := migrationAgentImage(t, engine, ctx)
	if image.Labels["io.piwork.agent.variant"] != "acceptance" {
		t.Fatal("deterministic TLS fixture requires acceptance variant")
	}
	directory := t.TempDir()
	store, err := corestore.Open(ctx, corestore.Options{Directory: directory, InstallationID: scope.ID()})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	manager, err := internaltls.Open(filepath.Join(directory, "runtime"), store)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { manager.Close() })
	runtime, err := NewRuntime(engine, scope.ID(), func(ctx context.Context, plan ResourcePlan) error {
		return store.RecordResourceIntent(ctx, corestore.ResourceIntent{WorkID: plan.WorkID, Kind: plan.Kind, LogicalID: plan.LogicalID, Name: plan.Name, Labels: plan.Labels})
	}, []string{directory})
	if err != nil {
		t.Fatal(err)
	}
	identity := internaltls.Scope{InstallationID: scope.ID(), WorkID: "work-tls-fixture", Generation: 1, InstanceID: "agent-tls-fixture"}
	tlsIdentity, err := manager.EnsureGeneration(ctx, identity)
	if err != nil {
		t.Fatal(err)
	}
	bridge, err := runtime.EnsureNetwork(ctx, identity.WorkID)
	if err != nil {
		t.Fatal(err)
	}
	if len(bridge.IPAM.Config) != 1 || !bridge.IPAM.Config[0].Gateway.IsValid() {
		t.Fatal("fixture bridge gateway missing")
	}
	listener, err := net.Listen("tcp", net.JoinHostPort(bridge.IPAM.Config[0].Gateway.String(), "0"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { listener.Close() })
	var active atomic.Bool
	active.Store(true)
	current := func(candidate internaltls.Scope) bool { return active.Load() && candidate == identity }
	serverTLS, err := manager.CoreServerConfig(ctx, current)
	if err != nil {
		t.Fatal(err)
	}
	fixture := &tlsDeploymentFixture{called: make(chan internaltls.Scope, 1), inactivate: func() { active.Store(false) }}
	server := grpc.NewServer(grpc.Creds(credentials.NewTLS(serverTLS)), grpc.UnaryInterceptor(internaltls.ServiceUnaryInterceptor(scope.ID(), current)))
	servicesv1.RegisterWorkServicesServer(server, fixture)
	t.Cleanup(func() { server.Stop() })
	go server.Serve(listener)
	var config contracts.AgentRuntimeConfig
	config.Version = 1
	config.WorkId = identity.WorkID
	config.Generation = identity.Generation
	config.InstanceId = identity.InstanceID
	config.Listen = "0.0.0.0:7443"
	config.DataDirectory = "/var/data"
	config.Deterministic = true
	config.Model.Provider = "piwork-deterministic"
	config.Model.Id = "fixture-v1"
	config.ContextConfigPath = contracts.Supplied("/run/piwork/config.json")
	config.AgentsMdPath = contracts.Supplied("/run/piwork/AGENTS.md")
	config.ContextIdentity = contracts.Supplied("context-tls-fixture")
	config.Tls.CaCertificatePath = internaltls.AgentCAPath
	config.Tls.ServerCertificatePath = internaltls.AgentCertificatePath
	config.Tls.ServerPrivateKeyPath = internaltls.AgentKeyPath
	config.Tls.ExpectedClientCommonName = tlsIdentity.ClientCommonName
	configPath, err := manager.WriteAgentConfig(ctx, identity, config)
	if err != nil {
		t.Fatal(err)
	}
	controlPath, err := manager.WriteServiceControlConfig(ctx, identity, listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	contextDir := filepath.Join(directory, "works", "tls-context")
	if err := os.Mkdir(contextDir, 0755); err != nil {
		t.Fatal(err)
	}
	for _, child := range []string{"skills", "packages"} {
		if err := os.Mkdir(filepath.Join(contextDir, child), 0755); err != nil {
			t.Fatal(err)
		}
	}
	for name, value := range map[string]any{
		"config.json":   map[string]any{"skills": []any{}, "packages": []any{}, "agentsMdPath": "/run/piwork/AGENTS.md", "contextIdentity": "context-tls-fixture", "resolvedTools": []any{}, "tools": map[string]any{"allowed": []any{}, "denied": []any{}}, "mcpServers": []any{}},
		"metadata.json": map[string]any{"workId": identity.WorkID, "snapshotId": "context-tls-fixture", "skills": []any{}, "packageContractVersion": 1, "packageBindings": []any{}},
	} {
		raw, _ := json.Marshal(value)
		if err := os.WriteFile(filepath.Join(contextDir, name), raw, 0644); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(contextDir, "AGENTS.md"), []byte("TLS protocol acceptance fixture; no model request."), 0644); err != nil {
		t.Fatal(err)
	}
	labels, _ := scope.Labels()
	labels[WorkLabel] = identity.WorkID
	labels[KindLabel] = "agent"
	labels[LogicalLabel] = "agentd"
	labels["piwork.generation"] = "1"
	labels["piwork.instance_id"] = identity.InstanceID
	pids := int64(256)
	mounts := []mount.Mount{{Type: mount.TypeTmpfs, Target: "/var/data", TmpfsOptions: &mount.TmpfsOptions{Mode: 0777, SizeBytes: 64 << 20}}, {Type: mount.TypeTmpfs, Target: "/tmp", TmpfsOptions: &mount.TmpfsOptions{Mode: 01777, SizeBytes: 64 << 20}}}
	for source, target := range map[string]string{configPath: "/etc/piwork/runtime.json", controlPath: "/etc/piwork/service-control.json", tlsIdentity.CACertificatePath: "/etc/piwork/tls/installation-ca.crt", tlsIdentity.ServerCertificatePath: internaltls.AgentCertificatePath, tlsIdentity.ServerPrivateKeyPath: internaltls.AgentKeyPath, tlsIdentity.ServiceClientCertificatePath: "/etc/piwork/control/agent-service-client.crt", tlsIdentity.ServiceClientPrivateKeyPath: "/etc/piwork/control/agent-service-client.key", contextDir: "/run/piwork"} {
		mounts = append(mounts, mount.Mount{Type: mount.TypeBind, Source: source, Target: target, ReadOnly: true})
	}
	// The same CA is mounted at both retained Agent and MCP fixed locations.
	mounts = append(mounts, mount.Mount{Type: mount.TypeBind, Source: tlsIdentity.CACertificatePath, Target: "/etc/piwork/control/installation-ca.crt", ReadOnly: true})
	// Test the current retained harness source, even before task 3.9 rebuilds
	// native helper images. This read-only development mount changes no image.
	_, source, _, _ := goruntime.Caller(0)
	applicationPath := filepath.Join(filepath.Dir(source), "..", "..", "apps", "agentd", "dist", "application.js")
	if !nativeImage {
		if _, err := os.Stat(applicationPath); err != nil {
			t.Fatal("run make harness-fixtures before TLS integration", err)
		}
		mounts = append(mounts, mount.Mount{Type: mount.TypeBind, Source: applicationPath, Target: "/workspace/apps/agentd/dist/application.js", ReadOnly: true})
	}
	created, err := engine.api.ContainerCreate(ctx, client.ContainerCreateOptions{Name: scope.ID() + "-tls-agent", Config: &container.Config{Image: image.ID, User: "10001:10001", Labels: labels, Cmd: []string{"--config", "/etc/piwork/runtime.json"}, WorkingDir: "/workspace"}, HostConfig: &container.HostConfig{ReadonlyRootfs: true, CapDrop: []string{"ALL"}, SecurityOpt: []string{"no-new-privileges:true"}, Resources: container.Resources{Memory: 512 << 20, NanoCPUs: 1e9, PidsLimit: &pids}, Mounts: mounts, NetworkMode: container.NetworkMode(bridge.Name)}, NetworkingConfig: &network.NetworkingConfig{EndpointsConfig: map[string]*network.EndpointSettings{bridge.Name: {}}}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := engine.api.ContainerStart(ctx, created.ID, client.ContainerStartOptions{}); err != nil {
		t.Fatal(err)
	}
	containerIdentity := ContainerIdentity{WorkID: identity.WorkID, Kind: "agent", LogicalID: "agentd", Labels: map[string]string{"piwork.generation": "1", "piwork.instance_id": identity.InstanceID}}
	address, err := runtime.ContainerAddress(ctx, containerIdentity, bridge.Name)
	if err != nil {
		t.Fatal(err)
	}
	clientTLS, err := manager.AgentClientConfig(ctx, identity)
	if err != nil {
		t.Fatal(err)
	}
	connection, err := grpc.NewClient(net.JoinHostPort(address, "7443"), grpc.WithTransportCredentials(credentials.NewTLS(clientTLS)))
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	agent := agentv1.NewAgentServiceClient(connection)
	var ready *agentv1.ReadinessResponse
	for {
		call, cancel := context.WithTimeout(ctx, time.Second)
		ready, err = agent.Readiness(call, &agentv1.ReadinessRequest{WorkId: identity.WorkID, Generation: uint64(identity.Generation), InstanceId: identity.InstanceID})
		cancel()
		if err == nil {
			break
		}
		if ctx.Err() != nil {
			logs, _ := engine.api.ContainerLogs(context.Background(), created.ID, client.ContainerLogsOptions{ShowStdout: true, ShowStderr: true, Tail: "30"})
			if logs != nil {
				defer logs.Close()
				out := newTail(32768)
				Demultiplex(context.Background(), logs, out, out)
				t.Log(string(out.bytes))
			}
			t.Fatal("actual TS Agent readiness failed", err)
		}
		select {
		case <-time.After(100 * time.Millisecond):
		case <-ctx.Done():
		}
	}
	if ready.WorkId != identity.WorkID || ready.Generation != 1 || ready.InstanceId != identity.InstanceID || !ready.InitializationComplete || !ready.AcceptingRuns {
		t.Fatal("actual TS Agent identity/readiness mismatch")
	}
	wrongCtx, wrongCancel := context.WithTimeout(ctx, time.Second)
	_, err = agent.Readiness(wrongCtx, &agentv1.ReadinessRequest{WorkId: identity.WorkID, Generation: 2, InstanceId: identity.InstanceID})
	wrongCancel()
	if err == nil {
		t.Fatal("TS Agent accepted wrong request generation")
	}
	// Keep the valid CN and chain, but sign a client with the wrong instance
	// URI. The actual TS Agent must reject it before running the RPC handler.
	caKeyPEM, _ := os.ReadFile(filepath.Join(directory, "runtime", "pki", "installation-ca.key"))
	caPEM, _ := os.ReadFile(tlsIdentity.CACertificatePath)
	caKeyBlock, _ := pem.Decode(caKeyPEM)
	caBlock, _ := pem.Decode(caPEM)
	caKey, err := x509.ParsePKCS1PrivateKey(caKeyBlock.Bytes)
	if err != nil {
		t.Fatal(err)
	}
	ca, err := x509.ParseCertificate(caBlock.Bytes)
	if err != nil {
		t.Fatal(err)
	}
	clientLeaf, err := x509.ParseCertificate(clientTLS.Certificates[0].Certificate[0])
	if err != nil {
		t.Fatal(err)
	}
	other := identity
	other.InstanceID = "agent-wrong-instance"
	uri, _ := url.Parse(other.URI(internaltls.CoreClient))
	clientLeaf.URIs = []*url.URL{uri}
	clientKey := clientTLS.Certificates[0].PrivateKey
	signer, ok := clientKey.(crypto.Signer)
	if !ok {
		t.Fatal("client fixture key has no public key")
	}
	der, err := x509.CreateCertificate(rand.Reader, clientLeaf, ca, signer.Public(), caKey)
	if err != nil {
		t.Fatal(err)
	}
	wrongTLS := clientTLS.Clone()
	wrongTLS.Certificates = []tls.Certificate{{Certificate: [][]byte{der}, PrivateKey: clientKey}}
	wrongConnection, err := grpc.NewClient(net.JoinHostPort(address, "7443"), grpc.WithTransportCredentials(credentials.NewTLS(wrongTLS)))
	if err != nil {
		t.Fatal(err)
	}
	defer wrongConnection.Close()
	wrongCtx, wrongCancel = context.WithTimeout(ctx, 3*time.Second)
	_, err = agentv1.NewAgentServiceClient(wrongConnection).Readiness(wrongCtx, &agentv1.ReadinessRequest{WorkId: identity.WorkID, Generation: 1, InstanceId: identity.InstanceID})
	wrongCancel()
	if status.Code(err) != codes.Unauthenticated {
		t.Fatal("actual TS Agent accepted wrong-instance TLS client", err)
	}
	// A real TS grpc-js/ts-proto client calls the native Go listener. Its next
	// call on the same channel must lose authorization immediately.
	program := `import {readFileSync} from 'node:fs';
import {ChannelCredentials} from '/workspace/node_modules/@grpc/grpc-js/build/src/index.js';
import {WorkServicesClient} from '/workspace/packages/contracts/dist/index.js';
const {serviceControl:c}=JSON.parse(readFileSync('/etc/piwork/service-control.json','utf8'));
const client=new WorkServicesClient(c.endpoint,ChannelCredentials.createSsl(readFileSync(c.caCertificatePath),readFileSync(c.clientPrivateKeyPath),readFileSync(c.clientCertificatePath)),{'grpc.ssl_target_name_override':c.serverName,'grpc.default_authority':c.serverName});
const invoke=()=>new Promise(resolve=>client.getDeploymentContext({},(error,response)=>resolve({error,response})));
const first=await invoke();if(first.error||first.response.workId!=='work-tls-fixture')throw new Error('first authenticated call failed');
const second=await invoke();if(!second.error||second.error.code!==9)throw new Error('stale connection remained authorized');
client.close();process.stdout.write(JSON.stringify({first:true,staleCode:second.error.code})+'\n');`
	execResult, err := engine.api.ExecCreate(ctx, created.ID, client.ExecCreateOptions{Cmd: []string{"node", "--input-type=module", "-e", program}, AttachStdout: true, AttachStderr: true, User: "10001:10001"})
	if err != nil {
		t.Fatal(err)
	}
	attached, err := engine.api.ExecAttach(ctx, execResult.ID, client.ExecAttachOptions{})
	if err != nil {
		t.Fatal(err)
	}
	defer attached.Close()
	stop := context.AfterFunc(ctx, func() { attached.Close() })
	defer stop()
	stdout, stderr := newTail(65536), newTail(65536)
	if err := Demultiplex(ctx, attached.Reader, stdout, stderr); err != nil {
		t.Fatal(err)
	}
	state, err := engine.api.ExecInspect(ctx, execResult.ID, client.ExecInspectOptions{})
	if err != nil || state.Running || state.ExitCode != 0 {
		t.Fatalf("TS reverse RPC fixture failed: %v, stderr: %s", err, stderr.bytes)
	}
	if strings.TrimSpace(string(stdout.bytes)) != `{"first":true,"staleCode":9}` {
		t.Fatal("TS reverse RPC result mismatch")
	}
	select {
	case principal := <-fixture.called:
		if principal != identity {
			t.Fatal("principal scope mismatch")
		}
	default:
		t.Fatal("native listener did not authorize TS caller")
	}
	t.Logf("Go→real TS Agent ready; TS→Go authenticated; same-channel stale RPC rejected; image=%s", image.ID)
}
