package internaltls

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"os"
	"testing"
)

func TestImageServiceClientPEMRoleAndInstallation(t *testing.T) {
	manager, _, scope := fixtureManager(t)
	identity, err := manager.EnsureGeneration(context.Background(), scope)
	if err != nil {
		t.Fatal(err)
	}
	core, err := manager.EnsureCoreService(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	read := func(path string) []byte {
		t.Helper()
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		return raw
	}
	ca, certificate, key := read(identity.CACertificatePath), read(identity.ServiceClientCertificatePath), read(identity.ServiceClientPrivateKeyPath)
	client, err := ServiceClientFromPEM(ca, certificate, key)
	if err != nil || client.ServerName != "piwork-core" || client.MinVersion != tls.VersionTLS12 {
		t.Fatal("valid fixed-role client rejected", err)
	}
	if _, err := ServiceClientFromPEM(ca, read(identity.ServerCertificatePath), read(identity.ServerPrivateKeyPath)); !errors.Is(err, ErrIdentity) {
		t.Fatal("Agent server role accepted as client", err)
	}
	if _, err := ServiceClientFromPEM(ca, read(identity.ClientCertificatePath), read(identity.ClientPrivateKeyPath)); !errors.Is(err, ErrIdentity) {
		t.Fatal("Core client role accepted as MCP", err)
	}
	other, _, otherScope := fixtureManager(t)
	otherIdentity, err := other.EnsureGeneration(context.Background(), otherScope)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ServiceClientFromPEM(ca, read(otherIdentity.ServiceClientCertificatePath), read(otherIdentity.ServiceClientPrivateKeyPath)); err == nil {
		t.Fatal("foreign installation certificate accepted")
	}
	if _, err := ServiceClientFromPEM(append(ca, ca...), certificate, key); err == nil {
		t.Fatal("alternate CA chain accepted")
	}
	if _, err := ServiceClientFromPEM(ca, certificate, read(identity.ServerPrivateKeyPath)); err == nil {
		t.Fatal("mismatched private key accepted")
	}
	coreCert, err := tls.LoadX509KeyPair(core.ServerCertificatePath, core.ServerPrivateKeyPath)
	if err != nil {
		t.Fatal(err)
	}
	leaf, err := x509.ParseCertificate(coreCert.Certificate[0])
	if err != nil {
		t.Fatal(err)
	}
	if err := client.VerifyConnection(tls.ConnectionState{PeerCertificates: []*x509.Certificate{leaf}, VerifiedChains: [][]*x509.Certificate{{leaf}}}); err != nil {
		t.Fatal("Core server scope rejected", err)
	}
	wrong, err := x509.ParseCertificate(client.Certificates[0].Certificate[0])
	if err != nil {
		t.Fatal(err)
	}
	if err := client.VerifyConnection(tls.ConnectionState{PeerCertificates: []*x509.Certificate{wrong}, VerifiedChains: [][]*x509.Certificate{{wrong}}}); err == nil {
		t.Fatal("wrong Core server role accepted")
	}
}
