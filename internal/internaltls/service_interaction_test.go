package internaltls

import (
	"bytes"
	"context"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestServiceInteractionConfigIsPrivateImmutableAndRotatesIndependently(t *testing.T) {
	m, _, scope := fixtureManager(t)
	ctx := context.Background()
	generation, err := m.EnsureGeneration(ctx, scope)
	if err != nil {
		t.Fatal(err)
	}
	certRaw, _ := os.ReadFile(generation.ServerCertificatePath)
	block, _ := pem.Decode(certRaw)
	cert, err := x509.ParseCertificate(block.Bytes)
	if err != nil || cert.VerifyHostname("agentd") != nil {
		t.Fatal("private feedback hostname is not certified", err)
	}
	config, ca, err := m.WriteServiceInteractionConfig(ctx, scope.WorkID, "service-1111111111111111", "todo", strings.Repeat("a", 64))
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(config)
	if err != nil {
		t.Fatal(err)
	}
	var view map[string]any
	if json.Unmarshal(raw, &view) != nil || view["agentUrl"] != "https://agentd:7444" || view["serviceName"] != "todo" || len(view) != 7 {
		t.Fatal(view)
	}
	caRaw, _ := os.ReadFile(ca)
	expected, _ := os.ReadFile(generation.CACertificatePath)
	if !bytes.Equal(caRaw, expected) {
		t.Fatal("cross installation authority")
	}
	repeated, _, err := m.WriteServiceInteractionConfig(ctx, scope.WorkID, "service-1111111111111111", "todo", strings.Repeat("a", 64))
	if err != nil || repeated != config {
		t.Fatal(err)
	}
	rotated, _, err := m.WriteServiceInteractionConfig(ctx, scope.WorkID, "service-1111111111111111", "todo", strings.Repeat("b", 64))
	if err != nil || rotated == config {
		t.Fatal("rotation replaced mounted identity", err)
	}
	old, _ := os.ReadFile(config)
	if !bytes.Equal(old, raw) {
		t.Fatal("old bind contents changed")
	}
	for _, file := range []string{config, ca, rotated} {
		info, err := os.Lstat(file)
		if err != nil || info.Mode().Perm() != 0644 {
			t.Fatal("container material not readable", err)
		}
		parent, _ := os.Lstat(filepath.Dir(file))
		if parent.Mode().Perm() != 0700 {
			t.Fatal("host secret parent not private")
		}
	}
	if _, _, err = m.WriteServiceInteractionConfig(ctx, "../other", "service-1111111111111111", "todo", strings.Repeat("b", 64)); err == nil {
		t.Fatal("unsafe scope accepted")
	}
	if _, _, err = m.WriteServiceInteractionConfig(ctx, scope.WorkID, "service-1111111111111111", "todo", "short"); err == nil {
		t.Fatal("invalid token accepted")
	}
	if err = os.WriteFile(config, []byte("{}"), 0644); err != nil {
		t.Fatal(err)
	}
	if _, _, err = m.WriteServiceInteractionConfig(ctx, scope.WorkID, "service-1111111111111111", "todo", strings.Repeat("a", 64)); err == nil {
		t.Fatal("tampered material silently repaired")
	}
}
