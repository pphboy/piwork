package workruntime

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"piwork/internal/agentclient"
	"piwork/internal/contracts"
	"piwork/internal/internaltls"
	"piwork/internal/rpc/agentv1"
)

func fixtureContext(t *testing.T) StartSpec {
	t.Helper()
	directory := filepath.Join(t.TempDir(), "work-1", "contexts", "context-1")
	if err := os.MkdirAll(directory, 0700); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"skills", "packages"} {
		if err := os.Mkdir(filepath.Join(directory, name), 0700); err != nil {
			t.Fatal(err)
		}
	}
	config := `{"agentImage":{"catalogId":"agent-image-0001"},"skills":[],"packages":[],"agentsMd":"","modelRef":"model-reference-1","mcpServers":[],"resources":{"cpuMillis":2000,"memoryBytes":1610612736,"agentCpuMillis":1000,"agentMemoryBytes":805306368,"maxServices":4,"maxRetainedVolumes":2},"tools":{"allowed":[],"denied":[]}}`
	metadata := `{"version":1,"snapshotId":"context-1","workId":"work-1","imageIdentity":"sha256:` + strings.Repeat("a", 64) + `","skills":[],"packageContractVersion":1,"packageBindings":[],"createdAt":"2026-09-30T00:00:00.000Z"}`
	for name, data := range map[string]string{"config.json": config, "metadata.json": metadata, "AGENTS.md": ""} {
		if err := os.WriteFile(filepath.Join(directory, name), []byte(data), 0600); err != nil {
			t.Fatal(err)
		}
	}
	return StartSpec{Scope: internaltls.Scope{InstallationID: "installation-1", WorkID: "work-1", Generation: 1, InstanceID: "agent-1"}, ContextID: "context-1", ContextDirectory: directory, ImageID: "sha256:" + strings.Repeat("a", 64), Model: Model{Provider: "piwork-deterministic", ID: "fixture-v1"}}
}

func TestCapturedContextIsBoundToWorkAndImage(t *testing.T) {
	spec := fixtureContext(t)
	config, _ := os.ReadFile(filepath.Join(spec.ContextDirectory, "config.json"))
	if _, err := contracts.Decode[contracts.WorkConfig](bytes.NewReader(config), "WorkConfigSchema", 2<<20); err != nil {
		t.Fatal("fixture work config:", err)
	}
	metadata, _ := os.ReadFile(filepath.Join(spec.ContextDirectory, "metadata.json"))
	if _, err := contracts.Decode[contracts.WorkContextMetadata](bytes.NewReader(metadata), "WorkContextMetadataSchema", 2<<20); err != nil {
		t.Fatal("fixture metadata:", err)
	}
	if _, err := readCaptured(spec); err != nil {
		t.Fatal(err)
	}
	for _, change := range []struct {
		name string
		edit func(*StartSpec)
	}{
		{"image", func(s *StartSpec) { s.ImageID = "sha256:" + strings.Repeat("b", 64) }},
		{"work", func(s *StartSpec) { s.Scope.WorkID = "work-2" }},
		{"context", func(s *StartSpec) { s.ContextID = "context-2" }},
	} {
		t.Run(change.name, func(t *testing.T) {
			copy := spec
			change.edit(&copy)
			if _, err := readCaptured(copy); !errors.Is(err, ErrContext) {
				t.Fatal("foreign context admitted", err)
			}
		})
	}
	if err := os.Remove(filepath.Join(spec.ContextDirectory, "metadata.json")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(spec.ContextDirectory, "config.json"), filepath.Join(spec.ContextDirectory, "metadata.json")); err != nil {
		t.Fatal(err)
	}
	if _, err := readCaptured(spec); !errors.Is(err, ErrContext) {
		t.Fatal("linked context metadata admitted", err)
	}
}

func TestReadyResourcesRejectMissingCapturedSkillAndPackage(t *testing.T) {
	spec := fixtureContext(t)
	captured, err := readCaptured(spec)
	if err != nil {
		t.Fatal(err)
	}
	ready := &agentv1.ReadinessResponse{ResolvedTools: []string{"read", "bash", "edit", "write", "grep", "find", "ls"}}
	if err := verifyResources(ready, captured); err != nil {
		t.Fatal(err)
	}
	ready.LoadedSkills = []*agentv1.LoadedSkill{{Name: "unexpected", Loaded: true}}
	if err := verifyResources(ready, captured); !errors.Is(err, agentclient.ErrReadiness) {
		t.Fatal("extra Skill admitted", err)
	}
	ready.LoadedSkills = nil
	ready.LoadedPackages = []*agentv1.LoadedPackage{{Name: "unexpected"}}
	if err := verifyResources(ready, captured); !errors.Is(err, agentclient.ErrReadiness) {
		t.Fatal("extra package admitted", err)
	}
}

func TestCapturedContextRejectsOtherWritableFiles(t *testing.T) {
	spec := fixtureContext(t)
	path := filepath.Join(spec.ContextDirectory, "config.json")
	if err := os.Chmod(path, 0666); err != nil {
		t.Fatal(err)
	}
	if _, err := readCaptured(spec); !errors.Is(err, ErrContext) {
		t.Fatal("other-writable context admitted", err)
	}
}

func TestCapturedAgentsAndHistoricalPackageFieldsFailClosed(t *testing.T) {
	for _, fault := range []string{"agents-missing", "agents-over-limit", "agents-invalid-encoding", "config-no-packages", "metadata-no-bindings", "metadata-old-contract"} {
		t.Run(fault, func(t *testing.T) {
			spec := fixtureContext(t)
			path := filepath.Join(spec.ContextDirectory, "AGENTS.md")
			var target string
			switch fault {
			case "agents-missing":
				if err := os.Remove(path); err != nil {
					t.Fatal(err)
				}
			case "agents-over-limit":
				if err := os.WriteFile(path, bytes.Repeat([]byte("x"), (256<<10)+1), 0600); err != nil {
					t.Fatal(err)
				}
			case "agents-invalid-encoding":
				if err := os.WriteFile(path, []byte{255, 254}, 0600); err != nil {
					t.Fatal(err)
				}
			case "config-no-packages":
				target = "config.json"
			default:
				target = "metadata.json"
			}
			if target != "" {
				path = filepath.Join(spec.ContextDirectory, target)
				data, err := os.ReadFile(path)
				if err != nil {
					t.Fatal(err)
				}
				switch fault {
				case "config-no-packages":
					data = bytes.Replace(data, []byte(`"packages":[],`), nil, 1)
				case "metadata-no-bindings":
					data = bytes.Replace(data, []byte(`"packageBindings":[],`), nil, 1)
				case "metadata-old-contract":
					data = bytes.Replace(data, []byte(`"packageContractVersion":1`), []byte(`"packageContractVersion":0`), 1)
				}
				if err := os.WriteFile(path, data, 0600); err != nil {
					t.Fatal(err)
				}
			}
			before, beforeErr := os.ReadFile(path)
			if _, err := readCaptured(spec); !errors.Is(err, ErrContext) {
				t.Fatal("invalid/historical context admitted", err)
			}
			after, afterErr := os.ReadFile(path)
			if !bytes.Equal(before, after) || (beforeErr == nil) != (afterErr == nil) {
				t.Fatal("validation backfilled or repaired immutable input")
			}
		})
	}
	if value, err := readCaptured(fixtureContext(t)); err != nil || value.config.Packages == nil || value.metadata.PackageBindings == nil {
		t.Fatal("fresh explicit empty package context rejected", err)
	}
}
