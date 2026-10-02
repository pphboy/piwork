package coreapp

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"piwork/internal/identity"
	"piwork/internal/safefs"
)

func appFixture(t *testing.T, options Options) (*Application, string, string) {
	t.Helper()
	if options.DataDirectory == "" {
		options.DataDirectory = t.TempDir()
	}
	a, err := New(context.Background(), options)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
		defer cancel()
		if err := a.Close(ctx); err != nil {
			t.Error(err)
		}
	})
	address, err := a.Listen(ListenAddress{"127.0.0.1", 0})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(options.DataDirectory, "operator.credential"))
	if err != nil {
		t.Fatal(err)
	}
	return a, address.URL(), strings.TrimSpace(string(raw))
}
func httpCall(t *testing.T, base, path, method, authorization string, body any) (int, map[string]any) {
	t.Helper()
	var data io.Reader
	if body != nil {
		raw, _ := json.Marshal(body)
		data = bytes.NewReader(raw)
	}
	req, err := http.NewRequest(method, base+path, data)
	if err != nil {
		t.Fatal(err)
	}
	if authorization != "" {
		req.Header.Set("Authorization", authorization)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	client := &http.Client{Timeout: 5 * time.Second}
	response, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var result map[string]any
	if response.StatusCode != 204 {
		if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
			t.Fatal(err)
		}
	}
	return response.StatusCode, result
}
func TestEmptyAndPartialInstallationsExposeHealthAndOnlineBootstrap(t *testing.T) {
	a, base, operator := appFixture(t, Options{})
	if status, body := httpCall(t, base, "/healthz", "GET", "", nil); status != 200 || body["status"] != "healthy" {
		t.Fatal(status, body)
	}
	if status, body := httpCall(t, base, "/readyz", "GET", "", nil); status != 503 || body["reason"] != "ADMIN_REQUIRED" {
		t.Fatal(status, body)
	}
	if err := a.Store.Read(context.Background(), func(tx *sql.Tx) error {
		var users, works int
		tx.QueryRow("SELECT count(*) FROM users").Scan(&users)
		tx.QueryRow("SELECT count(*) FROM works").Scan(&works)
		if users != 0 || works != 0 {
			t.Fatal("implicit identities", users, works)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	input := map[string]any{"account": "admin", "password": "development-fixture-pass"}
	if status, _ := httpCall(t, base, "/control/admin/bootstrap", "POST", "", input); status != 401 {
		t.Fatal(status)
	}
	if status, _ := httpCall(t, base, "/control/admin/bootstrap", "POST", "Operator "+operator, input); status != 201 {
		t.Fatal(status)
	}
	if status, body := httpCall(t, base, "/readyz", "GET", "", nil); status != 503 || body["reason"] != "RUNTIME_NOT_CONFIGURED" {
		t.Fatal(status, body)
	}
	if status, _ := httpCall(t, base, "/control/admin/bootstrap", "POST", "Operator "+operator, input); status != 409 {
		t.Fatal(status)
	}
	if status, body := httpCall(t, base, "/api/v1/login", "POST", "", input); status != 200 || body["token"] == nil {
		t.Fatal(status, body)
	}
	login, err := a.Identity.Login(context.Background(), "admin", "development-fixture-pass", "unconfigured-management")
	if err != nil {
		t.Fatal(err)
	}
	auth := "Bearer " + login.Token
	if status, user := httpCall(t, base, "/api/v1/admin/users", "POST", auth, map[string]string{"account": "new-user", "password": "development-fixture-pass"}); status != 201 || user["role"] != "user" {
		t.Fatal("unconfigured runtime prevented identity management", status, user)
	}
	if status, failed := httpCall(t, base, "/api/v1/works", "POST", auth, map[string]string{"name": "before runtime", "idempotencyKey": "unconfigured-work"}); status != 503 || failed["code"] != "RUNTIME_UNAVAILABLE" {
		t.Fatal("unconfigured runtime allowed Work creation", status, failed)
	}
	if status, failed := httpCall(t, base, "/api/v1/admin/packages", "POST", auth, map[string]any{"source": map[string]string{"kind": "npm", "spec": "pi-subagents@0.71.0"}, "idempotencyKey": "unconfigured-package"}); status != 503 || failed["code"] != "RUNTIME_UNAVAILABLE" {
		t.Fatal("unconfigured package did not report dependency failure", status, failed)
	}
}
func TestRealHTTPIdentityAuthorizationRevocationAndStoreReopen(t *testing.T) {
	directory := t.TempDir()
	a, base, operator := appFixture(t, Options{DataDirectory: directory, Initialization: Initialization{Administrator: &struct{ Account, Password string }{"admin", "development-fixture-pass"}}})
	_, login := httpCall(t, base, "/api/v1/login", "POST", "", map[string]any{"account": "admin", "password": "development-fixture-pass"})
	token := login["token"].(string)
	admin := "Bearer " + token
	if status, _ := httpCall(t, base, "/control/users", "GET", admin, nil); status != 401 {
		t.Fatal("user token accepted as operator", status)
	}
	if status, _ := httpCall(t, base, "/api/v1/admin/users", "GET", "Operator "+operator, nil); status != 401 {
		t.Fatal("operator accepted as user", status)
	}
	if status, body := httpCall(t, base, "/api/v1/admin/status", "GET", admin, nil); status != 200 || body["adminApiVersion"] != float64(1) {
		t.Fatal(status, body)
	}
	status, user := httpCall(t, base, "/api/v1/admin/users", "POST", admin, map[string]any{"account": "user", "password": "development-fixture-pass"})
	if status != 201 {
		t.Fatal(status, user)
	}
	id := user["id"].(string)
	_, otherLogin := httpCall(t, base, "/api/v1/login", "POST", "", map[string]any{"account": "user", "password": "development-fixture-pass"})
	other := otherLogin["token"].(string)
	if status, _ := httpCall(t, base, "/api/v1/admin/users", "GET", "Bearer "+other, nil); status != 403 {
		t.Fatal(status)
	}
	if status, _ := httpCall(t, base, "/api/v1/admin/users/"+id+"/disable", "POST", admin, map[string]any{}); status != 200 {
		t.Fatal(status)
	}
	if status, _ := httpCall(t, base, "/api/v1/me", "GET", "Bearer "+other, nil); status != 401 {
		t.Fatal("disabled token accepted", status)
	}
	if status, _ := httpCall(t, base, "/api/v1/admin/users/"+id+"/enable", "POST", admin, map[string]any{}); status != 200 {
		t.Fatal(status)
	}
	if status, _ := httpCall(t, base, "/api/v1/me", "GET", "Bearer "+other, nil); status != 401 {
		t.Fatal("enabled old token accepted", status)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	if err := a.Close(ctx); err != nil {
		t.Fatal(err)
	}
	cancel()
	b, newBase, _ := appFixture(t, Options{DataDirectory: directory, Initialization: Initialization{Administrator: &struct{ Account, Password string }{"replacement", "replacement-password"}}})
	if status, body := httpCall(t, newBase, "/api/v1/me", "GET", admin, nil); status != 200 || body["account"] != "admin" {
		t.Fatal("durable session changed on reopen", status, body)
	}
	users, err := b.Identity.ListUsers(context.Background(), identity.OperatorPrincipal())
	if err != nil || len(users) != 2 {
		t.Fatal(users, err)
	}
	if status, _ := httpCall(t, newBase, "/api/v1/logout", "POST", admin, nil); status != 204 {
		t.Fatal(status)
	}
	if status, _ := httpCall(t, newBase, "/api/v1/me", "GET", admin, nil); status != 401 {
		t.Fatal(status)
	}
}
func TestRuntimeInitializationDefaultsRemainAndDependencyFailureIsSafe(t *testing.T) {
	directory := t.TempDir()
	input := RuntimeInput{AgentImage: "fixture/native", Provider: "piwork-deterministic", Model: "fixture-v1", Credential: "private-model-credential"}
	options := Options{DataDirectory: directory, Initialization: Initialization{Administrator: &struct{ Account, Password string }{"admin", "development-fixture-pass"}, Runtime: &input}, DependencyCheck: func(context.Context, *Application, RuntimeProfile) error { return nil }}
	a, base, operator := appFixture(t, options)
	if status, body := httpCall(t, base, "/readyz", "GET", "", nil); status != 200 || body["reason"] != "READY" {
		t.Fatal(status, body)
	}
	if status, body := httpCall(t, base, "/control/runtime", "GET", "Operator "+operator, nil); status != 200 || body["credential"] != nil || body["revision"] != float64(1) {
		t.Fatal(status, body)
	}
	first, _, err := a.Settings.LoadRuntime()
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	if err := a.Close(ctx); err != nil {
		t.Fatal(err)
	}
	cancel()
	changed := input
	changed.Model = "replacement"
	changed.Credential = "other-private-credential"
	options.Initialization.Runtime = &changed
	options.DependencyCheck = func(context.Context, *Application, RuntimeProfile) error {
		return errors.New("private secret and /source/path")
	}
	b, newBase, _ := appFixture(t, options)
	second, _, err := b.Settings.LoadRuntime()
	if err != nil || second.Model.ID != first.Model.ID || second.Model.CredentialRef != first.Model.CredentialRef {
		t.Fatal("env overwrote persisted profile", second, err)
	}
	if status, body := httpCall(t, newBase, "/readyz", "GET", "", nil); status != 503 || body["reason"] != "RUNTIME_UNAVAILABLE" || strings.Contains(fmtJSON(body), "private") {
		t.Fatal(status, body)
	}
	if status, _ := httpCall(t, newBase, "/healthz", "GET", "", nil); status != 200 {
		t.Fatal(status)
	}
}
func TestUnsafeOperatorFileAndSecondOwnerFailBeforeListener(t *testing.T) {
	directory := t.TempDir()
	a, _, _ := appFixture(t, Options{DataDirectory: directory})
	if _, err := New(context.Background(), Options{DataDirectory: directory}); !errors.Is(err, safefs.ErrLocked) {
		t.Fatal("second owner was not rejected by the directory lock", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	a.Close(ctx)
	cancel()
	if err := os.Chmod(filepath.Join(directory, "operator.credential"), 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := New(context.Background(), Options{DataDirectory: directory}); err == nil {
		t.Fatal("unsafe operator mode accepted")
	}
}
func fmtJSON(v any) string { raw, _ := json.Marshal(v); return string(raw) }
