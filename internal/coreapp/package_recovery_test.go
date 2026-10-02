package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/packagehelper"
)

func seedRecoverableCorePackage(t *testing.T, a *Application, phase, failure string, capture bool) corestore.PackageJob {
	t.Helper()
	ctx := context.Background()
	environment := contracts.PiPackagePreparedEnvironment{Os: "linux", Architecture: "amd64", Variant: json.RawMessage(`null`), NodeAbi: "137", PiSdkVersion: "0.86.1"}
	rawEnvironment, _ := json.Marshal(environment)
	now := packageNow()
	var job corestore.PackageJob
	accepted, err := a.Store.AcceptMutation(ctx, corestore.MutationRequest{PrincipalID: "operator", WorkScope: "core", Kind: "pi-package-install", IdempotencyKey: "recover-fixture", RequestJSON: `{}`, TargetVersion: 1, Now: now}, func(tx *sql.Tx, id string) (corestore.MutationEffect, error) {
		job = corestore.PackageJob{OperationID: id, ScopeKind: "core", ActorID: "operator", Kind: "install", PrepareImageID: "sha256:" + strings.Repeat("a", 64), TrustedHelperImageID: "sha256:" + strings.Repeat("a", 64), PreparedEnvironmentJSON: string(rawEnvironment), SourceJSON: `{"kind":"npm","spec":"recovery-tools"}`, RequestDigest: strings.Repeat("b", 64), Phase: "queued", WorkerEpoch: 1, DeadlineAt: time.Now().UTC().Add(time.Hour).Format(time.RFC3339Nano), CreatedAt: now, UpdatedAt: now}
		_, err := corestore.InsertPackageJob(tx, job)
		return corestore.MutationEffect{ResourceID: id}, err
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		if err := corestore.AdvancePackageJob(tx, accepted.OperationID, 1, "prepare", now, nil, nil); err != nil {
			return err
		}
		if phase == "cleanup-pending" {
			diagnostic, _ := json.Marshal(map[string]string{"code": failure, "stage": "prepare", "message": "unsafe fixture stderr /private/credential"})
			cleanup := "pending"
			return corestore.FinishPackageJob(tx, accepted.OperationID, 1, phase, now, string(diagnostic), &cleanup, false)
		}
		return corestore.AdvancePackageJob(tx, accepted.OperationID, 1, phase, now, nil, nil)
	}); err != nil {
		t.Fatal(err)
	}
	job.Phase = phase
	if capture {
		root, err := a.openCorePackageJobRoot(job.OperationID)
		if err != nil {
			t.Fatal(err)
		}
		root.Close()
		spool := filepath.Join(a.options.DataDirectory, "pi-packages", "jobs", job.OperationID, "spool")
		if err := os.Mkdir(spool, 0700); err != nil {
			t.Fatal(err)
		}
		work := t.TempDir()
		result := filepath.Join(work, "result")
		if err := os.Mkdir(result, 0700); err != nil {
			t.Fatal(err)
		}
		// Recovery must never execute this script; PATH also excludes all tools.
		manifest := `{"name":"recovery-tools","version":"1.0.0","scripts":{"postinstall":"exit 99"},"pi":{"prompts":["review.md"]}}`
		for name, content := range map[string]string{"package.json": manifest, "review.md": "Review the result.\n"} {
			if err := os.WriteFile(filepath.Join(result, name), []byte(content), 0644); err != nil {
				t.Fatal(err)
			}
		}
		request, _ := json.Marshal(map[string]any{"sourceKind": "npm", "resolvedSource": "recovery-tools@1.0.0", "preparedEnvironment": environment})
		if err := os.WriteFile(filepath.Join(spool, "request.json"), request, 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := (packagehelper.Helper{Paths: packagehelper.Paths{WorkRoot: work, SpoolRoot: spool}}).Run(ctx, "capture"); err != nil {
			t.Fatal(err)
		}
	}
	return job
}

func TestCorePackageRecoveryPublishesOnlyVerifiedCapture(t *testing.T) {
	for _, test := range []struct{ name, phase, prior, damage, state, code string }{
		{"capture before phase commit", "prepare", "", "", "succeeded", ""},
		{"capture before catalog commit", "publish", "", "", "succeeded", ""},
		{"cleanup after successful capture", "cleanup-pending", "PI_PACKAGE_CLEANUP_PENDING", "", "succeeded", ""},
		{"incomplete capture", "prepare", "", "missing", "failed", "PI_PACKAGE_INTERRUPTED"},
		{"corrupt archive", "publish", "", "archive", "failed", "PI_PACKAGE_INTERRUPTED"},
		{"forged inventory", "publish", "", "inventory", "failed", "PI_PACKAGE_INTERRUPTED"},
		{"preserve primary failure", "cleanup-pending", "PI_PACKAGE_DEPENDENCY_INSTALL_FAILED", "", "failed", "PI_PACKAGE_DEPENDENCY_INSTALL_FAILED"},
	} {
		t.Run(test.name, func(t *testing.T) {
			options := Options{DataDirectory: t.TempDir()}
			a, _, _ := appFixture(t, options)
			job := seedRecoverableCorePackage(t, a, test.phase, test.prior, test.damage != "missing")
			spool := filepath.Join(options.DataDirectory, "pi-packages", "jobs", job.OperationID, "spool")
			if test.damage == "archive" {
				if err := os.WriteFile(filepath.Join(spool, "artifact.zip"), []byte("incomplete"), 0644); err != nil {
					t.Fatal(err)
				}
			}
			if test.damage == "inventory" {
				raw, err := os.ReadFile(filepath.Join(spool, "result.json"))
				if err != nil {
					t.Fatal(err)
				}
				var captured packagehelper.Captured
				if json.Unmarshal(raw, &captured) != nil {
					t.Fatal("capture fixture")
				}
				captured.Inventory.Prompts = append(captured.Inventory.Prompts, "forged.md")
				raw, _ = json.Marshal(captured)
				if err := os.WriteFile(filepath.Join(spool, "result.json"), raw, 0644); err != nil {
					t.Fatal(err)
				}
			}
			if err := a.Close(context.Background()); err != nil {
				t.Fatal(err)
			}
			a, base, operator := appFixture(t, options)
			t.Setenv("PATH", "/no-recovery-tools")
			if err := a.recoverCorePackageJobs(context.Background()); err != nil {
				t.Fatal(err)
			}
			if err := a.recoverCorePackageJobs(context.Background()); err != nil {
				t.Fatal("second recovery", err)
			}
			operation, err := a.Store.Operation(context.Background(), job.OperationID)
			if err != nil || operation.State != test.state {
				t.Fatal(operation, err)
			}
			if test.state == "succeeded" && operation.ErrorJSON != nil {
				t.Fatal("cleanup diagnostic survived successful publication", *operation.ErrorJSON)
			}
			status, view := httpCall(t, base, "/control/operations/"+job.OperationID, "GET", "Operator "+operator, nil)
			if status != 200 || view["state"] != test.state || view["packagePhase"] != test.state {
				t.Fatal(status, view)
			}
			if test.code != "" && view["error"].(map[string]any)["code"] != test.code {
				t.Fatal(view)
			}
			serialized, _ := json.Marshal(view)
			if strings.Contains(string(serialized), "unsafe fixture") || strings.Contains(string(serialized), "/private/") {
				t.Fatal("durable raw error exposed", view)
			}
			if err := a.Store.Read(context.Background(), func(tx *sql.Tx) error {
				current, err := corestore.ReadPackageJob(tx, job.OperationID)
				if err != nil {
					return err
				}
				if current.WorkerEpoch != 2 || !current.LeasesReleased {
					t.Fatal("recovery fence or lease", current)
				}
				var entries int
				if err := tx.QueryRow(`SELECT count(*) FROM pi_package_catalog`).Scan(&entries); err != nil {
					return err
				}
				if (entries == 1) != (test.state == "succeeded") {
					t.Fatal("partial catalog publication", entries)
				}
				return nil
			}); err != nil {
				t.Fatal(err)
			}
		})
	}
}
