//go:build integration

package coreapp

import (
	"bufio"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"piwork/internal/contracts"
	"piwork/internal/webapp"
)

func TestNativeWorkObservationDuringSlowRestartRecovery(t *testing.T) {
	nodePath := os.Getenv("PIWORK_TEST_NODE_BIN")
	first, base, firstAuth, workID, ctx := nativeApplyFixture(t)
	defaults, err := first.Store.DefaultWork(ctx)
	if err != nil || defaults.Configuration == nil {
		t.Fatal("default Work configuration unavailable", err)
	}
	config := *defaults.Configuration
	config.McpServers = []contracts.McpServer{}
	status, created := packageHTTPCall(t, base, "/api/v1/works", "POST", firstAuth, map[string]any{"name": "Second recovery Work", "idempotencyKey": "second-recovery", "configuration": config})
	if status != 202 {
		t.Fatal("second Work", status, created)
	}
	secondID := created["workId"].(string)
	waitWorkOperation(t, ctx, first, created["operationId"].(string))
	opts := first.options
	if err := first.Close(context.Background()); err != nil {
		t.Fatal(err)
	}
	gate := make(chan struct{})
	entered := make(chan struct{}, 1)
	var attempts atomic.Int32
	opts.Recover = func(ctx context.Context, a *Application) error {
		if attempts.Add(1) == 1 {
			return errors.New("synthetic recovery failure")
		}
		select {
		case entered <- struct{}{}:
		default:
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-gate:
		}
		return a.recoverCapturedWorks(ctx)
	}
	next, err := New(ctx, opts)
	if err != nil {
		t.Fatal(err)
	}
	defer next.Close(context.Background())
	address, err := next.Listen(ListenAddress{"127.0.0.1", 0})
	if err != nil {
		t.Fatal(err)
	}
	login, err := next.Identity.Login(ctx, "admin", "development-fixture-pass", "restart-observation")
	if err != nil {
		t.Fatal(err)
	}
	auth := "Bearer " + login.Token
	if err := next.Store.Write(ctx, func(tx *sql.Tx) error {
		for i := 0; i < 5; i++ {
			_, err := tx.ExecContext(ctx, `INSERT INTO operations(id,work_id,kind,state,target_version,request_json,error_json,created_at,updated_at) VALUES(?,?,'retry-work','failed',1,'{}','{"code":"WORK_OPERATION_FAILED","message":"synthetic previous retry failure"}',?,?)`, fmt.Sprintf("operation-history-%d", i), workID, packageNow(), packageNow())
			if err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	select {
	case <-entered:
	case <-ctx.Done():
		t.Fatal("recovery did not enter gated retry", ctx.Err())
	}
	work, err := next.Store.Work(ctx, workID, false)
	if err != nil {
		t.Fatal(err)
	}
	generation, _, err := next.selectAgentGeneration(ctx, work)
	if err != nil {
		t.Fatal(err)
	}
	// Record one failed attempt through the production failure path. Its retry
	// deadline is extended below so the browser observes Core READY while this
	// Work is still waiting for the scheduled retry.
	if err := next.recordRecoveryFailure(ctx, workID, generation, work.ControlVersion); err != nil {
		t.Fatal(err)
	}
	failedAttempt, err := next.Store.RuntimeGeneration(ctx, workID, generation)
	if err != nil || failedAttempt.State != "recovering" || failedAttempt.NextRetryAt == nil {
		t.Fatal("retry not scheduled", failedAttempt, err)
	}
	if err := next.Store.Write(ctx, func(tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, `UPDATE runtime_generations SET next_retry_at=? WHERE work_id=? AND generation=? AND state='recovering'`, time.Now().UTC().Add(2*time.Minute).Format(time.RFC3339Nano), workID, generation)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	started := time.Now()
	for i := 0; i < 3; i++ {
		for _, id := range []string{workID, secondID} {
			code, body := httpCall(t, address.URL(), "/api/v1/works/"+id, http.MethodGet, auth, nil)
			if code != 200 || body["observedState"] != "unknown" || body["desiredState"] != "running" {
				t.Fatal("unverified state", code, body)
			}
		}
		code, _ := httpCall(t, address.URL(), "/readyz", http.MethodGet, "", nil)
		if code != 503 {
			t.Fatal("not recovering", code)
		}
	}
	if time.Since(started) > 2*time.Second {
		t.Fatal("status reads blocked by slow recovery")
	}
	var browser *exec.Cmd
	var browserInput interface {
		Write([]byte) (int, error)
		Close() error
	}
	if nodePath != "" {
		listener, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			t.Fatal(err)
		}
		origin := "http://" + listener.Addr().String()
		userHash := sha256.Sum256([]byte(login.User.ID))
		recordHash := sha256.Sum256([]byte(address.URL() + "/\x00" + login.User.ID))
		recordDir := filepath.Join(opts.DataDirectory, "runtime", "browser-users", hex.EncodeToString(userHash[:]), "desktop-operations-go")
		if err := os.MkdirAll(recordDir, 0700); err != nil {
			t.Fatal(err)
		}
		records := []map[string]any{}
		for i := 0; i < 5; i++ {
			records = append(records, map[string]any{"operationId": fmt.Sprintf("operation-history-%d", i), "workId": workID, "type": "retry-work", "recordedAt": packageNow(), "terminal": true, "terminalState": "failed", "terminalCheckedAt": packageNow()})
		}
		raw, _ := json.Marshal(records)
		if err := os.WriteFile(filepath.Join(recordDir, hex.EncodeToString(recordHash[:])+".json"), raw, 0600); err != nil {
			t.Fatal(err)
		}
		web, err := webapp.New(ctx, webapp.Options{Origin: origin, CoreURL: address.URL(), DataDirectory: opts.DataDirectory})
		if err != nil {
			t.Fatal(err)
		}
		defer web.Close()
		server := &http.Server{Handler: web}
		defer server.Close()
		go server.Serve(listener)
		_, source, _, _ := runtime.Caller(0)
		packageFile := filepath.Join(filepath.Dir(source), "..", "..", "apps", "desktop-webui", "package.json")
		script := `const {createRequire}=require('module'); const {chromium}=createRequire(process.argv[1])('@playwright/test');
(async()=>{ const browser=await chromium.launch({headless:true,channel:'chromium'}); try { const page=await browser.newPage();
await page.goto(process.argv[2]+'/login'); await page.getByLabel('Account',{exact:true}).fill('admin'); await page.getByLabel('Password').fill('development-fixture-pass'); await page.getByRole('button',{name:'Sign in',exact:true}).click();
await page.locator('.core-startup-page').waitFor(); if(await page.locator('.work-row,[data-action=\"new-work\"],[data-action=\"import\"]').count())throw new Error('business UI visible during recovery'); const writes=[];page.on('request',r=>{if(r.method()!=='GET'&&/\/works(?:\/|$)/.test(new URL(r.url()).pathname))writes.push(r.url())});
console.log('WAITING'); await new Promise(resolve=>process.stdin.once('data',resolve)); await page.waitForFunction(id=>document.querySelector('.works-toolbar .connection')?.innerText.includes('Connected') && [...document.querySelectorAll('.work-row')].some(r=>r.innerText.includes(id) && r.innerText.includes('Work status not confirmed') && !r.innerText.includes('Retry Work')),process.argv[3],{timeout:20000}); await page.waitForFunction(()=>document.querySelectorAll('.work-row').length===2 && [...document.querySelectorAll('.work-row')].every(r=>r.innerText.includes('Ready')),null,{timeout:90000}); const row=page.locator('.work-row').filter({hasText:process.argv[3]});await row.locator('[data-action=work-menu]').click();if(await page.locator('.work-menu-task').count())throw new Error('old retries stayed in command menu');await page.locator('[data-action=work-history]').click();await page.locator('.operation-list > button').nth(4).waitFor();await page.locator('[data-action=operation][data-id=operation-history-0]').click();await page.waitForFunction(()=>document.querySelector('.phase-track')?.innerText.includes('failed'));if(writes.length)throw new Error('recovery resubmitted a Work mutation'); console.log('READY');
} finally {await browser.close()} })().catch(e=>{console.error(e.message);process.exitCode=1});`
		browser = exec.CommandContext(ctx, nodePath, "-e", script, packageFile, origin, workID)
		browser.Stderr = os.Stderr
		browserOutput, err := browser.StdoutPipe()
		if err != nil {
			t.Fatal(err)
		}
		browserInput, err = browser.StdinPipe()
		if err != nil {
			t.Fatal(err)
		}
		if err := browser.Start(); err != nil {
			t.Fatal(err)
		}
		defer func() {
			if browser.Process != nil {
				_ = browser.Process.Kill()
			}
		}()
		lines := bufio.NewReader(browserOutput)
		line, err := lines.ReadString('\n')
		if err != nil || strings.TrimSpace(line) != "WAITING" {
			t.Fatal("browser did not show Core recovery gate", line, err)
		}
		defer func() {
			if browserInput != nil {
				_ = browserInput.Close()
			}
		}()
		defer func() {
			if browser != nil {
				if err := browser.Wait(); err != nil {
					t.Error("browser verification failed", err)
				}
			}
		}()
		// Continue reading after releasing the gate below.
		defer func() {
			if line, err := lines.ReadString('\n'); err != nil || strings.TrimSpace(line) != "READY" {
				t.Error("browser did not update to Ready", line, err)
			}
		}()
	}
	if err := next.Store.Write(ctx, func(tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, `UPDATE runtime_generations SET next_retry_at=? WHERE work_id=? AND generation=? AND state='recovering'`, time.Now().UTC().Add(25*time.Second).Format(time.RFC3339Nano), workID, generation)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	close(gate)
	if browserInput != nil {
		_, _ = fmt.Fprintln(browserInput, "continue")
		_ = browserInput.Close()
	}
	deadline := time.After(2 * time.Minute)
	for {
		code, body := httpCall(t, address.URL(), "/api/v1/works/"+workID, http.MethodGet, auth, nil)
		otherCode, other := httpCall(t, address.URL(), "/api/v1/works/"+secondID, http.MethodGet, auth, nil)
		if code == 200 && body["observedState"] == "ready" && otherCode == 200 && other["observedState"] == "ready" {
			break
		}
		select {
		case <-deadline:
			t.Fatal("Work did not recover", code, body)
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		case <-time.After(200 * time.Millisecond):
		}
	}
	if err := next.Store.Read(ctx, func(tx *sql.Tx) error {
		var count int
		if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM operations WHERE work_id=? AND kind='retry-work'`, workID).Scan(&count); err != nil {
			return err
		}
		if count != 5 {
			return fmt.Errorf("automatic recovery created Retry operations: %d", count)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if attempts.Load() < 2 {
		t.Fatal("failure did not retry")
	}
}
