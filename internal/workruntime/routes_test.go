package workruntime

import (
	"context"
	"testing"

	"piwork/internal/agentclient"
	"piwork/internal/internaltls"
)

func TestRevokeAllCancelsEveryRouteLifetime(t *testing.T) {
	routes := &Routes{works: make(map[string]route)}
	var lifetimes []context.Context
	for _, id := range []string{"first", "second"} {
		lifetime, cancel := context.WithCancel(context.Background())
		scope := internaltls.Scope{InstallationID: "install", WorkID: id, Generation: 1, InstanceID: "instance"}
		routes.works[id] = route{scope: scope, contextID: "context", client: &agentclient.Client{}, lifetime: lifetime, cancel: cancel}
		lifetimes = append(lifetimes, lifetime)
	}
	if clients := routes.RevokeAll(); len(clients) != 2 {
		t.Fatalf("revoked %d clients, wanted 2", len(clients))
	}
	for _, lifetime := range lifetimes {
		if lifetime.Err() != context.Canceled {
			t.Fatal("route remained active")
		}
	}
	if _, _, err := routes.Admission(internaltls.Scope{WorkID: "first"}, "context"); err != ErrRouteUnavailable {
		t.Fatalf("revoked route admitted: %v", err)
	}
	if len(routes.RevokeAll()) != 0 {
		t.Fatal("revocation was not idempotent")
	}
}
