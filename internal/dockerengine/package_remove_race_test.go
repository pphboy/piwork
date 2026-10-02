package dockerengine

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"strings"
	"sync"
	"testing"

	"github.com/moby/moby/api/types/container"
	"github.com/moby/moby/client"
)

func TestRemovePackageHelperSettlesCreatedToRunningRace(t *testing.T) {
	listener, err := net.Listen("unix", shortEngineSocket(t, "package-race.sock"))
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	api, err := client.NewClientWithOpts(client.WithHost("unix://"+listener.Addr().String()), client.WithVersion("1.45"))
	if err != nil {
		t.Fatal(err)
	}
	defer api.Close()
	runtime, err := NewRuntime(&Engine{api: api}, "race-installation", nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	spec := PackageHelperSpec{PackageIdentity: PackageIdentity{WorkID: "core", JobID: "race-job"},
		Epoch: 1, Action: "measure", ImageID: "sha256:" + strings.Repeat("a", 64)}
	_, config, _, err := runtime.packageHelperPolicy(context.Background(), spec)
	if err != nil {
		t.Fatal(err)
	}
	var mu sync.Mutex
	state := "created"
	removes, stops := 0, 0
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		path := strings.TrimPrefix(r.URL.Path, "/v1.45")
		switch {
		case strings.HasSuffix(path, "/json"):
			if state == "absent" {
				http.Error(w, `{"message":"absent"}`, 404)
				return
			}
			json.NewEncoder(w).Encode(&container.InspectResponse{ID: "helper-id", Image: spec.ImageID,
				Config: config, State: &container.State{Status: container.ContainerState(state), Running: state == "running"}})
		case path == "/containers/helper-id" && r.Method == "DELETE":
			removes++
			if removes == 1 {
				state = "running"
				http.Error(w, `{"message":"container is running"}`, 409)
				return
			}
			state = "absent"
			w.WriteHeader(204)
		case path == "/containers/helper-id/stop" && r.Method == "POST":
			stops++
			state = "exited"
			w.WriteHeader(204)
		default:
			http.NotFound(w, r)
		}
	})}
	go server.Serve(listener)
	defer server.Close()
	if err := runtime.RemovePackageHelper(context.Background(), spec); err != nil {
		t.Fatal(err)
	}
	if removes != 2 || stops != 1 || state != "absent" {
		t.Fatal("race not settled", removes, stops, state)
	}
}
