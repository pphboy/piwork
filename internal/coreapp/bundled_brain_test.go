package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"piwork/internal/contracts"
	"piwork/internal/coreassets"
	"piwork/internal/packageprepare"
	"piwork/internal/pipackage"
)

// Pure native artifact fixture for tests which replace the Engine dependency.
// Production always uses the isolated helper's prepare/capture pipeline.
func unitBrainPreparer(t *testing.T) func(context.Context) (packageprepare.Result, error) {
	t.Helper()
	return func(ctx context.Context) (packageprepare.Result, error) {
		directory := t.TempDir()
		archive, err := coreassets.BrainPackageArchive()
		if err != nil {
			return packageprepare.Result{}, err
		}
		zip := filepath.Join(directory, "source.zip")
		if err = os.WriteFile(zip, archive, 0600); err != nil {
			return packageprepare.Result{}, err
		}
		target := filepath.Join(directory, "result")
		if _, err = pipackage.ExtractArchive(ctx, zip, target); err != nil {
			return packageprepare.Result{}, err
		}
		tree, err := pipackage.OpenTree(ctx, target)
		if err != nil {
			return packageprepare.Result{}, err
		}
		defer tree.Close()
		environment := contracts.PiPackagePreparedEnvironment{Os: "linux", Architecture: "amd64", Variant: json.RawMessage("null"), NodeAbi: "137", PiSdkVersion: "0.86.1"}
		artifact, err := pipackage.ValidateArtifact(tree, "local", "piwork-brain", environment, "")
		if err != nil {
			return packageprepare.Result{}, err
		}
		output := filepath.Join(directory, "artifact.zip")
		packed, err := pipackage.PackArchiveToSpool(ctx, tree, output)
		if err != nil {
			return packageprepare.Result{}, err
		}
		return packageprepare.Result{Artifact: artifact, ZipPath: output, ZipBytes: packed.Bytes, ZipSHA256: packed.Digest}, nil
	}
}

func TestBundledBrainCommitsCatalogDefaultAndSeedTogether(t *testing.T) {
	a, _, _ := appFixture(t, Options{Initialization: Initialization{Runtime: &RuntimeInput{AgentImage: "fixture/native", Provider: "piwork-deterministic", Model: "fixture", Credential: "test-only"}}})
	ctx := context.Background()
	a.prepareBrainForTest = unitBrainPreparer(t)
	if err := a.ensureBundledBrain(ctx); err != nil {
		t.Fatal(err)
	}
	defaults, err := a.Store.DefaultWork(ctx)
	if err != nil || defaults.Configuration == nil || len(defaults.Configuration.Skills) != 0 || len(defaults.Configuration.Packages) != 1 || defaults.Configuration.Packages[0].Name != "piwork-brain" {
		t.Fatal(defaults, err)
	}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		if _, err := tx.Exec("UPDATE pi_package_catalog SET enabled=0 WHERE name='piwork-brain'"); err != nil {
			return err
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	customized := *defaults.Configuration
	customized.Packages = contracts.PiPackageSelection{}
	customized.AgentsMd = "# Custom default"
	if _, err := a.Store.CompareAndSwapDefaultWork(ctx, defaults.Revision, customized); err != nil {
		t.Fatal(err)
	}
	a.prepareBrainForTest = func(context.Context) (packageprepare.Result, error) {
		t.Fatal("seed repeated after administrative edit")
		return packageprepare.Result{}, nil
	}
	if err := a.ensureBundledBrain(ctx); err != nil {
		t.Fatal(err)
	}
	after, err := a.Store.DefaultWork(ctx)
	if err != nil || len(after.Configuration.Packages) != 0 || after.Configuration.AgentsMd != "# Custom default" {
		t.Fatal(after, err)
	}
	var enabled bool
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		return tx.QueryRow("SELECT enabled FROM pi_package_catalog WHERE name='piwork-brain'").Scan(&enabled)
	}); err != nil || enabled {
		t.Fatal("disabled package resurrected", err)
	}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec("DELETE FROM pi_package_catalog WHERE name='piwork-brain'")
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if err := a.ensureBundledBrain(ctx); err != nil {
		t.Fatal(err)
	}
}

func TestBundledBrainFailedPrepareLeavesNoSeedAndPreservesExistingDefaults(t *testing.T) {
	a, _, _ := appFixture(t, Options{Initialization: Initialization{Runtime: &RuntimeInput{AgentImage: "fixture/native", Provider: "piwork-deterministic", Model: "fixture", Credential: "test-only"}}})
	ctx := context.Background()
	a.prepareBrainForTest = func(context.Context) (packageprepare.Result, error) {
		return packageprepare.Result{}, errors.New("native preparation failed")
	}
	if err := a.ensureBundledBrain(ctx); err == nil {
		t.Fatal("failed preparation advertised seeded")
	}
	var committed bool
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		return tx.QueryRow("SELECT EXISTS(SELECT 1 FROM control_metadata WHERE key='piwork_brain_seeded') OR EXISTS(SELECT 1 FROM pi_package_catalog WHERE name='piwork-brain')").Scan(&committed)
	}); err != nil || committed {
		t.Fatal("partial seed published", err)
	}
	defaults, err := a.Store.DefaultWork(ctx)
	if err != nil {
		t.Fatal(err)
	}
	profile, _, _ := a.Settings.LoadRuntime()
	config := defaultWorkConfiguration(profile)
	config.Packages = contracts.PiPackageSelection{}
	config.AgentsMd = "# Before initial prepare"
	if _, err := a.Store.CompareAndSwapDefaultWork(ctx, defaults.Revision, config); err != nil {
		t.Fatal(err)
	}
	a.prepareBrainForTest = unitBrainPreparer(t)
	if err := a.ensureBundledBrain(ctx); err != nil {
		t.Fatal(err)
	}
	after, err := a.Store.DefaultWork(ctx)
	if err != nil || len(after.Configuration.Packages) != 0 || after.Configuration.AgentsMd != config.AgentsMd {
		t.Fatal("initial seed overwrote administrator defaults", after, err)
	}
}

func TestBundledBrainSeedTransactionRollbackCanRetry(t *testing.T) {
	a, _, _ := appFixture(t, Options{Initialization: Initialization{Runtime: &RuntimeInput{AgentImage: "fixture/native", Provider: "piwork-deterministic", Model: "fixture", Credential: "test-only"}}})
	a.prepareBrainForTest = unitBrainPreparer(t)
	ctx := context.Background()
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec(`CREATE TRIGGER seed_abort BEFORE INSERT ON control_metadata WHEN NEW.key='piwork_brain_seeded' BEGIN SELECT RAISE(ABORT,'seed transaction fault'); END`)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if err := a.ensureBundledBrain(ctx); err == nil {
		t.Fatal("interrupted seed transaction succeeded")
	}
	var catalog bool
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		return tx.QueryRow("SELECT EXISTS(SELECT 1 FROM pi_package_catalog WHERE name='piwork-brain')").Scan(&catalog)
	}); err != nil || catalog {
		t.Fatal("catalog survived rolled back seed", err)
	}
	defaults, err := a.Store.DefaultWork(ctx)
	if err != nil || defaults.Configuration != nil || defaults.Revision != 0 {
		t.Fatal("partial default survived seed fault", defaults, err)
	}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error { _, err := tx.Exec("DROP TRIGGER seed_abort"); return err }); err != nil {
		t.Fatal(err)
	}
	if err := a.ensureBundledBrain(ctx); err != nil {
		t.Fatal(err)
	}
}
