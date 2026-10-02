//go:build integration

package coreapp

import (
	"bytes"
	"context"
	"database/sql"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"piwork/internal/corestore"
)

func TestNativeCoreWebDAVUploadStopApplyRevocationAndRestart(t *testing.T) {
	a, base, auth, id, ctx := nativeApplyFixture(t)
	path := "/api/v1/works/" + id
	client := &http.Client{Timeout: 40 * time.Second}
	call := func(method, endpoint string, body io.Reader, bearer string) (int, []byte, error) {
		request, err := http.NewRequestWithContext(ctx, method, base+endpoint, body)
		if err != nil {
			return 0, nil, err
		}
		request.Header.Set("Authorization", bearer)
		response, err := client.Do(request)
		if err != nil {
			return 0, nil, err
		}
		defer response.Body.Close()
		data, err := io.ReadAll(response.Body)
		return response.StatusCode, data, err
	}
	checkOriginal := func() {
		t.Helper()
		status, data, err := call("GET", path+"/files/value", nil, auth)
		if err != nil || status != 200 || string(data) != "original" {
			t.Fatal("original file changed", status, string(data), err)
		}
	}
	if status, data, err := call("PUT", path+"/files/value", strings.NewReader("original"), auth); err != nil || status != 201 {
		t.Fatal(status, string(data), err)
	}
	awaitClean := func() {
		t.Helper()
		deadline := time.Now().Add(15 * time.Second)
		for {
			var jobs []corestore.FileJob
			err := a.Store.Read(ctx, func(tx *sql.Tx) error { var err error; jobs, err = corestore.PendingFileJobs(tx, &id); return err })
			if err != nil {
				t.Fatal(err)
			}
			if len(jobs) == 0 {
				return
			}
			if time.Now().After(deadline) {
				t.Fatal("cleanup did not release jobs", jobs)
			}
			time.Sleep(20 * time.Millisecond)
		}
	}
	beginUpload := func(bearer string) (*io.PipeWriter, chan error) {
		t.Helper()
		reader, writer := io.Pipe()
		done := make(chan error, 1)
		go func() { _, _, err := call("PUT", path+"/files/value", reader, bearer); done <- err }()
		writeDone := make(chan error, 1)
		go func() { _, err := writer.Write(bytes.Repeat([]byte("partial"), 10000)); writeDone <- err }()
		select {
		case err := <-writeDone:
			if err != nil {
				t.Fatal(err)
			}
		case <-time.After(10 * time.Second):
			t.Fatal("upload did not start")
		}
		deadline := time.Now().Add(10 * time.Second)
		for {
			var ready int
			err := a.Store.Read(ctx, func(tx *sql.Tx) error {
				return tx.QueryRow(`SELECT count(*) FROM work_file_temporaries t JOIN work_file_jobs j ON j.id=t.job_id WHERE j.work_id=? AND j.state!='cleaned' AND t.state='created'`, id).Scan(&ready)
			})
			if err != nil {
				t.Fatal(err)
			}
			if ready > 0 {
				break
			}
			if time.Now().After(deadline) {
				t.Fatal("temporary identity not acknowledged")
			}
			time.Sleep(20 * time.Millisecond)
		}
		return writer, done
	}
	finishUpload := func(writer *io.PipeWriter, done chan error) {
		t.Helper()
		_ = writer.Close()
		select {
		case <-done:
		case <-time.After(15 * time.Second):
			t.Fatal("upload connection did not close")
		}
		awaitClean()
		checkOriginal()
	}
	writer, done := beginUpload(auth)
	t.Log("upload active; checking mutation quota and Save")
	if status, _, err := call("PUT", path+"/files/second", strings.NewReader("blocked"), auth); err != nil || status != 429 {
		t.Fatal("parallel mutation admitted", status, err)
	}
	status, _ := packageHTTPCall(t, base, path+"/configuration/agents", "PUT", auth, map[string]string{"agentsMd": "# Saved while files are active"})
	if status != 200 {
		t.Fatal("Save interrupted files", status)
	}
	checkOriginal()
	status, accepted := packageHTTPCall(t, base, path+"/stop", "POST", auth, map[string]string{"idempotencyKey": "stop-upload"})
	if status != 202 {
		t.Fatal(status, accepted)
	}
	waitWorkOperation(t, ctx, a, accepted["operationId"].(string))
	t.Log("Stop confirmed; verifying cancelled upload and preserved file")
	_ = writer.Close()
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("Stop left upload open")
	}
	awaitClean()
	if status, _, err := call("GET", path+"/files/value", nil, auth); err != nil || status != 409 {
		t.Fatal("stopped file access", status, err)
	}
	status, accepted = packageHTTPCall(t, base, path+"/start", "POST", auth, map[string]string{"idempotencyKey": "start-after-upload"})
	if status != 202 {
		t.Fatal(status, accepted)
	}
	waitWorkOperation(t, ctx, a, accepted["operationId"].(string))
	checkOriginal()
	writer, done = beginUpload(auth)
	t.Log("second upload active; applying saved context")
	status, accepted = packageHTTPCall(t, base, path+"/configuration/apply", "POST", auth, map[string]string{"idempotencyKey": "apply-upload"})
	if status != 202 {
		t.Fatal(status, accepted)
	}
	waitWorkOperation(t, ctx, a, accepted["operationId"].(string))
	finishUpload(writer, done)
	t.Log("Apply confirmed; revoking a separate upload session")
	login, err := a.Identity.Login(ctx, "admin", "development-fixture-pass", "revoked-upload")
	if err != nil {
		t.Fatal(err)
	}
	writer, done = beginUpload("Bearer " + login.Token)
	if err := a.Identity.Logout(ctx, login.Token); err != nil {
		t.Fatal(err)
	}
	finishUpload(writer, done)
	options := a.options
	t.Log("revocation cleaned; restarting Core")
	if err := a.Close(ctx); err != nil {
		t.Fatal("Core file shutdown", err)
	}
	a, err = New(ctx, options)
	if err != nil {
		t.Fatal("Core file recovery", err)
	}
	t.Cleanup(func() {
		closing, cancel := context.WithTimeout(context.Background(), 45*time.Second)
		defer cancel()
		if err := a.Close(closing); err != nil {
			t.Error(err)
		}
	})
	listen, err := a.Listen(ListenAddress{Host: "127.0.0.1", Port: 0})
	if err != nil {
		t.Fatal(err)
	}
	base = listen.URL()
	if !a.Status().Ready {
		t.Fatal("cleaned jobs blocked Core recovery", a.Status())
	}
	checkOriginal()
	awaitClean()
}
