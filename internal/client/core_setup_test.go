package client

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

func TestControlStatusDoesNotTreatMissingFieldAsEmptyInstallation(t *testing.T) {
	for _, body := range []string{
		`{"state":"ADMIN_REQUIRED","preparation":{"version":1}}`,
		`{"state":"ADMIN_REQUIRED","hasUsers":null,"preparation":{"version":1}}`,
		`{"state":"ADMIN_REQUIRED","hasUsers":"false","preparation":{"version":1}}`,
	} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte(body)) }))
		api, _ := New(server.URL, "")
		if _, err := api.ControlStatus(context.Background()); err == nil {
			t.Fatal("malformed initialization status accepted", body)
		}
		server.Close()
	}
}

func TestBootstrapDoesNotRetryUnknownResultOrFollowRedirect(t *testing.T) {
	for _, redirect := range []bool{false, true} {
		var calls, leaked atomic.Int32
		other := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { leaked.Add(1) }))
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			calls.Add(1)
			if r.URL.Path != "/control/admin/bootstrap" || r.Method != "POST" || r.Header.Get("Authorization") != "Setup fixture" {
				t.Error("unexpected bootstrap request")
			}
			if redirect {
				http.Redirect(w, r, other.URL, http.StatusTemporaryRedirect)
			} else {
				connection, _, _ := w.(http.Hijacker).Hijack()
				_ = connection.Close()
			}
		}))
		api, _ := NewSetupClient(server.URL, "fixture")
		if _, err := api.Bootstrap(context.Background(), "admin", "fixture-password"); err == nil {
			t.Fatal("unknown result reported as confirmed")
		}
		if calls.Load() != 1 || leaked.Load() != 0 {
			t.Fatal("bootstrap replay or redirect", calls.Load(), leaked.Load())
		}
		server.Close()
		other.Close()
	}
}
