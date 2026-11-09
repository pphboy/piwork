//go:build integration

package coreapp

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"math/rand/v2"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"piwork/internal/workpackage"
)

// Measures the existing product flow using synthetic Work data and a cached
// FastAPI runtime. It neither invokes a remote model nor touches a live install.
func TestNativeCompressedSnapshotPerformanceRoundTrip(t *testing.T) {
	// Prepared by the existing fastapi-htmx-workstation-fixture integration step.
	const image = "piwork-fastapi-workstation:acceptance"
	a, base, auth, work, _ := nativeApplyFixture(t)
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Minute)
	defer cancel()
	request := func(method, path string, body io.Reader, headers map[string]string) *http.Response {
		t.Helper()
		req, err := http.NewRequestWithContext(ctx, method, base+path, body)
		if err != nil {
			t.Fatal(err)
		}
		if file, ok := body.(*os.File); ok {
			info, err := file.Stat()
			if err != nil {
				t.Fatal(err)
			}
			req.ContentLength = info.Size()
			if _, err = file.Seek(0, io.SeekStart); err != nil {
				t.Fatal(err)
			}
		}
		req.Header.Set("Authorization", auth)
		for key, value := range headers {
			req.Header.Set(key, value)
		}
		response, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		return response
	}
	mutation := func(path, key string) map[string]any {
		t.Helper()
		status, result := packageHTTPCall(t, base, path, "POST", auth, map[string]string{"idempotencyKey": key})
		if status != 202 {
			t.Fatal(path, status, result)
		}
		waitWorkOperation(t, ctx, a, result["operationId"].(string))
		return result
	}
	python := "from fastapi import FastAPI; import uvicorn; a=FastAPI(); a.get('/health')(lambda: {'ok': True}); uvicorn.run(a,host='0.0.0.0',port=8080)"
	definition := map[string]any{"name": "compression-fastapi", "image": map[string]string{"reference": image}, "command": "python", "args": []string{"-c", python}, "workingDirectory": "/", "ports": []any{map[string]any{"name": "http", "protocol": "tcp", "containerPort": 8080}}, "readiness": map[string]any{"kind": "http", "portName": "http", "path": "/health", "deadlineMs": 10000}}
	status, service := packageHTTPCall(t, base, "/api/v1/works/"+work+"/services", "POST", auth, map[string]any{"definition": definition, "idempotencyKey": "compression-service"})
	if status != 202 {
		t.Fatal(status, service)
	}
	waitWorkOperation(t, ctx, a, service["operationId"].(string))
	random := make([]byte, 128<<10)
	generator := rand.New(rand.NewPCG(1, 2))
	for i := range random {
		random[i] = byte(generator.Uint32())
	}
	for name, data := range map[string][]byte{"random.bin": random, "compressible.bin": bytes.Repeat([]byte("portable-work\n"), 2<<20)} {
		response := request("PUT", "/api/v1/works/"+work+"/files/"+name, bytes.NewReader(data), nil)
		io.Copy(io.Discard, response.Body)
		response.Body.Close()
		if response.StatusCode != 201 {
			t.Fatal(name, response.StatusCode)
		}
	}
	mutation("/api/v1/works/"+work+"/stop", "compression-stop")
	var peak atomic.Int64
	observeCtx, stopObserve := context.WithCancel(ctx)
	observed := make(chan struct{})
	go func() {
		defer close(observed)
		for {
			var size int64
			_ = filepath.WalkDir(filepath.Join(a.options.DataDirectory, "snapshots", "jobs"), func(path string, d os.DirEntry, err error) error {
				if err == nil && !d.IsDir() {
					if info, e := d.Info(); e == nil {
						size += info.Size()
					}
				}
				return nil
			})
			for old := peak.Load(); size > old && !peak.CompareAndSwap(old, size); old = peak.Load() {
			}
			select {
			case <-observeCtx.Done():
				return
			case <-time.After(20 * time.Millisecond):
			}
		}
	}()
	defer func() { stopObserve(); <-observed }()
	started := time.Now()
	export := mutation("/api/v1/works/"+work+"/exports", "compression-export")
	exportMs := time.Since(started).Milliseconds()
	response := request("GET", "/api/v1/work-snapshots/"+export["snapshotId"].(string)+"/content", nil, nil)
	file, err := os.Create(filepath.Join(t.TempDir(), "measured.work"))
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	hash := sha256.New()
	size, err := io.Copy(io.MultiWriter(file, hash), response.Body)
	response.Body.Close()
	if err != nil || response.StatusCode != 200 {
		t.Fatal(err, response.StatusCode)
	}
	digest := hex.EncodeToString(hash.Sum(nil))
	if response.ContentLength != size || response.Header.Get("X-Piwork-SHA256") != digest {
		t.Fatal("physical download identity")
	}
	started = time.Now()
	inspection, err := workpackage.Inspect(ctx, file, size)
	if err != nil || inspection.FormatVersion != 2 {
		t.Fatal(err, inspection.FormatVersion)
	}
	inspectMs := time.Since(started).Milliseconds()
	started = time.Now()
	response = request("POST", "/api/v1/work-packages", file, map[string]string{"Content-Type": snapshotMIME, "X-Piwork-SHA256": digest})
	var uploaded map[string]any
	err = json.NewDecoder(response.Body).Decode(&uploaded)
	response.Body.Close()
	uploadMs := time.Since(started).Milliseconds()
	if err != nil || response.StatusCode != 201 {
		t.Fatal("upload", err, response.StatusCode, uploaded)
	}
	started = time.Now()
	status, imported := packageHTTPCall(t, base, "/api/v1/work-imports", "POST", auth, map[string]any{"packageId": uploaded["packageId"], "idempotencyKey": "compression-import"})
	if status != 202 {
		t.Fatal(status, imported)
	}
	waitWorkOperation(t, ctx, a, imported["operationId"].(string))
	importMs := time.Since(started).Milliseconds()
	target := imported["workId"].(string)
	targetView, err := a.Store.Work(ctx, target, false)
	if err != nil || targetView.ObservedState != "stopped" {
		t.Fatal("stopped import", err, targetView.ObservedState)
	}
	mutation("/api/v1/works/"+target+"/start", "compression-target-start")
	response = request("GET", "/api/v1/works/"+target+"/files/random.bin", nil, nil)
	restored, err := io.ReadAll(response.Body)
	response.Body.Close()
	if err != nil || response.StatusCode != 200 || !bytes.Equal(restored, random) {
		t.Fatal("restored raw fallback bytes", err, response.StatusCode)
	}
	status, services := packageHTTPCall(t, base, "/api/v1/works/"+target+"/services", "GET", auth, nil)
	if status != 200 {
		t.Fatal(status)
	}
	ready := false
	for _, item := range services["services"].([]any) {
		v := item.(map[string]any)
		ready = ready || v["name"] == "compression-fastapi" && v["observedState"] == "ready"
	}
	if !ready {
		t.Fatal("FastAPI did not resume")
	}
	resident := int64(0)
	proc, _ := os.ReadFile("/proc/self/status")
	for _, line := range strings.Split(string(proc), "\n") {
		if strings.HasPrefix(line, "VmHWM:") {
			fields := strings.Fields(line)
			resident, _ = strconv.ParseInt(fields[1], 10, 64)
			resident *= 1024
		}
	}
	t.Logf("compression-metrics %s", snapshotRaw(map[string]any{"physicalBytes": size, "logicalRestoreBytes": inspection.RestoredBytes, "exportMs": exportMs, "inspectMs": inspectMs, "uploadVerifyMs": uploadMs, "importMs": importMs, "jobTemporaryPeakBytes": peak.Load(), "coreProcessPeakResidentBytes": resident, "imageCount": inspection.Counts.Images}))
}
