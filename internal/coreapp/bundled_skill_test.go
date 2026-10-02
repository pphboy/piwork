package coreapp

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/identity"
	"piwork/internal/skillartifact"
	"piwork/internal/workcontext"
)

func TestBuiltInDeploymentSkillPersistsAndRejectsTamper(t *testing.T) {
	directory := t.TempDir()
	a, _, _ := appFixture(t, Options{DataDirectory: directory})
	var digest string
	if err := a.Store.Read(context.Background(), func(tx *sql.Tx) error {
		return tx.QueryRow(`SELECT resolved_digest FROM catalog_entries WHERE id='deploy-work-service' AND kind='skill' AND enabled=1`).Scan(&digest)
	}); err != nil || !strings.HasPrefix(digest, "sha256:") {
		t.Fatal("built-in Skill was not registered", err, digest)
	}
	if err := a.Close(context.Background()); err != nil {
		t.Fatal(err)
	}
	b, err := New(context.Background(), Options{DataDirectory: directory})
	if err != nil {
		t.Fatal("built-in Skill was not stable on reopen", err)
	}
	if err := b.Close(context.Background()); err != nil {
		t.Fatal(err)
	}
	manifest := filepath.Join(directory, "skills", "deploy-work-service", "artifacts", strings.TrimPrefix(digest, "sha256:"), "SKILL.md")
	if err := os.WriteFile(manifest, []byte("tampered"), 0600); err != nil {
		t.Fatal(err)
	}
	if c, err := New(context.Background(), Options{DataDirectory: directory}); err == nil {
		c.Close(context.Background())
		t.Fatal("tampered built-in Skill was silently trusted")
	}
}

func TestDeploymentSkillSeedingDoesNotOverwriteOperatorChoices(t *testing.T) {
	for _, action := range []string{"update", "disable", "remove"} {
		t.Run(action, func(t *testing.T) {
			ctx := context.Background()
			directory := t.TempDir()
			a, _, _ := appFixture(t, Options{DataDirectory: directory})
			config := defaultWorkConfiguration(RuntimeProfile{Revision: 1})
			if err := a.Store.SyncDefaultWorkRuntime(ctx, 1, config.AgentImage.CatalogId, config.ModelRef, config); err != nil {
				t.Fatal(err)
			}
			// The preexisting Work-owned copy must remain independent even when
			// the ordinary managed catalog head is changed or removed.
			copy, err := workcontext.BuildDefault(a.Store, directory, "work-seed-preserved", config, "sha256:"+strings.Repeat("a", 64), packageNow())
			if err != nil {
				t.Fatal(err)
			}
			before, err := skillartifact.Scan(filepath.Join(copy.Directory, "skills", "deploy-work-service"), "deploy-work-service")
			if err != nil {
				t.Fatal(err)
			}
			if _, err := a.Store.UpdateDefaultWork(ctx, func(_ *sql.Tx, current corestore.DefaultWorkConfiguration) (contracts.WorkConfig, error) {
				value := *current.Configuration
				value.Skills = contracts.SkillSelection{}
				return value, nil
			}); err != nil {
				t.Fatal(err)
			}
			var changed string
			switch action {
			case "update":
				source := filepath.Join(t.TempDir(), "deploy-work-service")
				if err := os.Mkdir(source, 0700); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(filepath.Join(source, "SKILL.md"), []byte("---\nname: deploy-work-service\ndescription: Updated operator policy\n---\nOperator owned instructions.\n"), 0600); err != nil {
					t.Fatal(err)
				}
				_, err := a.importSkill(ctx, identity.OperatorPrincipal(), source, "deploy-work-service", true)
				if err != nil {
					t.Fatal("bundled Skill update prohibited", err)
				}
				if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
					return tx.QueryRow(`SELECT resolved_digest FROM catalog_entries WHERE id='deploy-work-service'`).Scan(&changed)
				}); err != nil {
					t.Fatal(err)
				}
			case "disable":
				if _, err := a.setSkillEnabled(ctx, identity.OperatorPrincipal(), "deploy-work-service", false); err != nil {
					t.Fatal(err)
				}
			case "remove":
				if err := a.removeSkill(ctx, identity.OperatorPrincipal(), "deploy-work-service"); err != nil {
					t.Fatal("bundled Skill removal prohibited", err)
				}
			}
			if err := a.Close(ctx); err != nil {
				t.Fatal(err)
			}
			next, _, _ := appFixture(t, Options{DataDirectory: directory})
			defaults, err := next.Store.DefaultWork(ctx)
			if err != nil || len(defaults.Configuration.Skills) != 0 {
				t.Fatal("restart repopulated defaults", defaults, err)
			}
			if err := next.Store.Read(ctx, func(tx *sql.Tx) error {
				var count int
				if err := tx.QueryRow(`SELECT count(*) FROM catalog_entries WHERE id='deploy-work-service'`).Scan(&count); err != nil {
					return err
				}
				if action == "remove" {
					if count != 0 {
						t.Fatal("removed Skill resurrected")
					}
					return nil
				}
				var digest string
				var enabled bool
				if err := tx.QueryRow(`SELECT resolved_digest,enabled FROM catalog_entries WHERE id='deploy-work-service'`).Scan(&digest, &enabled); err != nil {
					return err
				}
				if action == "disable" && enabled || action == "update" && digest != changed {
					t.Fatal("operator choice overwritten", digest, enabled)
				}
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			after, err := skillartifact.Scan(filepath.Join(copy.Directory, "skills", "deploy-work-service"), "deploy-work-service")
			if err != nil || before.Identity != after.Identity {
				t.Fatal("existing Work copy changed", err)
			}
		})
	}
}

