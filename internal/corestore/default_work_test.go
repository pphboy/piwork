package corestore

import (
	"context"
	"errors"
	"strings"
	"testing"

	"piwork/internal/contracts"
)

func TestDefaultWorkConfigurationCASPersistsWithoutLeakingRevision(t *testing.T) {
	directory := t.TempDir()
	store := openTestStore(t, directory)
	ctx := context.Background()
	initial, err := store.DefaultWork(ctx)
	if err != nil || initial.Revision != 0 || initial.Configuration != nil {
		t.Fatal("fresh default Work configuration mismatch", err, initial)
	}
	configuration, err := contracts.Decode[contracts.WorkConfig](strings.NewReader(`{"agentImage":{"catalogId":"runtime-image-00000001"},"skills":[],"packages":[],"agentsMd":"","modelRef":"runtime-model-00000001","mcpServers":[],"resources":{"cpuMillis":2000,"memoryBytes":1610612736,"agentCpuMillis":1000,"agentMemoryBytes":805306368,"maxServices":4,"maxRetainedVolumes":2},"tools":{"allowed":[],"denied":[]}}`), "WorkConfigSchema", 2<<20)
	if err != nil {
		t.Fatal(err)
	}
	first, err := store.CompareAndSwapDefaultWork(ctx, 0, configuration)
	if err != nil || first.Revision != 1 || first.Configuration == nil {
		t.Fatal("default Work CAS failed", err, first)
	}
	if _, err := store.CompareAndSwapDefaultWork(ctx, 0, configuration); !errors.Is(err, ErrRevisionConflict) {
		t.Fatal("stale default Work revision overwrote accepted value", err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	reopened := openTestStore(t, directory)
	defer reopened.Close()
	retained, err := reopened.DefaultWork(ctx)
	if err != nil || retained.Revision != 1 || retained.Configuration == nil || retained.Configuration.ModelRef != configuration.ModelRef {
		t.Fatal("default Work configuration lost on reopen", err, retained)
	}
}
