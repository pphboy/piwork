package dockerengine

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/moby/moby/api/types/container"
	"github.com/moby/moby/client"
)

func TestManagedLogPolicyOnlyAppliesToNewAgentAndService(t *testing.T) {
	for _, test := range []struct {
		kind    string
		want    string
		version int64
	}{
		{"agent", "json-file", ManagedContainerLogPolicyVersion},
		{"service", "json-file", ManagedContainerLogPolicyVersion},
		{"file-helper", "", LegacyContainerLogPolicyVersion},
		{"snapshot-helper", "", LegacyContainerLogPolicyVersion},
	} {
		policy, version := managedLogPolicy(test.kind)
		if policy.Type != test.want || version != test.version {
			t.Fatalf("%s: %#v %d", test.kind, policy, version)
		}
	}
	if ObservedContainerLogPolicyVersion(nil) != LegacyContainerLogPolicyVersion ||
		ObservedContainerLogPolicyVersion(&container.HostConfig{LogConfig: container.LogConfig{Type: "journald"}}) != LegacyContainerLogPolicyVersion ||
		ObservedContainerLogPolicyVersion(&container.HostConfig{LogConfig: container.LogConfig{Type: "json-file", Config: map[string]string{"max-size": "16m"}}}) != LegacyContainerLogPolicyVersion ||
		ObservedContainerLogPolicyVersion(&container.HostConfig{LogConfig: container.LogConfig{Type: "json-file", Config: map[string]string{"max-size": "16m", "max-file": "4"}}}) != ManagedContainerLogPolicyVersion {
		t.Fatal("observed policy version does not follow the actual configuration")
	}
}

type policyFixture struct {
	runtime  *Runtime
	create   atomic.Value
	count    atomic.Int64
	existing *container.InspectResponse
}

func newPolicyFixture(t *testing.T, existing *container.InspectResponse) *policyFixture {
	t.Helper()
	path := shortEngineSocket(t, "policy.sock")
	listener, err := net.Listen("unix", path)
	if err != nil {
		t.Fatal(err)
	}
	fixture := &policyFixture{existing: existing}
	handler := http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		path := strings.TrimPrefix(req.URL.Path, "/v1.45")
		switch {
		case path == "/containers/create" && req.Method == http.MethodPost:
			fixture.count.Add(1)
			var body container.CreateRequest
			if json.NewDecoder(req.Body).Decode(&body) != nil {
				http.Error(w, `{"message":"bad"}`, 400)
				return
			}
			fixture.create.Store(body)
			created := &container.InspectResponse{ID: "container-policy", Name: req.URL.Query().Get("name"), Config: body.Config, HostConfig: body.HostConfig}
			fixture.existing = created
			_ = json.NewEncoder(w).Encode(map[string]string{"Id": created.ID})
		case path == "/containers/json":
			var result []container.Summary
			if fixture.existing != nil {
				result = append(result, container.Summary{ID: fixture.existing.ID, Labels: fixture.existing.Config.Labels})
			}
			_ = json.NewEncoder(w).Encode(result)
		case fixture.existing != nil && path == "/containers/"+fixture.existing.ID+"/json":
			_ = json.NewEncoder(w).Encode(fixture.existing)
		default:
			http.NotFound(w, req)
		}
	})
	server := &http.Server{Handler: handler}
	go server.Serve(listener)
	t.Cleanup(func() {
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
	fixture.runtime = runtime
	return fixture
}

func TestNewContainersReceiveBoundedLogPolicyWithoutRecreatingExisting(t *testing.T) {
	fixture := newPolicyFixture(t, nil)
	ensured, err := fixture.runtime.EnsureContainer(context.Background(), fixtureSpec())
	if err != nil {
		t.Fatal(err)
	}
	if !ensured.Created || ensured.LogPolicyVersion != ManagedContainerLogPolicyVersion {
		t.Fatalf("new instance policy: %#v", ensured)
	}
	request := fixture.create.Load().(container.CreateRequest)
	if request.HostConfig == nil || request.HostConfig.LogConfig.Type != "json-file" ||
		request.HostConfig.LogConfig.Config["max-size"] != "16m" || request.HostConfig.LogConfig.Config["max-file"] != "4" {
		t.Fatalf("create request log policy: %#v", request.HostConfig)
	}

	spec, err := normalizeContainer(fixtureSpec())
	if err != nil {
		t.Fatal(err)
	}
	hash, err := containerSpecHash(spec)
	if err != nil {
		t.Fatal(err)
	}
	labels, err := fixture.runtime.containerLabels(spec.Identity)
	if err != nil {
		t.Fatal(err)
	}
	labels[SpecLabel] = hash
	legacy := &container.InspectResponse{
		ID: "container-legacy", Name: "/piwork-service-old",
		Config:     &container.Config{Labels: labels},
		HostConfig: &container.HostConfig{LogConfig: container.LogConfig{Type: "journald"}},
	}
	fixture = newPolicyFixture(t, legacy)
	ensured, err = fixture.runtime.EnsureContainer(context.Background(), fixtureSpec())
	if err != nil {
		t.Fatalf("legacy adoption failed: %v", err)
	}
	if ensured.Created || ensured.ID != "container-legacy" || ensured.LogPolicyVersion != LegacyContainerLogPolicyVersion {
		t.Fatalf("legacy instance was rewritten: %#v", ensured)
	}
	if fixture.count.Load() != 0 {
		t.Fatal("legacy instance was recreated to change log policy")
	}
}
