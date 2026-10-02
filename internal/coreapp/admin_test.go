package coreapp

import (
	"context"
	"errors"
	"io"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"piwork/internal/contracts"
)

func TestAdminRuntimeReturnsSavedConfigurationWithUnavailableStatus(t *testing.T) {
	a, base, _ := appFixture(t, Options{Initialization: Initialization{Administrator: &struct{ Account, Password string }{"admin", "development-fixture-pass"}}, DependencyCheck: func(context.Context, *Application, RuntimeProfile) error {
		return errors.New("private backend diagnostic")
	}})
	login, err := a.Identity.Login(context.Background(), "admin", "development-fixture-pass", "fixture")
	if err != nil {
		t.Fatal(err)
	}
	status, body := httpCall(t, base, "/api/v1/admin/runtime", "PUT", "Bearer "+login.Token, map[string]any{"agentImage": "fixture/native", "provider": "fixture", "model": "saved", "credential": "private-api-key"})
	if status != 200 || body["status"].(map[string]any)["state"] != "RUNTIME_UNAVAILABLE" {
		t.Fatal("saved runtime was reported as a failed save", status, body)
	}
	runtime := body["runtime"].(map[string]any)
	if runtime["configured"] != true || runtime["revision"] != nil || runtime["credential"] != nil || strings.Contains(fmtJSON(body), "private-api-key") {
		t.Fatal("unsafe runtime projection", body)
	}
	status, current := httpCall(t, base, "/api/v1/admin/runtime", "GET", "Bearer "+login.Token, nil)
	if status != 200 || current["model"].(map[string]any)["id"] != "saved" {
		t.Fatal("saved configuration was not queryable", status, current)
	}
}

type gatedBody struct {
	source           io.Reader
	started, proceed chan struct{}
	entered          bool
}

func (b *gatedBody) Read(p []byte) (int, error) {
	if !b.entered {
		b.entered = true
		close(b.started)
		<-b.proceed
	}
	return b.source.Read(p)
}
func (*gatedBody) Close() error { return nil }

func TestAdminRevokedDuringBodyReadCannotPublishRuntimeOrCreateUser(t *testing.T) {
	for _, path := range []string{"/api/v1/admin/runtime", "/api/v1/admin/users"} {
		t.Run(path, func(t *testing.T) {
			a, _, _ := appFixture(t, Options{Initialization: Initialization{Administrator: &struct{ Account, Password string }{"admin", "development-fixture-pass"}}})
			login, err := a.Identity.Login(context.Background(), "admin", "development-fixture-pass", "fixture")
			if err != nil {
				t.Fatal(err)
			}
			method, raw := "PUT", `{"agentImage":"fixture/native","provider":"fixture","model":"one","credential":"private-api-key"}`
			if strings.HasSuffix(path, "/users") {
				method, raw = "POST", `{"account":"new-user","password":"development-fixture-pass"}`
			}
			body := &gatedBody{source: strings.NewReader(raw), started: make(chan struct{}), proceed: make(chan struct{})}
			request := httptest.NewRequest(method, path, body)
			request.Header.Set("Authorization", "Bearer "+login.Token)
			request.Header.Set("Content-Type", "application/json")
			finished := make(chan error, 1)
			go func() { finished <- a.handle(httptest.NewRecorder(), request) }()
			select {
			case <-body.started:
			case <-time.After(time.Second):
				t.Fatal("request was not authorized before reading body")
			}
			if err := a.Identity.Logout(context.Background(), login.Token); err != nil {
				t.Fatal(err)
			}
			close(body.proceed)
			var result error
			select {
			case result = <-finished:
			case <-time.After(3 * time.Second):
				t.Fatal("revoked request stalled")
			}
			status, public := contracts.ProjectError(result)
			if status != 401 || public.Code != "AUTHENTICATION_FAILED" {
				t.Fatal("stale admin session committed", result, public)
			}
			if _, configured, err := a.Settings.LoadRuntime(); err != nil || configured {
				t.Fatal("revoked request published configuration", err)
			}
			entries, err := os.ReadDir(filepath.Join(a.options.DataDirectory, "secrets"))
			if err != nil || len(entries) != 0 {
				t.Fatal("revoked configuration left staged secret", entries, err)
			}
		})
	}
}
func TestAdminEmptyActionAndMethodContract(t *testing.T) {
	a, base, _ := appFixture(t, Options{Initialization: Initialization{Administrator: &struct{ Account, Password string }{"admin", "development-fixture-pass"}}})
	login, err := a.Identity.Login(context.Background(), "admin", "development-fixture-pass", "fixture")
	if err != nil {
		t.Fatal(err)
	}
	if status, body := httpCall(t, base, "/api/v1/admin/status", "POST", "Bearer "+login.Token, map[string]any{}); status != 405 || body["correlationId"] == nil {
		t.Fatal(status, body)
	}
	if status, body := httpCall(t, base, "/api/v1/admin/users/"+login.User.ID+"/enable", "POST", "Bearer "+login.Token, nil); status != 200 || body["enabled"] != true {
		t.Fatal("empty action body was rejected", status, body)
	}
	if status, _ := httpCall(t, base, "/api/v1/admin/users/"+login.User.ID+"/enable/", "POST", "Bearer "+login.Token, nil); status != 404 {
		t.Fatal("trailing separator was accepted", status)
	}
}
