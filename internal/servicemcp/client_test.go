package servicemcp

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"piwork/internal/corestore"
	"piwork/internal/internaltls"
	"testing"
)

func TestControlledConfigAndFilesFailSafely(t *testing.T) {
	t.Setenv("PATH", filepath.Join(t.TempDir(), "no-runtime-tools"))
	store, err := corestore.Open(context.Background(), corestore.Options{Directory: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	manager, err := internaltls.Open(filepath.Join(t.TempDir(), "runtime"), store)
	if err != nil {
		t.Fatal(err)
	}
	defer manager.Close()
	scope := internaltls.Scope{InstallationID: store.InstallationID(), WorkID: "work-mcp", Generation: 1, InstanceID: "agent-mcp"}
	identity, err := manager.EnsureGeneration(context.Background(), scope)
	if err != nil {
		t.Fatal(err)
	}
	configPath, err := manager.WriteServiceControlConfig(context.Background(), scope, "127.0.0.1:17443")
	if err != nil {
		t.Fatal(err)
	}
	config, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "control"), 0700); err != nil {
		t.Fatal(err)
	}
	for source, target := range map[string]string{identity.CACertificatePath: "installation-ca.crt", identity.ServiceClientCertificatePath: "agent-service-client.crt", identity.ServiceClientPrivateKeyPath: "agent-service-client.key"} {
		raw, err := os.ReadFile(source)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(root, "control", target), raw, 0644); err != nil {
			t.Fatal(err)
		}
	}
	write := func(raw []byte) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(root, "service-control.json"), raw, 0644); err != nil {
			t.Fatal(err)
		}
	}
	write(config)
	client, connection, err := loadClient(root)
	if err != nil || client == nil {
		t.Fatal("valid controlled config rejected", err)
	}
	connection.Close()
	for _, name := range []string{"unknown", "endpoint", "serverName", "path", "missing"} {
		t.Run(name, func(t *testing.T) {
			var object map[string]any
			if json.Unmarshal(config, &object) != nil {
				t.Fatal("fixture config invalid")
			}
			control := object["serviceControl"].(map[string]any)
			switch name {
			case "unknown":
				control["workId"] = "work-other"
			case "endpoint":
				control["endpoint"] = "https://private.invalid:17443"
			case "serverName":
				control["serverName"] = "other-core"
			case "path":
				control["clientPrivateKeyPath"] = "/core/private/secret"
			case "missing":
				delete(control, "caCertificatePath")
			}
			raw, _ := json.Marshal(object)
			write(raw)
			_, conn, err := loadClient(root)
			if conn != nil {
				conn.Close()
			}
			if !errors.Is(err, ErrInitialization) || err.Error() != ErrInitialization.Error() {
				t.Fatal("unsafe configuration accepted/diagnostic leaked", err)
			}
		})
	}
	for _, raw := range [][]byte{[]byte(`{"serviceControl":{},"serviceControl":{}}`), []byte(`null`), []byte(`{"serviceControl":{}} trailing`)} {
		write(raw)
		if _, conn, err := loadClient(root); err == nil {
			conn.Close()
			t.Fatal("invalid JSON config accepted")
		}
	}
	write(config)
	if err := os.Remove(filepath.Join(root, "service-control.json")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(configPath, filepath.Join(root, "service-control.json")); err != nil {
		t.Fatal(err)
	}
	if _, _, err := loadClient(root); !errors.Is(err, ErrInitialization) {
		t.Fatal("symlink configuration accepted", err)
	}
}
