package consoleapp

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"piwork/internal/client"
)

func TestConsoleAvailabilityUsesOnlyCoreHealth(t *testing.T) {
	for _, test := range []struct {
		name      string
		status    int
		reachable bool
	}{
		{"healthy", http.StatusOK, true},
		{"unhealthy", http.StatusServiceUnavailable, false},
		{"missing", http.StatusNotFound, false},
		{"redirect", http.StatusTemporaryRedirect, false},
		{"disconnected", 0, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			var reads atomic.Int32
			core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				reads.Add(1)
				if r.Method != http.MethodGet || r.URL.RequestURI() != "/healthz" || r.Header.Get("Authorization") != "" {
					t.Error("availability must only read the fixed health endpoint without credentials")
				}
				if test.status == 0 {
					connection, _, err := w.(http.Hijacker).Hijack()
					if err != nil {
						t.Error(err)
						return
					}
					connection.Close()
					return
				}
				w.Header().Set("Location", "/must-not-follow")
				w.WriteHeader(test.status)
				_, _ = w.Write([]byte("private synthetic upstream detail"))
			}))
			defer core.Close()
			handler := availabilityHandler(core.URL)
			request := httptest.NewRequest(http.MethodGet, "http://localhost:17891/console/api/availability", nil)
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			assertAvailability(t, response, test.reachable)
			if reads.Load() != 1 {
				t.Fatal("availability must issue exactly one health GET", reads.Load())
			}
		})
	}
}

func TestConsoleAvailabilityBoundsAndCancelsHealthRead(t *testing.T) {
	for _, parentDeadline := range []bool{false, true} {
		name := "five-second-limit"
		if parentDeadline {
			name = "request-cancellation"
		}
		t.Run(name, func(t *testing.T) {
			started, canceled := make(chan struct{}), make(chan struct{})
			core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != http.MethodGet || r.URL.Path != "/healthz" {
					t.Error("unexpected request")
				}
				close(started)
				<-r.Context().Done()
				close(canceled)
			}))
			defer core.Close()
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			request := httptest.NewRequest(http.MethodGet, "http://localhost:17891/console/api/availability", nil).WithContext(ctx)
			response := httptest.NewRecorder()
			done := make(chan struct{})
			start := time.Now()
			go func() {
				availabilityHandler(core.URL).ServeHTTP(response, request)
				close(done)
			}()
			select {
			case <-started:
			case <-time.After(time.Second):
				t.Fatal("health read was not started")
			}
			limit := 6 * time.Second
			if parentDeadline {
				cancel()
				limit = time.Second
			}
			select {
			case <-done:
			case <-time.After(limit):
				cancel()
				t.Fatal("health read did not honor its bound or request cancellation")
			}
			if !parentDeadline && time.Since(start) < 4*time.Second {
				t.Fatal("unanswered health read ended before the configured deadline")
			}
			assertAvailability(t, response, false)
			select {
			case <-canceled:
			case <-time.After(time.Second):
				t.Fatal("health request was not canceled at Core")
			}
		})
	}
}

func TestConsoleAvailabilityRejectsNonGET(t *testing.T) {
	var upstream atomic.Int32
	core := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { upstream.Add(1) }))
	defer core.Close()
	handler := availabilityHandler(core.URL)
	for _, method := range []string{http.MethodHead, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete} {
		request := httptest.NewRequest(method, "http://localhost:17891/console/api/availability", nil)
		request.Header.Set("Origin", "http://localhost:17891")
		request.Header.Set("X-Csrf-Token", "synthetic-csrf")
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusMethodNotAllowed || response.Header().Get("Allow") != http.MethodGet {
			t.Fatal("availability accepted a non-GET method", method, response.Code)
		}
	}
	if upstream.Load() != 0 {
		t.Fatal("rejected availability methods reached Core")
	}
}

func availabilityHandler(coreURL string) http.Handler {
	return NewHostedHandler(HostedOptions{CoreURL: coreURL, Origin: func(*http.Request) string { return "http://localhost:17891" }, Resolve: func(*http.Request) (HostedSession, error) {
		return HostedSession{ID: "admin", Token: "synthetic-token", CSRF: "synthetic-csrf", User: client.Identity{ID: "admin", Role: "admin"}}, nil
	}})
}

func assertAvailability(t *testing.T, response *httptest.ResponseRecorder, reachable bool) {
	t.Helper()
	var value map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &value); err != nil {
		t.Fatal(err)
	}
	if response.Code != http.StatusOK || len(value) != 1 || value["reachable"] != reachable {
		t.Fatal("unexpected availability response", response.Code, value)
	}
}
