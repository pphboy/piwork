//go:build integration

package coreapp

import (
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"piwork/internal/dockerengine"
)

func TestNativeSnapshotExportPreflightRejectsResidualHelperAndMissingImage(t *testing.T) {
	a, base, auth, work, ctx := nativeApplyFixture(t)
	status, stopped := packageHTTPCall(t, base, "/api/v1/works/"+work+"/stop", "POST", auth, map[string]string{"idempotencyKey": "stop-for-preflight"})
	if status != 202 {
		t.Fatal(status, stopped)
	}
	waitWorkOperation(t, ctx, a, stopped["operationId"].(string))
	image, err := a.requireFileImage()
	if err != nil {
		t.Fatal(err)
	}
	spec := dockerengine.FileHelperSpec{WorkID: work, JobID: "filejob-preflight-residual", AttemptID: "attempt-preflight-residual", ImageID: image, VolumeName: dockerengine.ManagedVolumeName(a.Store.InstallationID(), work, "work-workspace"), Epoch: 1}
	if _, err := a.dockerRuntime.EnsureFileHelper(ctx, spec); err != nil {
		t.Fatal(err)
	}
	export := func(key string) (int, map[string]any) {
		return packageHTTPCall(t, base, "/api/v1/works/"+work+"/exports", "POST", auth, map[string]string{"idempotencyKey": key})
	}
	status, rejected := export("residual-helper-export")
	if status != 409 || rejected["code"] != "SNAPSHOT_REQUIRES_STOPPED" {
		t.Fatal(status, rejected)
	}
	if err := a.dockerRuntime.RemoveContainer(ctx, dockerengine.FileHelperIdentity(spec)); err != nil {
		t.Fatal(err)
	}
	if err := a.Store.ReleaseResourceIntent(ctx, work, "file-helper", spec.JobID+"."+spec.AttemptID, true); err != nil {
		t.Fatal(err)
	}
	current, err := a.Store.Work(ctx, work, false)
	if err != nil || current.ActiveContextID == nil {
		t.Fatal(err)
	}
	contextID := *current.ActiveContextID
	name := filepath.Join(a.options.DataDirectory, "works", work, "contexts", contextID, "metadata.json")
	original, err := os.ReadFile(name)
	if err != nil {
		t.Fatal(err)
	}
	var metadata map[string]any
	if json.Unmarshal(original, &metadata) != nil {
		t.Fatal("metadata")
	}
	originalImage := metadata["imageIdentity"].(string)
	restore := func() {
		_ = a.Store.Write(ctx, func(tx *sql.Tx) error {
			_, err := tx.Exec(`UPDATE work_context_snapshots SET image_identity=? WHERE snapshot_id=?`, originalImage, contextID)
			if err != nil {
				return err
			}
			_, err = tx.Exec(`UPDATE work_config_revisions SET resolved_image_digest=? WHERE work_id=?`, originalImage, work)
			return err
		})
		_ = os.Chmod(name, 0644)
		_ = os.WriteFile(name, original, 0644)
		_ = os.Chmod(name, 0444)
	}
	t.Cleanup(restore)
	missing := "sha256:" + strings.Repeat("f", 64)
	metadata["imageIdentity"] = missing
	raw, _ := json.Marshal(metadata)
	if err := os.Chmod(name, 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(name, raw, 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(name, 0444); err != nil {
		t.Fatal(err)
	}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec(`UPDATE work_context_snapshots SET image_identity=? WHERE snapshot_id=?`, missing, contextID)
		if err != nil {
			return err
		}
		_, err = tx.Exec(`UPDATE work_config_revisions SET resolved_image_digest=? WHERE work_id=?`, missing, work)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	status, rejected = export("missing-image-export")
	if status != 409 || rejected["code"] != "SNAPSHOT_IMAGE_MISSING" {
		t.Fatal(status, rejected)
	}
	var jobs int
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error { return tx.QueryRow(`SELECT count(*) FROM snapshot_jobs`).Scan(&jobs) }); err != nil || jobs != 0 {
		t.Fatal("preflight had durable side effects", jobs, err)
	}
	restore()
}
