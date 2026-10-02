package dockerengine

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeConfig(t *testing.T, dir, content string) {
	t.Helper()
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "config.json"), []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
}
func writeContext(t *testing.T, dir, name, host string) {
	t.Helper()
	digest := sha256.Sum256([]byte(name))
	target := filepath.Join(dir, "contexts", "meta", hex.EncodeToString(digest[:]))
	if err := os.MkdirAll(target, 0700); err != nil {
		t.Fatal(err)
	}
	value := map[string]any{"Name": name, "Endpoints": map[string]any{"docker": map[string]any{"Host": host, "SkipTLSVerify": false}}}
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(target, "meta.json"), data, 0600); err != nil {
		t.Fatal(err)
	}
}
func TestDockerEndpointPrecedenceAndNoFallback(t *testing.T) {
	dir := t.TempDir()
	writeConfig(t, dir, `{"currentContext":"rootless"}`)
	writeContext(t, dir, "rootless", "unix:///run/user/1000/docker.sock")
	writeContext(t, dir, "explicit", "unix:///tmp/selected.sock")
	writeContext(t, dir, "remote", "ssh://secret@remote")
	cases := []struct {
		name, context, host, want string
		wantErr                   error
	}{
		{"explicit context", "explicit", "unix:///tmp/env.sock", "unix:///tmp/selected.sock", nil},
		{"explicit host", "", "unix:///tmp/env.sock", "unix:///tmp/env.sock", nil},
		{"configured rootless", "", "", "unix:///run/user/1000/docker.sock", nil},
		{"explicit default", "default", "unix:///tmp/env.sock", "unix:///var/run/docker.sock", nil},
		{"unknown context", "unknown", "unix:///var/run/docker.sock", "", ErrUnknownContext},
		{"remote context", "remote", "unix:///var/run/docker.sock", "", ErrEndpoint},
		{"remote host", "", "tcp://secret:password@remote:2375", "", ErrEndpoint},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			endpoint, err := SelectEndpoint(SelectionOptions{DockerConfig: dir, DockerContext: tc.context, DockerHost: tc.host})
			if !errors.Is(err, tc.wantErr) || (err == nil && endpoint.Host != tc.want) {
				t.Fatal(endpoint, err)
			}
			if err != nil && (strings.Contains(err.Error(), "secret") || strings.Contains(err.Error(), "password")) {
				t.Fatal("unsafe dependency error")
			}
		})
	}
	writeConfig(t, dir, `{"currentContext":"missing"}`)
	if _, err := SelectEndpoint(SelectionOptions{DockerConfig: dir}); !errors.Is(err, ErrUnknownContext) {
		t.Fatal(err)
	}
	writeConfig(t, dir, `{"currentContext":"rootless","currentContext":"default"}`)
	if _, err := SelectEndpoint(SelectionOptions{DockerConfig: dir}); !errors.Is(err, ErrConfiguration) {
		t.Fatal(err)
	}
	endpoint, err := SelectEndpoint(SelectionOptions{HomeDirectory: t.TempDir()})
	if err != nil || endpoint.Host != "unix:///var/run/docker.sock" {
		t.Fatal(endpoint, err)
	}
}
func TestDockerLocalEndpointValidation(t *testing.T) {
	for _, host := range []string{"tcp://127.0.0.1:2375", "ssh://localhost", "npipe:////./pipe/docker_engine", "unix://remote/socket", "unix:///", "unix:///tmp/a?secret=token", "unix:///tmp/a#fragment", "unix:///tmp/%00socket", "relative", "unix:///tmp/a\n"} {
		if _, err := ValidateLocalEndpoint(host); !errors.Is(err, ErrEndpoint) {
			t.Fatal(host, err)
		}
	}
	actual, err := ValidateLocalEndpoint("unix:///run/user/1000/docker.sock")
	if err != nil || actual != "unix:///run/user/1000/docker.sock" {
		t.Fatal(actual, err)
	}
}
func unixEngineFixture(t *testing.T, pingVersion, minVersion, osType string) *Endpoint {
	t.Helper()
	path := shortEngineSocket(t, "engine.sock")
	listener, err := net.Listen("unix", path)
	if err != nil {
		t.Fatal(err)
	}
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/_ping" {
			w.Header().Set("API-Version", pingVersion)
			w.WriteHeader(http.StatusOK)
			return
		}
		if strings.HasSuffix(r.URL.Path, "/version") {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]string{"ApiVersion": pingVersion, "MinAPIVersion": minVersion, "Os": osType, "Arch": "amd64", "Version": "fixture"})
			return
		}
		http.NotFound(w, r)
	})
	server := &http.Server{Handler: handler}
	go server.Serve(listener)
	t.Cleanup(func() { server.Close(); listener.Close() })
	return &Endpoint{Host: "unix://" + path, ConfigDirectory: t.TempDir()}
}
func TestEngineAPINegotiationAndSocketRefusal(t *testing.T) {
	t.Setenv("DOCKER_API_VERSION", "99.99")
	endpoint := unixEngineFixture(t, "1.51", "1.44", "linux")
	engine, err := Connect(context.Background(), *endpoint)
	if err != nil {
		t.Fatal(err)
	}
	defer engine.Close()
	if engine.APIVersion != "1.51" {
		t.Fatal(engine.APIVersion)
	}
	for _, tc := range []struct{ max, min, os string }{{"1.20", "1.10", "linux"}, {"1.51", "1.99", "linux"}, {"1.51", "1.44", "windows"}, {"bad", "1.44", "linux"}, {"", "1.44", "linux"}} {
		endpoint := unixEngineFixture(t, tc.max, tc.min, tc.os)
		if _, err := Connect(context.Background(), *endpoint); !errors.Is(err, ErrAPIVersion) {
			t.Fatal(tc, err)
		}
	}
	if _, err := Connect(context.Background(), Endpoint{Host: "unix://" + filepath.Join(t.TempDir(), "missing.sock")}); !errors.Is(err, ErrUnavailable) {
		t.Fatal(err)
	}
	endpoint = unixEngineFixture(t, "1.51", "1.44", "linux")
	path := strings.TrimPrefix(endpoint.Host, "unix://")
	if err := os.Chmod(path, 0000); err != nil {
		t.Fatal(err)
	}
	defer os.Chmod(path, 0600)
	if _, err := Connect(context.Background(), *endpoint); !errors.Is(err, ErrUnavailable) {
		t.Fatal("inaccessible socket accepted", err)
	}
}
func TestStaticRegistryAuthenticationAndUnsupportedHelpers(t *testing.T) {
	dir := t.TempDir()
	secret := base64.StdEncoding.EncodeToString([]byte("user:secret-password"))
	writeConfig(t, dir, `{"auths":{"https://index.docker.io/v1/":{"auth":"`+secret+`"}},"credHelpers":{"other.example":"does-not-run"}}`)
	encoded, err := RegistryAuth(dir, "python:3.13-slim")
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := base64.URLEncoding.DecodeString(encoded)
	if err != nil {
		t.Fatal(err)
	}
	var auth map[string]string
	if json.Unmarshal(decoded, &auth) != nil || auth["username"] != "user" || auth["password"] != "secret-password" || auth["serveraddress"] != "https://index.docker.io/v1/" {
		t.Fatal("static auth did not round trip")
	}
	// No helper executable is invoked even when Docker would have selected it.
	t.Setenv("PATH", filepath.Join(dir, "no-tools"))
	for _, config := range []string{`{"credHelpers":{"https://index.docker.io/v1/":"secret-helper"}}`, `{"credsStore":"secret-helper"}`} {
		writeConfig(t, dir, config)
		_, err := RegistryAuth(dir, "python:3.13-slim")
		if !errors.Is(err, ErrCredentialHelper) || strings.Contains(err.Error(), "secret-helper") {
			t.Fatal(err)
		}
	}
	writeConfig(t, dir, `{"credHelpers":{"unrelated.example":"secret-helper"}}`)
	encoded, err = RegistryAuth(dir, "python:3.13-slim")
	if err != nil || encoded != "" {
		t.Fatal(err)
	}
	writeConfig(t, dir, `{"auths":{"docker.io":{"auth":"secret-invalid-base64"}}}`)
	if _, err := RegistryAuth(dir, "python:3.13-slim"); !errors.Is(err, ErrRegistryAuth) || strings.Contains(err.Error(), "secret") {
		t.Fatal(err)
	}
	writeConfig(t, dir, `{"auths":{"docker.io":{"username":"user","password":"one"},"https://index.docker.io/v1/":{"username":"user","password":"different"}}}`)
	if _, err := RegistryAuth(dir, "python:3.13-slim"); !errors.Is(err, ErrRegistryAuth) {
		t.Fatal(err)
	}
	writeConfig(t, dir, `{"auths":{"registry.example:5000":{"identitytoken":"private-token"}}}`)
	encoded, err = RegistryAuth(dir, "registry.example:5000/team/app:v1")
	if err != nil || encoded == "" {
		t.Fatal(err)
	}
}
