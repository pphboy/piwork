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

func TestShutdownDetachesOriginalRoutesWithoutLosingDrainAuthority(t *testing.T) {
	routes := &Routes{works: make(map[string]route)}
	clients := map[string]*agentclient.Client{}
	scopes := map[string]internaltls.Scope{}
	lifetimes := map[string]context.Context{}
	for index, id := range []string{"first", "second"} {
		lifetime, cancel := context.WithCancel(context.Background())
		scope := internaltls.Scope{InstallationID: "install", WorkID: id, Generation: int64(index + 1), InstanceID: id + "-instance"}
		client := &agentclient.Client{}
		routes.works[id] = route{scope: scope, contextID: id + "-context", client: client, lifetime: lifetime, cancel: cancel}
		clients[id], scopes[id], lifetimes[id] = client, scope, lifetime
	}
	retained := routes.DetachForShutdown()
	if len(retained) != 2 {
		t.Fatalf("lost shutdown drain authorities: %d", len(retained))
	}
	for id, client := range clients {
		receipt := retained[id]
		if receipt.Client != client || receipt.Scope != scopes[id] || receipt.ContextID != id+"-context" {
			t.Fatal("retargeted original shutdown transport", id)
		}
		if lifetimes[id].Err() != context.Canceled {
			t.Fatal("existing request still admitted", id)
		}
		if _, _, err := routes.Admission(scopes[id], id+"-context"); err != ErrRouteUnavailable {
			t.Fatal("new request still admitted", id, err)
		}
		if routes.Revoke(id) != nil {
			t.Fatal("shutdown authority still publicly reachable", id)
		}
	}
	if len(routes.DetachForShutdown()) != 0 || len(routes.RevokeAll()) != 0 {
		t.Fatal("shutdown authority delivered more than once")
	}
}
