package dockerengine

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/moby/moby/api/types/container"
	"github.com/moby/moby/client"
	"piwork/internal/corestore"
)

// The create request outlives its client and the Core store is genuinely
// reopened. Recovery must keep its durable intent until that late create can
// be inspected; no helper is started or package lifecycle script rerun.
func TestPackageLateCreateSurvivesStoreAndRuntimeRestart(t *testing.T) {
	ctx := context.Background()
	directory := t.TempDir()
	store, err := corestore.Open(ctx, corestore.Options{Directory: directory})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { store.Close() }()
	installation := store.InstallationID()
	listener, err := net.Listen("unix", shortEngineSocket(t, "engine.sock"))
	if err != nil {
		t.Fatal(err)
	}
	createdRequest, release, appeared := make(chan struct{}), make(chan struct{}), make(chan struct{})
	var once sync.Once
	defer func() { once.Do(func() { close(release) }) }()
	var mu sync.Mutex
	var record *container.InspectResponse
	var creates, starts, removes atomic.Int64
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/v1.45")
		if path == "/containers/create" {
			var body container.CreateRequest
			if json.NewDecoder(r.Body).Decode(&body) != nil {
				http.Error(w, "invalid", 400)
				return
			}
			creates.Add(1)
			close(createdRequest)
			<-release
			mu.Lock()
			record = &container.InspectResponse{ID: "late-helper", Image: body.Config.Image, Name: "/" + r.URL.Query().Get("name"), Config: body.Config, State: &container.State{Status: "created"}}
			mu.Unlock()
			close(appeared)
			json.NewEncoder(w).Encode(map[string]string{"Id": "late-helper"})
			return
		}
		mu.Lock()
		defer mu.Unlock()
		switch {
		case strings.HasSuffix(path, "/json") && strings.HasPrefix(path, "/containers/"):
			if record == nil {
				http.Error(w, `{"message":"absent"}`, 404)
				return
			}
			json.NewEncoder(w).Encode(record)
		case path == "/containers/late-helper" && r.Method == "DELETE":
			removes.Add(1)
			record = nil
			w.WriteHeader(204)
		case strings.HasSuffix(path, "/start"):
			starts.Add(1)
			w.WriteHeader(204)
		default:
			http.NotFound(w, r)
		}
	})}
	go server.Serve(listener)
	defer server.Close()
	defer listener.Close()
	api, err := client.NewClientWithOpts(client.WithHost("unix://"+listener.Addr().String()), client.WithVersion("1.45"))
	if err != nil {
		t.Fatal(err)
	}
	defer api.Close()
	var plan ResourcePlan
	newRuntime := func() *Runtime {
		runtime, err := NewRuntime(&Engine{api: api}, installation, func(ctx context.Context, v ResourcePlan) error {
			plan = v
			return store.RecordResourceIntent(ctx, corestore.ResourceIntent{WorkID: v.WorkID, Kind: v.Kind, LogicalID: v.LogicalID, Name: v.Name, Labels: v.Labels})
		}, nil)
		if err != nil {
			t.Fatal(err)
		}
		runtime.SetPackageSettler(func(ctx context.Context, v ResourcePlan) error {
			return store.SettlePackageCreation(ctx, v.WorkID, v.Kind, v.LogicalID, v.Name)
		})
		return runtime
	}
	runtime := newRuntime()
	spec := PackageHelperSpec{PackageIdentity: PackageIdentity{WorkID: "core", JobID: "late-fixture"}, Epoch: 1, Action: "environment", ImageID: "sha256:" + strings.Repeat("a", 64)}
	request, cancel := context.WithCancel(ctx)
	finished := make(chan error, 1)
	go func() { _, err := runtime.EnsurePackageHelper(request, spec); finished <- err }()
	select {
	case <-createdRequest:
	case <-time.After(3 * time.Second):
		t.Fatal("create was not sent")
	}
	cancel()
	select {
	case err := <-finished:
		if err == nil {
			t.Fatal("lost response succeeded")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("create cancellation blocked")
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	store, err = corestore.Open(ctx, corestore.Options{Directory: directory})
	if err != nil {
		t.Fatal(err)
	}
	runtime = newRuntime()
	unsettled, err := store.PackageCreationUnsettled(ctx, plan.WorkID, plan.Kind, plan.LogicalID, plan.Name)
	if err != nil || !unsettled {
		t.Fatal("lost creation forgotten", unsettled, err)
	}
	runtime.MarkPackageCreationUncertain(plan.Name)
	for i := 0; i < 2; i++ {
		if err := runtime.RemovePlannedPackageHelper(ctx, plan); !errors.Is(err, ErrStateUnknown) {
			t.Fatal("absence released unanswered create", err)
		}
		if unsettled, err := store.PackageCreationUnsettled(ctx, plan.WorkID, plan.Kind, plan.LogicalID, plan.Name); err != nil || !unsettled {
			t.Fatal("intent changed before Engine confirmation", err)
		}
	}
	once.Do(func() { close(release) })
	select {
	case <-appeared:
	case <-time.After(3 * time.Second):
		t.Fatal("late create missing")
	}
	// Even a colliding name is not authority to remove a foreign container.
	mu.Lock()
	record.Config.Labels[InstallationLabel] = "foreign"
	mu.Unlock()
	if err := runtime.RemovePlannedPackageHelper(ctx, plan); !errors.Is(err, ErrIdentity) {
		t.Fatal("foreign helper was adopted", err)
	}
	if removes.Load() != 0 {
		t.Fatal("foreign helper removed")
	}
	mu.Lock()
	record.Config.Labels[InstallationLabel] = installation
	mu.Unlock()
	if err := runtime.RemovePlannedPackageHelper(ctx, plan); err != nil {
		t.Fatal(err)
	}
	if unsettled, err := store.PackageCreationUnsettled(ctx, plan.WorkID, plan.Kind, plan.LogicalID, plan.Name); err != nil || unsettled {
		t.Fatal("exact late identity did not settle attempt", unsettled, err)
	}
	if err := store.ReleaseResourceIntent(ctx, plan.WorkID, plan.Kind, plan.LogicalID, true); err != nil {
		t.Fatal(err)
	}
	if creates.Load() != 1 || starts.Load() != 0 || removes.Load() != 1 {
		t.Fatal("replayed or repeated side effect", creates.Load(), starts.Load(), removes.Load())
	}
}
