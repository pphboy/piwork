package dockerengine

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/moby/moby/api/types/container"
	"github.com/moby/moby/client"
)

func fixtureSpec() ContainerSpec {
	return ContainerSpec{Identity: ContainerIdentity{WorkID: "work-fixture", Kind: "service", LogicalID: "service-fixture", Labels: map[string]string{"piwork.service_revision": "1"}}, Image: "sha256:" + strings.Repeat("a", 64), DisplayName: "w-a1b2c3d4_counter", Command: []string{"sleep", "60"}}
}
func resourceFixture(t *testing.T) (*Runtime, *atomic.Int64, chan struct{}) {
	t.Helper()
	path := shortEngineSocket(t, "engine.sock")
	listener, err := net.Listen("unix", path)
	if err != nil {
		t.Fatal(err)
	}
	var lock sync.Mutex
	var record *container.InspectResponse
	count := &atomic.Int64{}
	release := make(chan struct{})
	handler := http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		path := strings.TrimPrefix(req.URL.Path, "/v1.45")
		if path == "/containers/create" {
			var body container.CreateRequest
			if json.NewDecoder(req.Body).Decode(&body) != nil {
				t.Error("bad request")
				http.Error(w, "bad", 400)
				return
			}
			count.Add(1)
			<-release
			lock.Lock()
			defer lock.Unlock()
			if record != nil {
				http.Error(w, `{"message":"conflict"}`, 409)
				return
			}
			record = &container.InspectResponse{ID: "container-fixed", Name: "/" + req.URL.Query().Get("name"), State: &container.State{Status: "created"}, Config: body.Config, HostConfig: body.HostConfig}
			_ = json.NewEncoder(w).Encode(map[string]string{"Id": "container-fixed"})
			return
		}
		lock.Lock()
		defer lock.Unlock()
		switch path {
		case "/containers/json":
			var result []container.Summary
			if record != nil {
				result = append(result, container.Summary{ID: "container-fixed", Labels: record.Config.Labels})
			}
			_ = json.NewEncoder(w).Encode(result)
		case "/containers/container-fixed/json":
			if record == nil {
				http.Error(w, `{"message":"missing"}`, 404)
				return
			}
			_ = json.NewEncoder(w).Encode(record)
		default:
			http.NotFound(w, req)
		}
	})
	server := &http.Server{Handler: handler}
	go server.Serve(listener)
	t.Cleanup(func() {
		select {
		case <-release:
		default:
			close(release)
		}
		server.Close()
		listener.Close()
	})
	api, err := client.NewClientWithOpts(client.WithHost("unix://"+path), client.WithVersion("1.45"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { api.Close() })
	runtime, err := NewRuntime(&Engine{api: api}, "installation-fixture", func(context.Context, ResourcePlan) error { return nil }, nil)
	if err != nil {
		t.Fatal(err)
	}
	// Closing release during a test is accounted for by the cleanup guard.

	return runtime, count, release
}
func TestContainerSpecStableHashAndInvalidPolicy(t *testing.T) {
	original := fixtureSpec()
	first, err := normalizeContainer(original)
	if err != nil {
		t.Fatal(err)
	}
	hash, err := containerSpecHash(first)
	if err != nil {
		t.Fatal(err)
	}
	next := original
	next.DisplayName = "w-b1b2c3d4_counter"
	next.CPUMillis = 100
	next.MemoryBytes = 64 << 20
	next.User = "65532:65532"
	normalized, err := normalizeContainer(next)
	if err != nil {
		t.Fatal(err)
	}
	other, err := containerSpecHash(normalized)
	if err != nil || hash != other {
		t.Fatal("default/display-name changed immutable hash", err)
	}
	for _, change := range []func(*ContainerSpec){func(s *ContainerSpec) { s.User = "0:0" }, func(s *ContainerSpec) { s.CPUMillis = 1 }, func(s *ContainerSpec) { s.MemoryBytes = 1 }, func(s *ContainerSpec) { s.Image = "python:latest" }, func(s *ContainerSpec) { s.ControlHost = "core" }, func(s *ContainerSpec) { s.DisplayName = "bad-name" }, func(s *ContainerSpec) { s.Entrypoint = []string{} }, func(s *ContainerSpec) { s.Environment = map[string]string{"BAD=KEY": "secret"} }} {
		value := fixtureSpec()
		change(&value)
		if _, err := normalizeContainer(value); !errors.Is(err, ErrSpecification) {
			t.Fatal(value, err)
		}
	}
	runtime, err := NewRuntime(&Engine{}, "installation-fixture", nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	labels := ContainerIdentity{WorkID: "work-fixture", Kind: "service", LogicalID: "service-fixture", Labels: map[string]string{InstallationLabel: "foreign"}}
	if _, err := runtime.containerLabels(labels); !errors.Is(err, ErrIdentity) {
		t.Fatal(err)
	}
}
func TestConcurrentContainerCreateAdoptsOneImmutableInstance(t *testing.T) {
	runtime, count, release := resourceFixture(t)
	close(release)
	var group sync.WaitGroup
	results := make(chan EnsuredContainer, 12)
	failures := make(chan error, 12)
	for i := 0; i < 12; i++ {
		group.Add(1)
		go func() {
			defer group.Done()
			value, err := runtime.EnsureContainer(context.Background(), fixtureSpec())
			if err != nil {
				failures <- err
			} else {
				results <- value
			}
		}()
	}
	group.Wait()
	close(results)
	close(failures)
	for err := range failures {
		t.Fatal(err)
	}
	created := 0
	for value := range results {
		if value.ID != "container-fixed" {
			t.Fatal(value)
		}
		if value.Created {
			created++
		}
	}
	if created != 1 || count.Load() != 1 {
		t.Fatal("duplicate create", created, count.Load())
	}
	conflicting := fixtureSpec()
	conflicting.Command = []string{"different"}
	if _, err := runtime.EnsureContainer(context.Background(), conflicting); !errors.Is(err, ErrSpecificationConflict) {
		t.Fatal(err)
	}
	wrongGeneration := fixtureSpec()
	wrongGeneration.Identity.Labels = map[string]string{"piwork.service_revision": "2"}
	if _, err := runtime.InspectContainer(context.Background(), wrongGeneration.Identity); !errors.Is(err, ErrIdentity) {
		t.Fatal(err)
	}
}
func TestLateContainerCreateUsesSameNameWithoutSecondEffectiveInstance(t *testing.T) {
	runtime, count, release := resourceFixture(t)
	request, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	if _, err := runtime.EnsureContainer(request, fixtureSpec()); !errors.Is(err, ErrStateUnknown) {
		t.Fatal(err)
	}
	if count.Load() != 1 {
		t.Fatal(count.Load())
	}
	close(release)
	deadline := time.Now().Add(time.Second)
	for {
		view, err := runtime.InspectContainer(context.Background(), fixtureSpec().Identity)
		if err != nil {
			t.Fatal(err)
		}
		if view != nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("late create never appeared")
		}
		time.Sleep(time.Millisecond)
	}
	next, err := runtime.EnsureContainer(context.Background(), fixtureSpec())
	if err != nil || next.Created || next.ID != "container-fixed" || count.Load() != 1 {
		t.Fatal(next, err, count.Load())
	}
}
func TestMountPolicyRejectsOutsidePathsAndDockerSocket(t *testing.T) {
	socket := shortEngineSocket(t, "docker.sock")
	allowed := filepath.Dir(socket)
	runtime, err := NewRuntime(&Engine{}, "installation-fixture", nil, []string{allowed})
	if err != nil {
		t.Fatal(err)
	}
	listener, err := net.Listen("unix", socket)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	outside := t.TempDir()
	link := filepath.Join(allowed, "link")
	if err := os.Symlink(outside, link); err != nil {
		t.Fatal(err)
	}
	for _, item := range []ContainerMount{{Type: "bind", Source: outside, Target: "/safe"}, {Type: "bind", Source: link, Target: "/safe"}, {Type: "bind", Source: socket, Target: "/safe"}, {Type: "tmpfs", Target: "/"}, {Type: "tmpfs", Target: "/a/../b"}, {Type: "tmpfs", Source: "not-allowed", Target: "/tmp"}} {
		spec := fixtureSpec()
		spec.Mounts = []ContainerMount{item}
		if err := runtime.validateMounts(context.Background(), spec); !errors.Is(err, ErrSpecification) {
			t.Fatal(fmt.Sprintf("unsafe mount accepted: %+v", item), err)
		}
	}
}