func TestDeploymentSkillRecoversFailedFirstSeedTransaction(t *testing.T) {
	ctx := context.Background()
	directory := t.TempDir()
	initial, _, _ := appFixture(t, Options{DataDirectory: directory})
	store := initial.Store
	if err := store.Write(ctx, func(tx *sql.Tx) error {
		if _, err := tx.Exec(`DELETE FROM catalog_entries WHERE id='deploy-work-service'`); err != nil {
			return err
		}
		if _, err := tx.Exec(`DELETE FROM control_metadata WHERE key='deployment_skill_seeded'`); err != nil {
			return err
		}
		_, err := tx.Exec(`CREATE TRIGGER fail_first_seed BEFORE INSERT ON control_metadata WHEN NEW.key='deployment_skill_seeded' BEGIN SELECT RAISE(ABORT,'fixture seed failure'); END`)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if err := initial.ensureBundledSkill(ctx); err == nil {
		t.Fatal("failed seed was reported as complete")
	}
	if err := store.Write(ctx, func(tx *sql.Tx) error {
		var count int
		if err := tx.QueryRow(`SELECT count(*) FROM catalog_entries WHERE id='deploy-work-service'`).Scan(&count); err != nil {
			return err
		}
		if count != 0 {
			t.Fatal("partial catalog published before seed marker")
		}
		_, err := tx.Exec("DROP TRIGGER fail_first_seed")
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if err := initial.Close(ctx); err != nil {
		t.Fatal(err)
	}
	app, _, _ := appFixture(t, Options{DataDirectory: directory})
	if err := app.ensureBundledSkill(ctx); err != nil {
		t.Fatal(err)
	}
	if err := app.Store.Read(ctx, func(tx *sql.Tx) error {
		var entries, artifacts, markers int
		if err := tx.QueryRow(`SELECT (SELECT count(*) FROM catalog_entries WHERE id='deploy-work-service'),(SELECT count(*) FROM managed_skill_artifacts WHERE skill_name='deploy-work-service'),(SELECT count(*) FROM control_metadata WHERE key='deployment_skill_seeded')`).Scan(&entries, &artifacts, &markers); err != nil {
			return err
		}
		if entries != 1 || artifacts != 1 || markers != 1 {
			t.Fatal("seed duplicated or remained incomplete", entries, artifacts, markers)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}
