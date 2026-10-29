//go:build integration

package coreapp

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"piwork/internal/corestore"
	"piwork/internal/dockerengine"
)

func TestNativeBlockedPackageCleanupDoesNotBlockAnotherWork(t *testing.T) {
	a, base, auth, blockedID, ctx := nativeApplyFixture(t)
	status, created := packageHTTPCall(t, base, "/api/v1/works", "POST", auth, map[string]string{"name": "Independent Work", "idempotencyKey": "independent-work"})
	if status != 202 {
		t.Fatal(status, created)
	}
	independentID := created["workId"].(string)
	waitWorkOperation(t, ctx, a, created["operationId"].(string))
	blockedBefore, err := a.Store.Work(ctx, blockedID, false)
	if err != nil {
		t.Fatal(err)
	}
	independentBefore, err := a.Store.Work(ctx, independentID, false)
	if err != nil {
		t.Fatal(err)
	}
	options := a.options
	options.Initialization = Initialization{}
	closeCtx, cancel := context.WithTimeout(ctx, 45*time.Second)
	if err := a.Close(closeCtx); err != nil {
		cancel()
		t.Fatal(err)
	}
	cancel()
	store, err := corestore.Open(ctx, corestore.Options{Directory: options.DataDirectory})
	if err != nil {
		t.Fatal(err)
	}
	labels := map[string]string{dockerengine.InstallationLabel: store.InstallationID(), dockerengine.ManagedLabel: "true", dockerengine.WorkLabel: blockedID}
	intent := corestore.ResourceIntent{WorkID: blockedID, Kind: "package-helper", LogicalID: "unconfirmed-1-prepare", Name: "unconfirmed-package-helper", Generation: 1, Labels: labels}
	if err := store.RecordResourceIntent(ctx, intent); err != nil {
		store.Close()
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	next, nextBase, _ := appFixture(t, options)
	deadline := time.Now().Add(time.Minute)
	for {
		other, err := next.Store.Work(ctx, independentID, false)
		if err != nil {
			t.Fatal(err)
		}
		if other.ObservedState == "ready" {
			if status, sessions := packageHTTPCall(t, nextBase, "/api/v1/works/"+independentID+"/sessions", "GET", auth, nil); status == 200 && sessions["sessions"] != nil {
				break
			}
		}
		if time.Now().After(deadline) {
			t.Fatal("unrelated Work did not recover", other, next.Status())
		}
		time.Sleep(100 * time.Millisecond)
	}
	blocked, err := next.Store.Work(ctx, blockedID, false)
	if err != nil || blocked.ObservedState == "ready" || blocked.DesiredState != "running" {
		t.Fatal("blocked Work was incorrectly admitted", blocked, err)
	}
	if blocked.ActiveContextID == nil || independentBefore.ActiveContextID == nil || blockedBefore.ActiveContextID == nil || *blocked.ActiveContextID != *blockedBefore.ActiveContextID {
		t.Fatal("blocked Work changed captured context")
	}
	other, err := next.Store.Work(ctx, independentID, false)
	if err != nil || other.ActiveContextID == nil || *other.ActiveContextID != *independentBefore.ActiveContextID {
		t.Fatal("independent Work changed captured context", err)
	}
	if err := next.Store.Read(ctx, func(tx *sql.Tx) error {
		_, err := corestore.ReadResourceBinding(tx, next.Store.InstallationID(), blockedID, intent.Kind, intent.LogicalID)
		return err
	}); err != nil {
		t.Fatal("unconfirmed package resource was erased", err)
	}
	view, err := next.dockerRuntime.InspectContainer(ctx, dockerengine.ContainerIdentity{WorkID: blockedID, Kind: "agent", LogicalID: "agentd"})
	if err != nil || view != nil && view.State != nil && view.State.Running {
		t.Fatal("blocked Work started an Agent", err)
	}
}