func TestLateNetworkCreateIsNotRetriedAcrossRuntimeRestart(t *testing.T) {
	path := shortEngineSocket(t, "engine.sock")
	listener, err := net.Listen("unix", path)
	if err != nil {
		t.Fatal(err)
	}
	release := make(chan struct{})
	var count atomic.Int64
	var lock sync.Mutex
	var created map[string]any
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		path := strings.TrimPrefix(req.URL.Path, "/v1.45")
		if path == "/networks/create" {
			var body map[string]any
			if json.NewDecoder(req.Body).Decode(&body) != nil {
				http.Error(w, "bad", 400)
				return
			}
			count.Add(1)
			<-release
			lock.Lock()
			created = map[string]any{"Id": "network-fixed", "Name": body["Name"], "Driver": "bridge", "Labels": body["Labels"]}
			lock.Unlock()
			_ = json.NewEncoder(w).Encode(map[string]string{"Id": "network-fixed"})
			return
		}
		lock.Lock()
		defer lock.Unlock()
		if path == "/networks" {
			value := []map[string]any{}
			if created != nil {
				value = append(value, created)
			}
			_ = json.NewEncoder(w).Encode(value)
			return
		}
		if path == "/networks/network-fixed" {
			_ = json.NewEncoder(w).Encode(created)
			return
		}
		http.NotFound(w, req)
	})}
	go server.Serve(listener)
	defer func() {
		select {
		case <-release:
		default:
			close(release)
		}
		server.Close()
		listener.Close()
	}()
	api, err := client.NewClientWithOpts(client.WithHost("unix://"+path), client.WithVersion("1.45"))
	if err != nil {
		t.Fatal(err)
	}
	defer api.Close()
	var intents atomic.Int64
	unconfirmed := errors.New("prior durable intent requires recovery")
	recorder := func(context.Context, ResourcePlan) error {
		if intents.Add(1) > 1 {
			return unconfirmed
		}
		return nil
	}
	engine := &Engine{api: api}
	runtime, err := NewRuntime(engine, "installation-fixture", recorder, nil)
	if err != nil {
		t.Fatal(err)
	}
	request, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	if _, err := runtime.EnsureNetwork(request, "work-fixture"); !errors.Is(err, ErrStateUnknown) {
		t.Fatal(err)
	}
	if _, err := runtime.EnsureNetwork(context.Background(), "work-fixture"); !errors.Is(err, ErrStateUnknown) {
		t.Fatal(err)
	}
	replacement, err := NewRuntime(engine, "installation-fixture", recorder, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := replacement.EnsureNetwork(context.Background(), "work-fixture"); !errors.Is(err, unconfirmed) {
		t.Fatal(err)
	}
	if count.Load() != 1 {
		t.Fatal("late network create repeated", count.Load())
	}
	close(release)
	deadline := time.Now().Add(time.Second)
	for {
		lock.Lock()
		done := created != nil
		lock.Unlock()
		if done {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("late network never appeared")
		}
		time.Sleep(time.Millisecond)
	}
	network, err := replacement.EnsureNetwork(context.Background(), "work-fixture")
	if err != nil || network.ID != "network-fixed" || count.Load() != 1 {
		t.Fatal(network, err, count.Load())
	}
}
