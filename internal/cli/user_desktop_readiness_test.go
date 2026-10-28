package cli

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"piwork/internal/client"
)

func TestDesktopReadinessPreservesNotReadyAndRejectsInvalid(t *testing.T) {
	for _, tc := range []struct {
		name      string
		status    int
		body      string
		available bool
	}{
		{"recovering", 503, `{"status":"not_ready","state":"RECOVERING","ready":false}`, true},
		{"ready", 200, `{"status":"ready","state":"READY","ready":true}`, true},
		{"invalid", 503, `{"state":"RECOVERING"}`, false},
		{"malformed", 503, `{`, false},
		{"unavailable", 503, `{"status":"not_ready","state":"RUNTIME_UNAVAILABLE","ready":false}`, true},
		{"mismatched", 503, `{"status":"ready","state":"READY","ready":true}`, false},
		{"inconsistent status", 503, `{"status":"ready","state":"RECOVERING","ready":false}`, false},
		{"error", 500, `{"status":"not_ready","state":"RECOVERING","ready":false}`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(tc.body))
			}))
			defer srv.Close()
			c, err := client.New(srv.URL, "")
			if err != nil {
				t.Fatal(err)
			}
			result := desktopReadiness(context.Background(), c)
			if result["available"] != tc.available {
				t.Fatalf("unexpected result: %#v", result)
			}
		})
	}
	c, err := client.New("http://127.0.0.1:1", "")
	if err != nil {
		t.Fatal(err)
	}
	result := desktopReadiness(context.Background(), c)
	if result["available"] != false || result["error"] != "Core is unavailable" {
		t.Fatalf("unreachable: %#v", result)
	}
}

func TestDesktopStatusReadinessBothModes(t *testing.T) {
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/healthz" {
			_, _ = w.Write([]byte(`{"status":"healthy"}`))
			return
		}
		if r.URL.Path == "/readyz" {
			w.WriteHeader(503)
			_, _ = w.Write([]byte(`{"status":"not_ready","state":"RECOVERING","reason":"RECOVERING","ready":false}`))
			return
		}
		w.WriteHeader(404)
	}))
	defer core.Close()
	for _, hosted := range []bool{false, true} {
		t.Run(map[bool]string{false: "standalone", true: "hosted"}[hosted], func(t *testing.T) {
			d := &nativeDesktop{identity: desktopIdentity{coreURL: core.URL}}
			if hosted {
				d.hosted = &HostedDesktopOptions{}
			}
			response := httptest.NewRecorder()
			d.status(response, httptest.NewRequest("GET", "http://desktop.localhost/_desktop/api/status", nil))
			var result struct {
				Readiness struct {
					Available bool `json:"available"`
					Value     struct {
						State string `json:"state"`
						Ready bool   `json:"ready"`
					} `json:"value"`
				} `json:"readiness"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
			if !result.Readiness.Available || result.Readiness.Value.State != "RECOVERING" || result.Readiness.Value.Ready {
				t.Fatalf("unexpected status: %#v", result)
			}
		})
	}
}
