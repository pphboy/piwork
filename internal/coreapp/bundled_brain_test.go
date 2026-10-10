package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"piwork/internal/contracts"
	"piwork/internal/coreassets"
	"piwork/internal/corestore"
	"piwork/internal/packageprepare"
	"piwork/internal/pipackage"
)

// Pure native artifact fixture for tests which replace the Engine dependency.
// Production always uses the isolated helper's prepare/capture pipeline.
func unitBrainPreparer(t *testing.T, edits ...func(string)) func(context.Context) (packageprepare.Result, error) {
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
		for _, edit := range edits {
			edit(target)
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

// A minimal old package is sufficient for catalog migration tests. It has real
// validated bytes and a distinct legacy cognition, never production resources.
func legacyBrainPreparer(t *testing.T) func(context.Context) (packageprepare.Result, error) {
	t.Helper()
	return unitBrainPreparer(t, func(directory string) {
		for name, content := range map[string]string{
			"package.json":                        `{"name":"piwork-brain","version":"1.0.0","type":"module","pi":{"extensions":["extensions/brain.js"],"skills":["skills"]}}`,
			"brain.md":                            "Legacy workstation cognition uses Python/NiceGUI.\n",
			"skills/deploy-work-service/SKILL.md": "---\nname: deploy-work-service\ndescription: Legacy service deployment\n---\nUse Python/NiceGUI.\n",
		} {
			if err := os.WriteFile(filepath.Join(directory, name), []byte(content), 0600); err != nil {
				t.Fatal(err)
			}
		}
	})
}

func installLegacyBrain(t *testing.T, a *Application, ids ...string) corestore.PackageArtifact {
	t.Helper()
	ctx := context.Background()
	result, err := legacyBrainPreparer(t)(ctx)
	if err != nil {
		t.Fatal(err)
	}
	storage, err := a.publishCorePackageBytes(ctx, result)
	if err != nil {
		t.Fatal(err)
	}
	metadata, _ := json.Marshal(result.Artifact.Metadata)
	artifact := corestore.PackageArtifact{ID: bundledBrainArtifactID, ScopeKind: "core", Name: coreassets.BrainPackageName, ContentDigest: string(result.Artifact.Metadata.ContentDigest), MetadataJSON: string(metadata), StoragePath: storage, CreatedAt: packageNow()}
	if len(ids) != 0 {
		artifact.ID = ids[0]
	}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		if err := corestore.InsertPackageArtifact(tx, artifact); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO pi_package_catalog(name,enabled,head_artifact_id,generation,created_at,updated_at) VALUES(?,1,?,1,?,?) ON CONFLICT(name) DO UPDATE SET head_artifact_id=excluded.head_artifact_id,generation=generation+1`, artifact.Name, artifact.ID, artifact.CreatedAt, artifact.CreatedAt); err != nil {
			return err
		}
		_, err := tx.Exec(`INSERT INTO control_metadata(key,value_json,updated_at) VALUES('piwork_brain_seeded','{"seeded":true}',?) ON CONFLICT(key) DO NOTHING`, artifact.CreatedAt)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	return artifact
}

func brainHead(t *testing.T, a *Application) (string, int64) {
	t.Helper()
	var head string
	var generation int64
	if err := a.Store.Read(context.Background(), func(tx *sql.Tx) error {
		return tx.QueryRow(`SELECT head_artifact_id,generation FROM pi_package_catalog WHERE name='piwork-brain'`).Scan(&head, &generation)
	}); err != nil {
		t.Fatal(err)
	}
	return head, generation
}

func TestBundledBrainUpdatesLegacySeedAndPreservesDefaults(t *testing.T) {
	a, _, _ := appFixture(t, Options{})
	old := installLegacyBrain(t, a)
	before, _ := a.Store.DefaultWork(context.Background())
	a.prepareBrainForTest = unitBrainPreparer(t)
	if err := a.ensureBundledBrain(context.Background()); err != nil {
		t.Fatal(err)
	}
	head, generation := brainHead(t, a)
	if !strings.HasPrefix(head, bundledBrainArtifactID+":1.1.0:") || generation != 2 {
		t.Fatal(head, generation)
	}
	after, _ := a.Store.DefaultWork(context.Background())
	left, _ := json.Marshal(before)
	right, _ := json.Marshal(after)
	if string(left) != string(right) {
		t.Fatal("update changed default configuration")
	}
	if raw, err := os.ReadFile(filepath.Join(a.options.DataDirectory, old.StoragePath, "brain.md")); err != nil || !strings.Contains(string(raw), "NiceGUI") {
		t.Fatal("old immutable package lost", err)
	}
	a.prepareBrainForTest = func(context.Context) (packageprepare.Result, error) {
		t.Fatal("same version prepared twice")
		return packageprepare.Result{}, nil
	}
	if err := a.ensureBundledBrain(context.Background()); err != nil {
		t.Fatal(err)
	}
	if actual, g := brainHead(t, a); actual != head || g != generation {
		t.Fatal("repeated startup published twice", actual, g)
	}
}

func TestBundledBrainUpdateFailuresRetainOldHeadAndRetry(t *testing.T) {
	for _, stage := range []string{"prepare", "publish"} {
		t.Run(stage, func(t *testing.T) {
			a, _, _ := appFixture(t, Options{})
			installLegacyBrain(t, a)
			a.prepareBrainForTest = unitBrainPreparer(t)
			if stage == "prepare" {
				a.prepareBrainForTest = func(context.Context) (packageprepare.Result, error) {
					return packageprepare.Result{}, errors.New("fixture prepare failure")
				}
			} else if err := a.Store.Write(context.Background(), func(tx *sql.Tx) error {
				_, err := tx.Exec(`CREATE TRIGGER upgrade_abort BEFORE UPDATE ON pi_package_catalog BEGIN SELECT RAISE(ABORT,'fixture publication failure'); END`)
				return err
			}); err != nil {
				t.Fatal(err)
			}
			if err := a.ensureBundledBrain(context.Background()); err == nil {
				t.Fatal("failed upgrade reported success")
			}
			if head, generation := brainHead(t, a); head != bundledBrainArtifactID || generation != 1 || a.bundledBrainPreparing.Load() {
				t.Fatal("failed upgrade changed head or retained gate", head, generation)
			}
			if stage == "publish" {
				if err := a.Store.Write(context.Background(), func(tx *sql.Tx) error { _, err := tx.Exec(`DROP TRIGGER upgrade_abort`); return err }); err != nil {
					t.Fatal(err)
				}
			}
			a.prepareBrainForTest = unitBrainPreparer(t)
			if err := a.ensureBundledBrain(context.Background()); err != nil {
				t.Fatal(err)
			}
			if _, generation := brainHead(t, a); generation != 2 {
				t.Fatal("retry did not publish exactly once", generation)
			}
		})
	}
}

func TestBundledBrainUpdateProtectsAdministratorChoices(t *testing.T) {
	for _, choice := range []string{"disabled", "removed", "replaced", "empty-default"} {
		t.Run(choice, func(t *testing.T) {
			a, _, _ := appFixture(t, Options{})
			old := installLegacyBrain(t, a)
			if err := a.Store.Write(context.Background(), func(tx *sql.Tx) error {
				switch choice {
				case "disabled":
					_, err := tx.Exec(`UPDATE pi_package_catalog SET enabled=0 WHERE name='piwork-brain'`)
					return err
				case "removed":
					_, err := tx.Exec(`DELETE FROM pi_package_catalog WHERE name='piwork-brain'`)
					return err
				case "replaced":
					old.ID = "core:administrator-customized"
					if err := corestore.InsertPackageArtifact(tx, old); err != nil {
						return err
					}
					_, err := tx.Exec(`UPDATE pi_package_catalog SET head_artifact_id=? WHERE name='piwork-brain'`, old.ID)
					return err
				}
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			if choice == "empty-default" {
				// Use the real default selection API to save an explicit empty list.
				profile := RuntimeProfile{Revision: 1, AgentImage: "fixture/native"}
				config := defaultWorkConfiguration(profile)
				config.Packages = contracts.PiPackageSelection{}
				defaults, _ := a.Store.DefaultWork(context.Background())
				if _, err := a.Store.CompareAndSwapDefaultWork(context.Background(), defaults.Revision, config); err != nil {
					t.Fatal(err)
				}
				a.prepareBrainForTest = unitBrainPreparer(t)
			} else {
				a.prepareBrainForTest = func(context.Context) (packageprepare.Result, error) {
					t.Fatal("administrator choice prepared over")
					return packageprepare.Result{}, nil
				}
			}
			if err := a.ensureBundledBrain(context.Background()); err != nil {
				t.Fatal(err)
			}
			if choice == "empty-default" {
				defaults, _ := a.Store.DefaultWork(context.Background())
				if defaults.Configuration == nil || len(defaults.Configuration.Packages) != 0 || defaults.Revision != 1 {
					t.Fatal("empty defaults overwritten", defaults)
				}
				if _, generation := brainHead(t, a); generation != 2 {
					t.Fatal("enabled package was not updated", generation)
				}
			} else if choice != "removed" {
				if head, generation := brainHead(t, a); head != old.ID || generation != 1 {
					t.Fatal("protected head changed", head, generation)
				}
			}
		})
	}
}

func TestBundledBrainUpdateFencesLatePublication(t *testing.T) {
	a, _, _ := appFixture(t, Options{})
	installLegacyBrain(t, a)
	prepare := unitBrainPreparer(t)
	a.prepareBrainForTest = func(ctx context.Context) (packageprepare.Result, error) {
		// Simulate a previously accepted change winning publication. Normal
		// admissions are additionally rejected while the startup gate is held.
		if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
			_, err := tx.Exec(`UPDATE pi_package_catalog SET generation=generation+1 WHERE name='piwork-brain'`)
			return err
		}); err != nil {
			t.Fatal(err)
		}
		return prepare(ctx)
	}
	if err := a.ensureBundledBrain(context.Background()); err != nil {
		t.Fatal(err)
	}
	if head, generation := brainHead(t, a); head != bundledBrainArtifactID || generation != 2 {
		t.Fatal("late publication overwrote a changed generation", head, generation)
	}
}

func TestBundledBrainUpdateSharesCorePackageGate(t *testing.T) {
	a, base, operator := appFixture(t, Options{})
	installLegacyBrain(t, a)
	request, _ := json.Marshal(map[string]any{"kind": "install", "name": "", "source": map[string]string{"kind": "npm", "spec": "test-package"}, "addToDefaults": false})
	accepted, err := a.Store.AcceptMutation(context.Background(), corestore.MutationRequest{PrincipalID: "operator", WorkScope: "core", Kind: "pi-package-install", IdempotencyKey: "before-brain-upgrade", RequestJSON: string(request), TargetVersion: 1, Now: packageNow()}, func(tx *sql.Tx, id string) (corestore.MutationEffect, error) {
		return corestore.MutationEffect{ResourceID: "core-pi-packages"}, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	prepare := unitBrainPreparer(t)
	a.prepareBrainForTest = func(ctx context.Context) (packageprepare.Result, error) {
		if len(a.packageSlots) != 1 {
			t.Fatal("startup preparation did not reserve package capacity")
		}
		for _, path := range []string{"/control/packages/piwork-brain/enable", "/control/packages"} {
			var body any
			if path == "/control/packages" {
				body = map[string]any{"source": map[string]string{"kind": "npm", "spec": "test-package"}, "idempotencyKey": "during-brain-upgrade"}
			}
			status, view := httpCall(t, base, path, "POST", "Operator "+operator, body)
			if status != 409 || view["code"] != "PI_PACKAGE_BUSY" {
				t.Fatal("Core package mutation bypassed gate", status, view)
			}
		}
		status, view := httpCall(t, base, "/control/packages", "POST", "Operator "+operator, map[string]any{"source": map[string]string{"kind": "npm", "spec": "test-package"}, "idempotencyKey": "before-brain-upgrade"})
		if status != 202 || view["operationId"] != accepted.OperationID || view["reused"] != true {
			t.Fatal("startup gate broke accepted request replay", status, view)
		}
		return prepare(ctx)
	}
	if err := a.ensureBundledBrain(context.Background()); err != nil {
		t.Fatal(err)
	}
	// An accepted ordinary package job must also prevent the next update.
	seedRecoverableCorePackage(t, a, "prepare", "", false)
	if err := a.Store.Write(context.Background(), func(tx *sql.Tx) error {
		metadata := `json_set(metadata_json,'$.version','1.0.0')`
		_, err := tx.Exec(`UPDATE pi_package_artifacts SET metadata_json=` + metadata + ` WHERE id=(SELECT head_artifact_id FROM pi_package_catalog WHERE name='piwork-brain')`)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	a.prepareBrainForTest = func(context.Context) (packageprepare.Result, error) {
		t.Fatal("ordinary Core job gate bypassed")
		return packageprepare.Result{}, nil
	}
	if err := a.ensureBundledBrain(context.Background()); packageFailureCode(err) != "PI_PACKAGE_BUSY" {
		t.Fatal("existing Core job did not fence update", err)
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
