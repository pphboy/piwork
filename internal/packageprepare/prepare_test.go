package packageprepare

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"piwork/internal/contracts"
	"piwork/internal/dockerengine"
	"piwork/internal/packagehelper"
	"piwork/internal/pipackage"
)

type fixtureRuntime struct {
	mu           sync.Mutex
	work, spool  string
	planned      map[string]bool
	live         map[string]bool
	runs         map[string]int
	bytes        int64
	prepareError error
	blockPrepare bool
	failCleanup  bool
	corrupt      string
	resources    bool
}

func (f *fixtureRuntime) EnsurePackageResources(context.Context, dockerengine.PackageIdentity) (dockerengine.PackageResources, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.resources = true
	return dockerengine.PackageResources{}, nil
}
func (f *fixtureRuntime) EnsurePackageHelper(_ context.Context, s dockerengine.PackageHelperSpec) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if !f.planned[s.Action] {
		return "", errors.New("create before durable plan")
	}
	f.live[s.Action] = true
	return s.Action, nil
}
func (f *fixtureRuntime) RunPackageHelper(ctx context.Context, s dockerengine.PackageHelperSpec) (json.RawMessage, error) {
	f.mu.Lock()
	f.runs[s.Action]++
	f.mu.Unlock()
	switch s.Action {
	case "init":
		return json.RawMessage(`{"initialized":true}`), nil
	case "measure":
		raw, _ := json.Marshal(map[string]int64{"bytes": f.bytes})
		return raw, nil
	case "prepare":
		if f.blockPrepare {
			<-ctx.Done()
			return nil, ctx.Err()
		}
		if f.prepareError != nil {
			return nil, f.prepareError
		}
		return json.RawMessage(`{"name":"tools","version":"1.0.0","sourceKind":"local","resolvedSource":"tools-dir"}`), nil
	case "capture":
		result, err := (packagehelper.Helper{Paths: packagehelper.Paths{WorkRoot: f.work, SpoolRoot: f.spool}}).Run(ctx, "capture")
		if err != nil {
			return nil, err
		}
		captured := result.(packagehelper.Captured)
		if f.corrupt == "bytes" {
			os.WriteFile(filepath.Join(f.spool, "artifact.zip"), []byte("bad bytes"), 0644)
		}
		if f.corrupt == "inventory" {
			captured.Inventory.Prompts = append(captured.Inventory.Prompts, "invented.md")
		}
		if f.corrupt == "environment" {
			captured.Metadata.PreparedEnvironment.NodeAbi = "999"
		}
		if f.corrupt == "version" {
			captured.Metadata.Version = json.RawMessage(`null`)
		}
		raw, _ := json.Marshal(captured)
		return raw, nil
	}
	return nil, ErrResult
}
func (f *fixtureRuntime) RemovePackageHelper(_ context.Context, s dockerengine.PackageHelperSpec) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.failCleanup {
		return errors.New("unconfirmed Engine stop")
	}
	delete(f.live, s.Action)
	return nil
}
func (f *fixtureRuntime) RemovePackageResources(context.Context, dockerengine.PackageIdentity) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.live) > 0 {
		return errors.New("resource still has writer")
	}
	f.resources = false
	return nil
}

func prepareFixture(t *testing.T) (Input, *fixtureRuntime) {
	t.Helper()
	work := t.TempDir()
	spool := t.TempDir()
	result := filepath.Join(work, "result")
	if err := os.Mkdir(result, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(result, "package.json"), []byte(`{"name":"tools","version":"1.0.0","pi":{"prompts":["prompt.md"]}}`), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(result, "prompt.md"), []byte("Review these files.\n"), 0644); err != nil {
		t.Fatal(err)
	}
	f := &fixtureRuntime{work: work, spool: spool, planned: map[string]bool{}, live: map[string]bool{}, runs: map[string]int{}, bytes: 1024}
	environment := contracts.PiPackagePreparedEnvironment{Os: "linux", Architecture: "amd64", Variant: json.RawMessage(`null`), NodeAbi: "137", PiSdkVersion: "0.86.1"}
	input := Input{Runtime: f, Identity: dockerengine.PackageIdentity{WorkID: "core", JobID: "job-fixture"}, Epoch: 1, PrepareImageID: "sha256:" + strings.Repeat("a", 64), TrustedImageID: "sha256:" + strings.Repeat("a", 64), SourceDirectory: t.TempDir(), SpoolDirectory: spool, Environment: environment, monitorInterval: time.Millisecond,
		OnPlanned: func(_ context.Context, s dockerengine.PackageHelperSpec) error {
			f.mu.Lock()
			defer f.mu.Unlock()
			f.planned[s.Action] = true
			return nil
		},
		OnRemoved: func(_ context.Context, s dockerengine.PackageHelperSpec) error {
			f.mu.Lock()
			defer f.mu.Unlock()
			if f.live[s.Action] {
				return errors.New("release before confirmed exit")
			}
			delete(f.planned, s.Action)
			return nil
		},
		OnResourcesRemoved: func(context.Context) error {
			f.mu.Lock()
			defer f.mu.Unlock()
			if f.resources {
				return errors.New("release live resource")
			}
			return nil
		}}
	return input, f
}

