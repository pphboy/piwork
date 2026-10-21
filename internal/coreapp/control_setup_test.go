package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"

	"piwork/internal/client"
)

func TestControlStatusDistinguishesUsersFromReadiness(t *testing.T) {
	a, base, _ := appFixture(t, Options{})
	api, _ := client.New(base, "")
	status, err := api.ControlStatus(context.Background())
	if err != nil || status.HasUsers || status.Ready || status.State != "ADMIN_REQUIRED" {
		t.Fatal(status, err)
	}
	if _, err := a.Identity.Bootstrap(context.Background(), "admin", "development-fixture-pass"); err != nil {
		t.Fatal(err)
	}
	if err := a.ScheduleRuntimeRefresh(); err != nil {
		t.Fatal(err)
	}
	status, err = api.ControlStatus(context.Background())
	if err != nil || !status.HasUsers || status.Checks.RuntimeConfigured {
		t.Fatal(status, err)
	}
	// Simulate an installation with an unavailable administrator, including
	// legacy persisted data; that must not be confused with an empty store.
	if err := a.Store.Write(context.Background(), func(tx *sql.Tx) error {
		_, err := tx.Exec("UPDATE users SET enabled=0")
		return err
	}); err != nil {
		t.Fatal(err)
	}
	_ = a.ScheduleRuntimeRefresh()
	status, err = api.ControlStatus(context.Background())
	if err != nil || !status.HasUsers || status.Checks.Administrator {
		t.Fatal(status, err)
	}
}

func TestControlStatusRemainsAvailableWhenDockerFails(t *testing.T) {
	a, base, _ := preparationFixture(t, func(p *runtimePreparation) {
		p.probeForTest = func(context.Context) error { return errors.New("fixture unavailable") }
	})
	waitPreparation(t, a, func(p Preparation) bool { return p.Components["docker"].State == "retrying" })
	api, _ := client.New(base, "")
	status, err := api.ControlStatus(context.Background())
	if err != nil || !status.HasUsers || status.Ready || status.Preparation.Components["docker"].State != "retrying" {
		t.Fatal(status, err)
	}
}

func TestSetupDelegationIsNarrowAndBootstrapIsAtomic(t *testing.T) {
	const secret = "fixture-process-only-delegation"
	a, base, operator := appFixture(t, Options{SetupSecret: secret})
	auth := "Setup " + secret
	for _, path := range []string{"/control/runtime", "/control/users", "/control/admin/bootstrap/extra", "/api/v1/me", "/api/v1/admin/runtime", "/api/v1/works"} {
		code, body := httpCall(t, base, path, "GET", auth, nil)
		raw, _ := json.Marshal(body)
		if code != 401 || strings.Contains(string(raw), secret) {
			t.Fatal(path, code, body)
		}
	}
	if code, _ := httpCall(t, base, "/control/admin/bootstrap", "POST", "Setup wrong", map[string]string{"account": "admin", "password": "development-fixture-pass"}); code != 401 {
		t.Fatal(code)
	}
	// Both callers use the same durable empty-user transaction.
	start := make(chan struct{})
	codes := make(chan int, 2)
	var wg sync.WaitGroup
	for _, authorization := range []string{auth, "Operator " + operator} {
		wg.Add(1)
		go func(authorization string) {
			defer wg.Done()
			<-start
			code, body := httpCall(t, base, "/control/admin/bootstrap", "POST", authorization, map[string]string{"account": "admin", "password": "development-fixture-pass"})
			raw, _ := json.Marshal(body)
			if strings.Contains(string(raw), secret) || body["token"] != nil {
				t.Error("bootstrap exposed a credential")
			}
			codes <- code
		}(authorization)
	}
	close(start)
	wg.Wait()
	close(codes)
	counts := map[int]int{}
	for code := range codes {
		counts[code]++
	}
	if counts[201] != 1 || counts[409] != 1 {
		t.Fatal(counts)
	}
	if code, _ := httpCall(t, base, "/control/admin/bootstrap", "POST", auth, map[string]string{"account": "second", "password": "development-fixture-pass"}); code != 409 {
		t.Fatal(code)
	}
	directory := a.options.DataDirectory
	closeSettingsApp(t, a)
	_, nextBase, _ := appFixture(t, Options{DataDirectory: directory, SetupSecret: "fixture-new-process-secret"})
	if code, _ := httpCall(t, nextBase, "/control/admin/bootstrap", "POST", auth, map[string]string{"account": "second", "password": "development-fixture-pass"}); code != 401 {
		t.Fatal("old process delegation survived", code)
	}
}
