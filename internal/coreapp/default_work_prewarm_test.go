package coreapp

import (
	"context"
	"database/sql"
	"sync/atomic"
	"testing"
	"time"

	"piwork/internal/contracts"
)

func TestDefaultImageReferenceResolutionDoesNotRequireModelSecrets(t *testing.T) {
	a, _, _ := appFixture(t, Options{})
	if err := a.Store.Write(context.Background(), func(tx *sql.Tx) error {
		_, err := tx.Exec(`INSERT INTO catalog_entries(id,kind,name,enabled,mutable_reference,metadata_json,created_at,updated_at) VALUES('image-default-fixture','agent_image','Independent default',1,'fixture/independent:one','{"version":1}',?,?)`, packageNow(), packageNow())
		return err
	}); err != nil {
		t.Fatal(err)
	}
	reference, err := a.selectedWorkImageReference(context.Background(), contracts.ResourceId("image-default-fixture"))
	if err != nil || reference != "fixture/independent:one" {
		t.Fatal(reference, err)
	}
	if _, configured, err := a.Settings.LoadRuntime(); err != nil || configured {
		t.Fatal("image resolution unexpectedly needed a model", configured, err)
	}
}

func TestDefaultChangesSaveWithoutWaitingAndInvalidateOldPreparation(t *testing.T) {
	var block atomic.Bool
	started := make(chan int64, 8)
	release := make(chan struct{})
	a, base, operator := preparationFixture(t, func(p *runtimePreparation) {
		p.executeForTest = func(ctx context.Context, name string, _ RuntimeProfile) error {
			if name != "defaultContext" || !block.Load() {
				return nil
			}
			defaults, err := p.app.Store.DefaultWork(ctx)
			if err != nil {
				return err
			}
			started <- defaults.Revision
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-release:
				return p.app.confirmDefaultPreparationRevision(ctx)
			}
		}
	})
	waitPreparation(t, a, func(Preparation) bool { return a.Status().Ready })
	block.Store(true)
	start := time.Now()
	status, view := httpCall(t, base, "/control/default-work", "PUT", operator, map[string]any{"patch": map[string]any{"baseImage": "fixture/independent:new", "packages": []any{}}})
	if status != 200 || view["baseImage"] != "fixture/independent:new" || time.Since(start) > time.Second {
		t.Fatal("save waited for background preparation", status, view)
	}
	first := <-started
	if a.Status().Ready {
		t.Fatal("default change retained stale ready")
	}
	status, _ = httpCall(t, base, "/control/default-work", "PUT", operator, map[string]any{"patch": map[string]any{"agentsMd": "New instructions while preparing"}})
	if status != 200 {
		t.Fatal(status)
	}
	select {
	case second := <-started:
		if second <= first {
			t.Fatal("new defaults reused old snapshot", first, second)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("unrelated default revision left preparation stuck")
	}
	if a.Status().Ready {
		t.Fatal("old preparation published Ready")
	}
	if status, _ := httpCall(t, base, "/healthz", "GET", "", nil); status != 200 {
		t.Fatal("preparation blocked health", status)
	}
	block.Store(false)
	close(release)
	waitPreparation(t, a, func(Preparation) bool { return a.Status().Ready })
	defaults, err := a.Store.DefaultWork(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	a.mu.Lock()
	revision := a.preparation.request.defaultRevision
	a.mu.Unlock()
	if revision != defaults.Revision {
		t.Fatal("Ready not bound to latest defaults", revision, defaults.Revision)
	}
}