func TestPrepareIndependentlyVerifiesCompleteArtifact(t *testing.T) {
	input, f := prepareFixture(t)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	result, err := Prepare(ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	if result.Artifact.Metadata.Name != "tools" || result.ZipBytes <= 0 || len(result.ZipSHA256) != 64 || result.Artifact.Metadata.ResourceCounts.Prompts != 1 {
		t.Fatal(result)
	}
	if f.resources || len(f.live) != 0 || len(f.planned) != 0 || f.runs["prepare"] != 1 {
		t.Fatal("resource leak or duplicate script", f)
	}
	if _, err := os.Stat(filepath.Join(f.spool, "validation-job-fixture")); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("validation tree remains", err)
	}
}

func TestPrepareRejectsForgedCaptureAndPreservesCleanup(t *testing.T) {
	for _, kind := range []string{"bytes", "inventory", "environment", "version"} {
		t.Run(kind, func(t *testing.T) {
			input, f := prepareFixture(t)
			f.corrupt = kind
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			result, err := Prepare(ctx, input)
			if err == nil || result.ZipPath != "" {
				t.Fatal("forged result published", result)
			}
			if f.resources || len(f.live) > 0 || len(f.planned) > 0 {
				t.Fatal("cleanup did not settle", f)
			}
		})
	}
}

func TestPrepareSpaceFailureWinsOverCancelledScript(t *testing.T) {
	input, f := prepareFixture(t)
	f.blockPrepare = true
	f.bytes = pipackage.PreparationBytes + 1
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	_, err := Prepare(ctx, input)
	if !errors.Is(err, pipackage.ErrLimit) {
		t.Fatal("space failure masked by cancelled script", err)
	}
	if f.resources || len(f.live) > 0 || f.runs["prepare"] > 1 {
		t.Fatal("cleanup or at-most-once failed", f)
	}
}

func TestPrepareCleanupPendingRetainsPrimaryFailureAndResources(t *testing.T) {
	input, f := prepareFixture(t)
	f.prepareError = &pipackage.InputError{Code: "PI_PACKAGE_DEPENDENCY_INSTALL_FAILED"}
	// Fail only prepare cleanup, after init has settled successfully.
	base := input.OnPlanned
	input.OnPlanned = func(ctx context.Context, s dockerengine.PackageHelperSpec) error {
		if s.Action == "prepare" {
			f.mu.Lock()
			f.failCleanup = true
			f.mu.Unlock()
		}
		return base(ctx, s)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	_, err := Prepare(ctx, input)
	if !errors.Is(err, ErrCleanup) || !errors.Is(err, f.prepareError) {
		t.Fatal("cleanup replaced primary error", err)
	}
	if !f.resources || len(f.live) == 0 || len(f.planned) == 0 {
		t.Fatal("unconfirmed resources released", f)
	}
}

func TestPrepareCancellationDoesNotReleaseBeforeConfirmedExit(t *testing.T) {
	input, f := prepareFixture(t)
	f.blockPrepare = true
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	_, err := Prepare(ctx, input)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatal(err)
	}
	if f.resources || len(f.live) > 0 || f.runs["prepare"] != 1 {
		t.Fatal("helper not stopped exactly once", f)
	}
}
