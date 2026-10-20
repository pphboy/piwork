package workcontext

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"piwork/internal/contracts"
	"piwork/internal/corestore"
)

func TestPublishedContextReadsAndConfigurationPublicationCanOverlap(t *testing.T) {
	directory := t.TempDir()
	store, err := corestore.Open(context.Background(), corestore.Options{Directory: directory})
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	config := contracts.WorkConfig{
		AgentImage: contracts.ImageSelection{CatalogId: "runtime-image-00000001"},
		Skills:     contracts.SkillSelection{}, Packages: contracts.PiPackageSelection{},
		AgentsMd: "Original instructions", ModelRef: "runtime-model-00000001", McpServers: []contracts.McpServer{},
		Resources: contracts.ResourcePolicy{CpuMillis: 2000, MemoryBytes: 1610612736, AgentCpuMillis: 1000, AgentMemoryBytes: 805306368, MaxServices: 4, MaxRetainedVolumes: 2},
		Tools:     contracts.ToolPolicy{Allowed: []contracts.WorkToolPolicyKey{}, Denied: []contracts.WorkToolPolicyKey{}},
	}
	image := "sha256:" + strings.Repeat("a", 64)
	now := time.Now().UTC().Format(time.RFC3339Nano)
	original, err := BuildDefault(store, directory, "work-concurrent", config, image, now)
	if err != nil {
		t.Fatal(err)
	}
	// A reader may keep its pinned namespace while another request publishes a
	// fresh context. The installation's exclusive owner must remain enforced.
	pinned, err := store.OpenWorksRoot()
	if err != nil {
		t.Fatal(err)
	}
	defer pinned.Close()
	if other, err := corestore.Open(context.Background(), corestore.Options{Directory: directory}); err == nil {
		other.Close()
		t.Fatal("concurrent Core acquired the installation")
	}
	done := make(chan struct{})
	var readers sync.WaitGroup
	for n := 0; n < 6; n++ {
		readers.Add(1)
		go func() {
			defer readers.Done()
			for {
				select {
				case <-done:
					return
				default:
				}
				metadata, err := Metadata(store, "work-concurrent", original.ID)
				if err != nil || metadata.SnapshotId != original.ID || string(metadata.ImageIdentity) != image {
					t.Errorf("published context read during Save: %v", err)
					return
				}
			}
		}()
	}
	defer func() { close(done); readers.Wait() }()
	for n := 0; n < 12; n++ {
		config.AgentsMd = "Saved instructions " + strings.Repeat("x", n)
		candidate, err := BuildPreservingSkills(store, directory, "work-concurrent", original.ID, config, image, now)
		if err != nil {
			t.Fatalf("Save while published context is read: %v", err)
		}
		if err := RemoveCandidate(store, "work-concurrent", candidate.ID); err != nil {
			t.Fatal(err)
		}
	}
	if bytes, err := os.ReadFile(filepath.Join(original.Directory, "AGENTS.md")); err != nil || string(bytes) != "Original instructions" {
		t.Fatal("publication changed the original context", err)
	}
}
