package internaltls

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestExistingAgentClientConfigDoesNotPublish(t *testing.T) {
	m, store, scope := fixtureManager(t)
	ctx := context.Background()
	identity, err := m.EnsureGeneration(ctx, scope)
	if err != nil {
		t.Fatal(err)
	}
	paths := []string{identity.CACertificatePath, identity.ServerCertificatePath, identity.ServerPrivateKeyPath, identity.ClientCertificatePath, identity.ClientPrivateKeyPath, identity.ServiceClientCertificatePath, identity.ServiceClientPrivateKeyPath}
	before := make(map[string][]byte, len(paths))
	for _, path := range paths {
		before[path], err = os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
	}
	key := "internal_tls/generation/" + scope.WorkID + "/1"
	bundle, err := store.TLSMaterial(ctx, key)
	if err != nil {
		t.Fatal(err)
	}
	m.fault = func(string) error { return errors.New("unexpected publication") }
	config, err := m.ExistingAgentClientConfig(ctx, scope)
	if err != nil || config.ServerName != scope.commonName(AgentServer) || len(config.Certificates) != 1 {
		t.Fatal("existing identity rejected", err)
	}
	server, _, err := parsePair(keyPair{Certificate: string(before[identity.ServerCertificatePath]), PrivateKey: string(before[identity.ServerPrivateKeyPath])})
	if err != nil || config.VerifyConnection(tls.ConnectionState{PeerCertificates: []*x509.Certificate{server}}) != nil {
		t.Fatal("server identity rejected", err)
	}
	other := scope
	other.InstanceID = "agent-other"
	if _, err := m.ExistingAgentClientConfig(ctx, other); !errors.Is(err, ErrMaterial) {
		t.Fatal("foreign instance accepted", err)
	}
	for _, path := range paths {
		after, err := os.ReadFile(path)
		if err != nil || !bytes.Equal(before[path], after) {
			t.Fatal("existing identity was rewritten", err)
		}
	}
	afterBundle, err := store.TLSMaterial(ctx, key)
	if err != nil || !bytes.Equal(bundle, afterBundle) {
		t.Fatal("durable identity was rewritten", err)
	}
}

func TestExistingAgentClientConfigRejectsExpiredAndDamagedMaterial(t *testing.T) {
	for _, kind := range []string{"expired", "damaged", "missing", "symlink"} {
		t.Run(kind, func(t *testing.T) {
			m, _, scope := fixtureManager(t)
			ctx := context.Background()
			identity, err := m.EnsureGeneration(ctx, scope)
			if err != nil {
				t.Fatal(err)
			}
			switch kind {
			case "expired":
				m.now = func() time.Time { return time.Now().Add(31 * 24 * time.Hour) }
			case "damaged":
				err = os.WriteFile(identity.ServerCertificatePath, []byte("damaged"), 0644)
			case "missing":
				err = os.Remove(identity.ServerCertificatePath)
			case "symlink":
				err = os.Remove(identity.ServerCertificatePath)
				if err == nil {
					err = os.Symlink(filepath.Join(t.TempDir(), "foreign"), identity.ServerCertificatePath)
				}
			}
			if err != nil {
				t.Fatal(err)
			}
			_, err = m.ExistingAgentClientConfig(ctx, scope)
			if kind == "expired" && !errors.Is(err, ErrExpired) || kind != "expired" && !errors.Is(err, ErrMaterial) {
				t.Fatal("invalid identity accepted", err)
			}
		})
	}
}
