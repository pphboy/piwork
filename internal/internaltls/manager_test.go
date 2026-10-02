package internaltls

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"piwork/internal/contracts"
	"piwork/internal/corestore"
)

func fixtureManager(t *testing.T) (*Manager, *corestore.Store, Scope) {
	t.Helper()
	store, err := corestore.Open(context.Background(), corestore.Options{Directory: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	m, err := Open(filepath.Join(t.TempDir(), "runtime"), store)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { m.Close() })
	return m, store, Scope{InstallationID: store.InstallationID(), WorkID: "work-11111111-1111-4111-8111-111111111111", Generation: 1, InstanceID: "agent-22222222-2222-4222-8222-222222222222"}
}

func TestNativeMaterialPersistencePermissionsAndConfig(t *testing.T) {
	t.Setenv("PATH", filepath.Join(t.TempDir(), "no-openssl"))
	ctx := context.Background()
	directory := t.TempDir()
	store, err := corestore.Open(ctx, corestore.Options{Directory: directory})
	if err != nil {
		t.Fatal(err)
	}
	m, err := Open(filepath.Join(directory, "runtime"), store)
	if err != nil {
		t.Fatal(err)
	}
	scope := Scope{InstallationID: store.InstallationID(), WorkID: "work-native", Generation: 2, InstanceID: "agent-native"}
	identity, err := m.EnsureGeneration(ctx, scope)
	if err != nil {
		t.Fatal(err)
	}
	core, err := m.EnsureCoreService(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for path, mode := range map[string]os.FileMode{identity.CACertificatePath: 0644, identity.ServerCertificatePath: 0644, identity.ServerPrivateKeyPath: 0644, identity.ServiceClientCertificatePath: 0644, identity.ServiceClientPrivateKeyPath: 0644, identity.ClientCertificatePath: 0600, identity.ClientPrivateKeyPath: 0600, core.ServerCertificatePath: 0600, core.ServerPrivateKeyPath: 0600, filepath.Join(directory, "runtime", "pki", "installation-ca.key"): 0600} {
		info, err := os.Lstat(path)
		if err != nil || !info.Mode().IsRegular() || info.Mode().Perm() != mode {
			t.Fatalf("material mode %s: %v", filepath.Base(path), err)
		}
		parent, err := os.Lstat(filepath.Dir(path))
		if err != nil || parent.Mode().Perm() != 0700 {
			t.Fatal("material parent is not private")
		}
	}
	before, _ := os.ReadFile(identity.ServerCertificatePath)
	var group sync.WaitGroup
	failures := make(chan error, 8)
	for range 8 {
		group.Add(1)
		go func() { defer group.Done(); _, err := m.EnsureGeneration(ctx, scope); failures <- err }()
	}
	group.Wait()
	close(failures)
	for err := range failures {
		if err != nil {
			t.Fatal(err)
		}
	}
	config := agentConfig(scope)
	configPath, err := m.WriteAgentConfig(ctx, scope, config)
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Base(configPath) != "agent-config.json" {
		t.Fatal("changed mount config name")
	}
	if _, err := m.WriteServiceControlConfig(ctx, scope, "piwork-core:7172"); err != nil {
		t.Fatal(err)
	}
	config.InstanceId = "agent-other"
	if _, err := m.WriteAgentConfig(ctx, scope, config); !errors.Is(err, ErrIdentity) {
		t.Fatal("wrong runtime config accepted", err)
	}
	m.Close()
	store.Close()
	store, err = corestore.Open(ctx, corestore.Options{Directory: directory})
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	m, err = Open(filepath.Join(directory, "runtime"), store)
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close()
	reopened, err := m.EnsureGeneration(ctx, scope)
	if err != nil {
		t.Fatal(err)
	}
	after, _ := os.ReadFile(reopened.ServerCertificatePath)
	if !bytes.Equal(before, after) {
		t.Fatal("reopen changed the durable identity")
	}
	other := scope
	other.InstanceID = "agent-other"
	if _, err := m.EnsureGeneration(ctx, other); !errors.Is(err, ErrMaterial) {
		t.Fatal("generation rebound to another instance", err)
	}
}

func agentConfig(scope Scope) contracts.AgentRuntimeConfig {
	config := contracts.AgentRuntimeConfig{Version: 1, WorkId: scope.WorkID, Generation: scope.Generation, InstanceId: scope.InstanceID, Listen: "0.0.0.0:7443", DataDirectory: "/var/data", Deterministic: true}
	config.Model.Provider = "piwork-deterministic"
	config.Model.Id = "fixture-v1"
	config.Tls.CaCertificatePath = AgentCAPath
	config.Tls.ServerCertificatePath = AgentCertificatePath
	config.Tls.ServerPrivateKeyPath = AgentKeyPath
	config.Tls.ExpectedClientCommonName = scope.commonName(CoreClient)
	return config
}

func TestNativeTLSRecoversCommittedAndPartiallyPublishedIdentities(t *testing.T) {
	for _, boundary := range []string{"bundle-committed", "file-published"} {
		t.Run(boundary, func(t *testing.T) {
			m, store, scope := fixtureManager(t)
			injected := errors.New("interrupted")
			m.fault = func(stage string) error {
				if stage == boundary {
					return injected
				}
				return nil
			}
			if _, err := m.EnsureGeneration(context.Background(), scope); !errors.Is(err, injected) {
				t.Fatal(err)
			}
			m.Close()
			m, err := Open(m.directory, store)
			if err != nil {
				t.Fatal(err)
			}
			defer m.Close()
			if _, err := m.EnsureGeneration(context.Background(), scope); err != nil {
				t.Fatal(err)
			}
			// Rotate all three leaf pairs under a single durable bundle. Fail
			// after one new PEM projection, leaving both old and new files.
			now := time.Now().Add(31 * 24 * time.Hour)
			m.now = func() time.Time { return now }
			m.fault = func(stage string) error {
				if stage == "file-published" {
					return injected
				}
				return nil
			}
			if _, err := m.EnsureGeneration(context.Background(), scope); !errors.Is(err, injected) {
				t.Fatal(err)
			}
			m.Close()
			m, err = Open(m.directory, store)
			if err != nil {
				t.Fatal(err)
			}
			defer m.Close()
			m.now = func() time.Time { return now }
			identity, err := m.EnsureGeneration(context.Background(), scope)
			if err != nil {
				t.Fatal(err)
			}
			for _, pair := range [][2]string{{identity.ServerCertificatePath, identity.ServerPrivateKeyPath}, {identity.ClientCertificatePath, identity.ClientPrivateKeyPath}, {identity.ServiceClientCertificatePath, identity.ServiceClientPrivateKeyPath}} {
				cert, _ := os.ReadFile(pair[0])
				key, _ := os.ReadFile(pair[1])
				parsed, _, err := parsePair(keyPair{string(cert), string(key)})
				if err != nil || now.Before(parsed.NotBefore) || !now.Before(parsed.NotAfter) {
					t.Fatal("rotation did not recover a complete current pair", err)
				}
			}
		})
	}
}

func TestNativeTLSRefusesForeignFilesAndUnsafeLinks(t *testing.T) {
	for _, kind := range []string{"symlink", "hardlink", "mode", "bytes", "pending"} {
		t.Run(kind, func(t *testing.T) {
			m, _, scope := fixtureManager(t)
			identity, err := m.EnsureGeneration(context.Background(), scope)
			if err != nil {
				t.Fatal(err)
			}
			path := identity.ClientPrivateKeyPath
			foreign := filepath.Join(t.TempDir(), "untouched")
			original := []byte("external private bytes")
			if err := os.WriteFile(foreign, original, 0600); err != nil {
				t.Fatal(err)
			}
			switch kind {
			case "symlink":
				os.Remove(path)
				if err := os.Symlink(foreign, path); err != nil {
					t.Fatal(err)
				}
			case "hardlink":
				os.Remove(path)
				if err := os.Link(foreign, path); err != nil {
					t.Fatal(err)
				}
			case "mode":
				if err := os.Chmod(path, 0644); err != nil {
					t.Fatal(err)
				}
			case "bytes":
				if err := os.WriteFile(path, original, 0600); err != nil {
					t.Fatal(err)
				}
			case "pending":
				if err := os.WriteFile(filepath.Join(filepath.Dir(path), ".core-client.key.pending"), original, 0600); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := m.EnsureGeneration(context.Background(), scope); !errors.Is(err, ErrMaterial) {
				t.Fatal("unsafe material accepted", err)
			}
			after, _ := os.ReadFile(foreign)
			if !bytes.Equal(original, after) {
				t.Fatal("foreign bytes modified")
			}
		})
	}
}

func TestNativeTLSRecoversKnownPendingProjectionAndRejectsExpiredCA(t *testing.T) {
	m, store, scope := fixtureManager(t)
	identity, err := m.EnsureGeneration(context.Background(), scope)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := os.ReadFile(identity.ServerPrivateKeyPath)
	path := filepath.Join(filepath.Dir(identity.ServerPrivateKeyPath), ".agent-server.key.pending")
	if err := os.WriteFile(path, raw[:37], 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := m.EnsureGeneration(context.Background(), scope); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Lstat(path); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("known temporary remained")
	}
	now := time.Now().Add(3651 * 24 * time.Hour)
	m.now = func() time.Time { return now }
	before, _ := store.TLSMaterial(context.Background(), "internal_tls/authority")
	if _, err := m.EnsureCoreService(context.Background()); !errors.Is(err, ErrExpired) {
		t.Fatal("expired authority accepted or replaced", err)
	}
	after, _ := store.TLSMaterial(context.Background(), "internal_tls/authority")
	if !bytes.Equal(before, after) {
		t.Fatal("expired CA was silently replaced")
	}
}

func handshakes(clientConfig, serverConfig *tls.Config) (error, error) {
	left, right := net.Pipe()
	client, server := tls.Client(left, clientConfig), tls.Server(right, serverConfig)
	deadline := time.Now().Add(3 * time.Second)
	client.SetDeadline(deadline)
	server.SetDeadline(deadline)
	serverResult := make(chan error, 1)
	go func() { serverResult <- server.Handshake(); right.Close() }()
	err := client.Handshake()
	left.Close()
	return err, <-serverResult
}

func TestNativeMutualTLSRejectsWrongSANRoleGenerationAndExpiry(t *testing.T) {
	m, _, scope := fixtureManager(t)
	ctx := context.Background()
	clientConfig, err := m.ServiceClientConfig(ctx, scope)
	if err != nil {
		t.Fatal(err)
	}
	serverConfig, err := m.CoreServerConfig(ctx, func(candidate Scope) bool { return candidate == scope })
	if err != nil {
		t.Fatal(err)
	}
	if clientErr, serverErr := handshakes(clientConfig, serverConfig); clientErr != nil || serverErr != nil {
		t.Fatal("valid mutual TLS failed", clientErr, serverErr)
	}
	ca, err := m.authority(ctx)
	if err != nil {
		t.Fatal(err)
	}
	caCert, caKey, _ := parsePair(ca)
	for _, kind := range []string{"san", "role", "work", "installation", "generation", "instance", "expired", "missing-client"} {
		t.Run(kind, func(t *testing.T) {
			config := clientConfig.Clone()
			if kind == "missing-client" {
				config.Certificates = nil
			} else {
				pair, err := issueLeaf(ca, scope, AgentServiceClient, time.Now())
				if err != nil {
					t.Fatal(err)
				}
				template, _, _ := parsePair(pair)
				template.RawSubject = nil
				other := scope
				switch kind {
				case "san":
					template.URIs = nil
				case "role":
					template.Subject.CommonName = "core-client"
				case "work":
					other.WorkID = "work-other"
				case "installation":
					other.InstallationID = "installation-other"
				case "generation":
					other.Generation++
				case "instance":
					other.InstanceID = "agent-other"
				case "expired":
					template.NotBefore = time.Now().Add(-2 * time.Hour)
					template.NotAfter = time.Now().Add(-time.Hour)
				}
				if kind != "san" {
					uri, _ := url.Parse(other.URI(AgentServiceClient))
					template.URIs = []*url.URL{uri}
				}
				pair, err = makePair(template, caCert, caKey)
				if err != nil {
					t.Fatal(err)
				}
				cert, err := certificatePair(pair)
				if err != nil {
					t.Fatal(err)
				}
				config.Certificates = []tls.Certificate{cert}
			}
			_, serverErr := handshakes(config, serverConfig)
			if serverErr == nil {
				t.Fatal("invalid identity authorized")
			}
		})
	}
	// A stale identity is rejected independently of cryptographic validity.
	serverConfig, err = m.CoreServerConfig(ctx, func(Scope) bool { return false })
	if err != nil {
		t.Fatal(err)
	}
	_, serverErr := handshakes(clientConfig, serverConfig)
	if !errors.Is(serverErr, ErrStale) {
		t.Fatal("stale generation accepted", serverErr)
	}
	peer, _ := x509.ParseCertificate(clientConfig.Certificates[0].Certificate[0])
	if _, err := AuthorizeServicePeer(peer, scope.InstallationID, func(Scope) bool { return false }); !errors.Is(err, ErrStale) {
		t.Fatal("existing connection escaped per-RPC fence", err)
	}
}

func TestNativeAgentClientVerifiesFullServerIdentity(t *testing.T) {
	m, _, scope := fixtureManager(t)
	ctx := context.Background()
	clientConfig, err := m.AgentClientConfig(ctx, scope)
	if err != nil {
		t.Fatal(err)
	}
	_, ca, b, err := m.generation(ctx, scope)
	if err != nil {
		t.Fatal(err)
	}
	serverCert, _ := certificatePair(b.Pairs[AgentServer])
	pool, _ := roots(ca)
	serverConfig := &tls.Config{MinVersion: tls.VersionTLS12, Certificates: []tls.Certificate{serverCert}, ClientCAs: pool, ClientAuth: tls.RequireAndVerifyClientCert, VerifyConnection: func(state tls.ConnectionState) error { return verifyRole(state.PeerCertificates[0], scope, CoreClient) }}
	if ce, se := handshakes(clientConfig, serverConfig); ce != nil || se != nil {
		t.Fatal(ce, se)
	}
	caCert, caKey, _ := parsePair(ca)
	for _, kind := range []string{"dns", "uri", "role", "instance"} {
		t.Run(kind, func(t *testing.T) {
			template, _, _ := parsePair(b.Pairs[AgentServer])
			template.RawSubject = nil
			switch kind {
			case "dns":
				template.DNSNames = []string{"other.piwork"}
			case "uri":
				template.URIs = nil
			case "role":
				template.Subject.CommonName = "piwork-core"
			case "instance":
				other := scope
				other.InstanceID = "agent-other"
				uri, _ := url.Parse(other.URI(AgentServer))
				template.URIs = []*url.URL{uri}
			}
			pair, err := makePair(template, caCert, caKey)
			if err != nil {
				t.Fatal(err)
			}
			cert, _ := certificatePair(pair)
			server := serverConfig.Clone()
			server.Certificates = []tls.Certificate{cert}
			ce, _ := handshakes(clientConfig, server)
			if ce == nil {
				t.Fatal(fmt.Sprintf("invalid Agent server %s accepted", kind))
			}
		})
	}
}
