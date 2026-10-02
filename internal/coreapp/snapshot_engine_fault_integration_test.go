//go:build integration

package coreapp

import (
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httputil"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"piwork/internal/dockerengine"
)

// Reject a confirmed restore helper's start, after its target volume exists.
// All other requests use the real selected Unix Engine without emulation.
func snapshotRestoreStartFault(t *testing.T) (func(string), <-chan struct{}, func()) {
	return snapshotRestoreActionStartFault(t, "restore", 1)
}

func snapshotRestoreActionStartFault(t *testing.T, action string, contextOrdinal int) (func(string), <-chan struct{}, func()) {
	t.Helper()
	upstream := os.Getenv("PIWORK_TEST_DOCKER_HOST")
	if upstream == "" {
		upstream = "unix:///var/run/docker.sock"
	}
	if !strings.HasPrefix(upstream, "unix://") {
		t.Fatal("Unix Engine required")
	}
	transport := &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "unix", strings.TrimPrefix(upstream, "unix://"))
	}}
	proxy := &httputil.ReverseProxy{Transport: transport, Rewrite: func(r *httputil.ProxyRequest) { r.Out.URL.Scheme = "http"; r.Out.URL.Host = "engine" }}
	client := &http.Client{Transport: transport}
	directory, err := os.MkdirTemp("/tmp", "piwork-snapshot-proxy-")
	if err != nil {
		t.Fatal(err)
	}
	socket := filepath.Join(directory, "engine.sock")
	listener, err := net.Listen("unix", socket)
	if err != nil {
		t.Fatal(err)
	}
	var installation atomic.Value
	installation.Store("")
	var armed atomic.Bool
	entered := make(chan struct{}, 1)
	release := make(chan struct{})
	var once sync.Once
	var contextMu sync.Mutex
	seenContexts := map[string]bool{}
	unblock := func() { once.Do(func() { close(release) }) }
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if armed.Load() && r.Method == "POST" && strings.HasSuffix(r.URL.Path, "/start") && strings.Contains(r.URL.Path, "/containers/") {
			req, _ := http.NewRequestWithContext(r.Context(), "GET", "http://engine"+strings.TrimSuffix(r.URL.Path, "/start")+"/json", nil)
			response, err := client.Do(req)
			if err == nil {
				raw, _ := io.ReadAll(io.LimitReader(response.Body, 2<<20))
				response.Body.Close()
				var view struct {
					Config struct {
						Labels map[string]string
						Cmd    []string
					}
				}
				matches := json.Unmarshal(raw, &view) == nil && view.Config.Labels[dockerengine.InstallationLabel] == installation.Load().(string) && view.Config.Labels["piwork.snapshot_action"] == action
				if matches && action == "restore-package" {
					contextMu.Lock()
					if len(view.Config.Cmd) < 3 {
						matches = false
					} else {
						seenContexts[view.Config.Cmd[2]] = true
						matches = len(seenContexts) == contextOrdinal
					}
					contextMu.Unlock()
				}
				if matches && armed.CompareAndSwap(true, false) {
					entered <- struct{}{}
					select {
					case <-release:
					case <-r.Context().Done():
						return
					}
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(500)
					_, _ = w.Write([]byte(`{"message":"fixture restore start rejected"}`))
					return
				}
			}
		}
		proxy.ServeHTTP(w, r)
	})}
	go server.Serve(listener)
	t.Cleanup(func() { unblock(); server.Close(); transport.CloseIdleConnections(); _ = os.RemoveAll(directory) })
	t.Setenv("PIWORK_TEST_DOCKER_HOST", "unix://"+socket)
	return func(id string) { installation.Store(id); armed.Store(true) }, entered, unblock
}
