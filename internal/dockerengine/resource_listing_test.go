package dockerengine

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/moby/moby/api/types/container"
	"github.com/moby/moby/client"
)

func TestContainerListingRetainsSurvivorsAfterConfirmedRemoval(t *testing.T) {
	for _, mode := range []string{"removed", "unavailable", "wrong-owner"} {
		t.Run(mode, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				path := strings.TrimPrefix(r.URL.Path, "/v1.45")
				w.Header().Set("Content-Type", "application/json")
				switch path {
				case "/containers/json":
					_ = json.NewEncoder(w).Encode([]container.Summary{{ID: "gone"}, {ID: "survivor"}})
				case "/containers/gone/json":
					code := 404
					if mode == "unavailable" {
						code = 503
					}
					w.WriteHeader(code)
					_ = json.NewEncoder(w).Encode(map[string]string{"message": "synthetic observation"})
				case "/containers/survivor/json":
					owner := "installation-fixture"
					if mode == "wrong-owner" {
						owner = "another-installation"
					}
					_ = json.NewEncoder(w).Encode(container.InspectResponse{ID: "survivor", Config: &container.Config{Labels: map[string]string{InstallationLabel: owner, ManagedLabel: "true", KindLabel: "package-helper"}}})
				default:
					http.NotFound(w, r)
				}
			}))
			defer server.Close()
			api, err := client.NewClientWithOpts(client.WithHost("tcp://"+strings.TrimPrefix(server.URL, "http://")), client.WithVersion("1.45"))
			if err != nil {
				t.Fatal(err)
			}
			defer api.Close()
			runtime, err := NewRuntime(&Engine{api: api}, "installation-fixture", func(context.Context, ResourcePlan) error { return nil }, nil)
			if err != nil {
				t.Fatal(err)
			}
			views, err := runtime.ListContainers(t.Context(), "package-helper")
			switch mode {
			case "removed":
				if err != nil || len(views) != 1 || views[0].ID != "survivor" {
					t.Fatal("confirmed removal hid a surviving helper", views, err)
				}
			case "wrong-owner":
				if !errors.Is(err, ErrIdentity) {
					t.Fatal("surviving ownership mismatch hidden", err)
				}
			default:
				if err == nil {
					t.Fatal("Engine unavailability hidden")
				}
			}
		})
	}
}
