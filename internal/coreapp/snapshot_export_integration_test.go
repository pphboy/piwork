//go:build integration

package coreapp

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"piwork/internal/corestore"
	"piwork/internal/dockerengine"
	"strings"
	"testing"
	"time"

	"piwork/internal/identity"
	"piwork/internal/workpackage"
)

func TestNativeCoreExportsCompleteStoppedWorkAndDownloadsSameSnapshot(t *testing.T) {
	failRestore, restoreBlocked, releaseRestore := snapshotRestoreStartFault(t)
	a, base, auth, work, _ := nativeApplyFixture(t)
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Minute)
	defer cancel()
	if os.Getenv("PIWORK_TEST_NATIVE_SNAPSHOT_HELPER_IMAGE") == "" || os.Getenv("PIWORK_TEST_NATIVE_FILE_HELPER_IMAGE") == "" {
		t.Fatal("native helpers required")
	}
	client := &http.Client{Timeout: 3 * time.Minute}
	request := func(method, path string, body io.Reader, headers map[string]string) *http.Response {
		t.Helper()
		req, err := http.NewRequestWithContext(ctx, method, base+path, body)
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Authorization", auth)
		for key, value := range headers {
			req.Header.Set(key, value)
		}
		response, err := client.Do(req)
		if err != nil {
			t.Fatal(method, path, err)
		}
		return response
	}
	export := func(key string) (int, map[string]any) {
		return packageHTTPCall(t, base, "/api/v1/works/"+work+"/exports", "POST", auth, map[string]string{"idempotencyKey": key})
	}
	status, rejected := export("running-export")
	if status != 409 || rejected["code"] != "SNAPSHOT_REQUIRES_STOPPED" {
		t.Fatal(status, rejected)
	}
	// A database-only stopped observation cannot hide actual writers.
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec(`UPDATE works SET desired_state='stopped',observed_state='stopped' WHERE id=?`, work)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	status, rejected = export("false-stopped-export")
	if status != 409 || rejected["code"] != "SNAPSHOT_REQUIRES_STOPPED" {
		t.Fatal(status, rejected)
	}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec(`UPDATE works SET desired_state='running',observed_state='ready' WHERE id=?`, work)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	payload := bytes.Repeat([]byte{0, 255, 7, 13, 10}, 100003)
	response := request("PUT", "/api/v1/works/"+work+"/files/retained.bin", bytes.NewReader(payload), nil)
	data, _ := io.ReadAll(response.Body)
	response.Body.Close()
	if response.StatusCode != 201 {
		t.Fatal(response.StatusCode, string(data))
	}
	status, stopped := packageHTTPCall(t, base, "/api/v1/works/"+work+"/stop", "POST", auth, map[string]string{"idempotencyKey": "snapshot-stop"})
	if status != 202 {
		t.Fatal(status, stopped)
	}
	waitWorkOperation(t, ctx, a, stopped["operationId"].(string))
	status, accepted := export("native-full-export")
	if status != 202 {
		t.Fatal(status, accepted)
	}
	operation := accepted["operationId"].(string)
	snapshot := accepted["snapshotId"].(string)
	status, blocked := packageHTTPCall(t, base, "/api/v1/works/"+work+"/start", "POST", auth, map[string]string{"idempotencyKey": "start-during-export"})
	if status != 409 {
		t.Fatal("snapshot lock admitted Start", status, blocked)
	}
	for {
		op, err := a.Store.Operation(ctx, operation)
		if err != nil {
			t.Fatal(err)
		}
		if op.State == "succeeded" {
			break
		}
		if op.State == "failed" {
			if op.ErrorJSON != nil {
				t.Log(*op.ErrorJSON)
			}
			t.Fatal("native export failed")
		}
		select {
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		case <-time.After(50 * time.Millisecond):
		}
	}
	status, replayed := export("native-full-export")
	if status != 202 || replayed["snapshotId"] != snapshot || replayed["reused"] != true {
		t.Fatal(status, replayed)
	}
	path := "/api/v1/work-snapshots/" + snapshot
	status, view := packageHTTPCall(t, base, path, "GET", auth, nil)
	if status != 200 || view["state"] != "succeeded" {
		t.Fatal(status, view)
	}
	for _, rangeValue := range []string{"bytes=0-7", "bytes=0-1,4-5", "invalid", ""} {
		response := request("GET", path+"/content", nil, map[string]string{"Range": rangeValue})
		body, _ := io.ReadAll(response.Body)
		response.Body.Close()
		if response.StatusCode != 416 {
			t.Fatal(rangeValue, response.StatusCode, string(body))
		}
	}
	var firstDigest string
	var firstSize int64
	// An interrupted download releases its lease; retries keep this snapshot.
	aborted := request("GET", path+"/content", nil, nil)
	if aborted.StatusCode != 200 {
		t.Fatal(aborted.StatusCode)
	}
	if _, err := io.ReadFull(aborted.Body, make([]byte, 8)); err != nil {
		t.Fatal(err)
	}
	aborted.Body.Close()
	waitTransferClear := func() {
		t.Helper()
		deadline := time.Now().Add(10 * time.Second)
		for {
			var count int
			if err := a.Store.Read(ctx, func(tx *sql.Tx) error { return tx.QueryRow(`SELECT count(*) FROM snapshot_transfers`).Scan(&count) }); err != nil {
				t.Fatal(err)
			}
			if count == 0 {
				return
			}
			if time.Now().After(deadline) {
				t.Fatal("download lease retained", count)
			}
			time.Sleep(20 * time.Millisecond)
		}
	}
	waitTransferClear()
	downloadPath := filepath.Join(t.TempDir(), "snapshot.work")
	for round := 0; round < 2; round++ {
		response := request("GET", path+"/content", nil, nil)
		if response.StatusCode != 200 {
			body, _ := io.ReadAll(response.Body)
			response.Body.Close()
			t.Fatal(response.StatusCode, string(body))
		}
		file, err := os.Create(downloadPath)
		if err != nil {
			t.Fatal(err)
		}
		hash := sha256.New()
		size, err := io.CopyBuffer(io.MultiWriter(file, hash), response.Body, make([]byte, 1<<20))
		response.Body.Close()
		if err != nil {
			file.Close()
			t.Fatal(err)
		}
		digest := hex.EncodeToString(hash.Sum(nil))
		if digest != response.Header.Get("X-Piwork-SHA256") || digest != view["digest"] || float64(size) != view["size"] {
			file.Close()
			t.Fatal(digest, size, view)
		}
		if round == 0 {
			firstDigest, firstSize = digest, size
			verified, err := workpackage.Read(ctx, io.NewSectionReader(file, 0, size), workpackage.ReadOptions{})
			if err != nil {
				file.Close()
				t.Fatal("native package", err)
			}
			inspection, err := workpackage.Inspect(ctx, file, size)
			if err != nil || !inspection.IntegrityVerified || inspection.InstallationValidated {
				file.Close()
				t.Fatal(inspection, err)
			}
			var tree string
			for _, volume := range workpackage.Volumes(verified.Spec) {
				if volume.Role == "workspace" {
					tree = string(volume.Tree)
				}
			}
			var workspace workpackage.Tree
			if err := json.Unmarshal(verified.Metadata[tree], &workspace); err != nil {
				file.Close()
				t.Fatal(err)
			}
			found := false
			for _, entry := range workspace.Entries {
				path, err := workpackage.DecodePath(entry.SegmentsBase64, workpackage.DefaultLimits)
				if err != nil {
					t.Fatal(err)
				}
				if string(path) == "retained.bin" {
					found = true
					for _, blob := range verified.Spec.Blobs {
						if blob.Digest == entry.Blob {
							source, err := verified.Open(file)(blob)
							if err != nil {
								t.Fatal(err)
							}
							data, err := io.ReadAll(source)
							source.Close()
							if err != nil || !bytes.Equal(data, payload) {
								t.Fatal("workspace bytes changed", err)
							}
						}
					}
				}
			}
			if !found {
				t.Fatal("workspace file omitted")
			}
		} else if digest != firstDigest || size != firstSize {
			file.Close()
			t.Fatal("same snapshot changed")
		}
		file.Close()
	}
	t.Log("Native export digest/size:", firstDigest, firstSize)
	if _, err := a.Identity.CreateUser(ctx, identity.OperatorPrincipal(), "snapshot-spare-admin", "development-fixture-pass", "admin"); err != nil {
		t.Fatal(err)
	}
	session, err := a.Identity.Authenticate(ctx, strings.TrimPrefix(auth, "Bearer "))
	if err != nil {
		t.Fatal(err)
	}
	revokedDownload := request("GET", path+"/content", nil, nil)
	if revokedDownload.StatusCode != 200 {
		t.Fatal(revokedDownload.StatusCode)
	}
	if err := a.Identity.SetEnabled(ctx, identity.OperatorPrincipal(), session.User.ID, false); err != nil {
		t.Fatal(err)
	}
	waitTransferClear()
	_, readErr := io.Copy(io.Discard, revokedDownload.Body)
	revokedDownload.Body.Close()
	if readErr == nil {
		t.Fatal("disabled owner completed full download")
	}
	if err := a.Identity.SetEnabled(ctx, identity.OperatorPrincipal(), session.User.ID, true); err != nil {
		t.Fatal(err)
	}
	relogin, err := a.Identity.Login(ctx, "admin", "development-fixture-pass", "snapshot-download-relogin")
	if err != nil {
		t.Fatal(err)
	}
	auth = "Bearer " + relogin.Token
	// Restore through the public Core coordinator, preserving source bytes.
	var sourcePackage string
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		return tx.QueryRow(`SELECT package_id FROM snapshot_jobs WHERE snapshot_id=?`, snapshot).Scan(&sourcePackage)
	}); err != nil {
		t.Fatal(err)
	}
	profile, _, err := a.Settings.LoadRuntime()
	if err != nil {
		t.Fatal(err)
	}
	modelID := string(runtimeModelCatalogID(profile.Revision))
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec(`UPDATE catalog_entries SET enabled=0 WHERE id=?`, modelID)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	status, noModel := packageHTTPCall(t, base, "/api/v1/work-imports", "POST", auth, map[string]string{"packageId": sourcePackage, "idempotencyKey": "import-missing-model"})
	if status != 400 || noModel["code"] != "TARGET_MODEL_UNAVAILABLE" {
		t.Fatal("target credential rejection", status, noModel)
	}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec(`UPDATE catalog_entries SET enabled=1 WHERE id=?`, modelID)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	status, nameConflict := packageHTTPCall(t, base, "/api/v1/work-imports", "POST", auth, map[string]string{"packageId": sourcePackage, "name": "Apply Work", "idempotencyKey": "import-explicit-conflict"})
	if status != 409 || nameConflict["code"] != "WORK_NAME_CONFLICT" {
		t.Fatal("name conflict", status, nameConflict)
	}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec(`INSERT INTO quota_reservations(work_id,subject_kind,subject_id,desired_cpu_millis,desired_memory_bytes,occupied_cpu_millis,occupied_memory_bytes,service_slots,volume_slots,updated_at) VALUES('work-test-host-quota','agent','agentd',128000,0,0,0,0,0,?)`, packageNow())
		return err
	}); err != nil {
		t.Fatal(err)
	}
	status, noCapacity := packageHTTPCall(t, base, "/api/v1/work-imports", "POST", auth, map[string]string{"packageId": sourcePackage, "idempotencyKey": "import-no-capacity"})
	if status != 409 || noCapacity["code"] != "QUOTA_EXCEEDED" {
		t.Fatal("capacity rejection", status, noCapacity)
	}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec(`DELETE FROM quota_reservations WHERE work_id='work-test-host-quota'`)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	failRestore(a.Store.InstallationID())
	status, failedRestore := packageHTTPCall(t, base, "/api/v1/work-imports", "POST", auth, map[string]string{"packageId": sourcePackage, "idempotencyKey": "import-restore-start-failure"})
	if status != 202 {
		t.Fatal(status, failedRestore)
	}
	failedTarget := failedRestore["workId"].(string)
	failedOperation := failedRestore["operationId"].(string)
	select {
	case <-restoreBlocked:
	case <-ctx.Done():
		t.Fatal("restore helper did not reach fault", ctx.Err())
	}
	status, competingCreate := packageHTTPCall(t, base, "/api/v1/works", "POST", auth, map[string]string{"name": failedRestore["name"].(string), "idempotencyKey": "create-during-import-name-hold"})
	if status != 409 {
		t.Fatal("ordinary creation ignored import name reservation", status, competingCreate)
	}
	releaseRestore()
	waitApplyFailure(t, ctx, a, failedOperation)
	var failedJob corestore.SnapshotJob
	var exposed, nameHeld, quotaHeld bool
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		var err error
		failedJob, err = corestore.ReadSnapshotJob(tx, failedOperation)
		if err != nil {
			return err
		}
		return tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM works WHERE id=?),EXISTS(SELECT 1 FROM work_import_names WHERE operation_id=?),EXISTS(SELECT 1 FROM quota_reservations WHERE work_id=?)`, failedTarget, failedOperation, failedTarget).Scan(&exposed, &nameHeld, &quotaHeld)
	}); err != nil || failedJob.Phase != "cleaned" || exposed || nameHeld || quotaHeld {
		t.Fatal("failed restore leaked visibility or holds", failedJob, exposed, nameHeld, quotaHeld, err)
	}
	volumes, err := a.dockerRuntime.ListVolumes(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, v := range volumes {
		if v.Labels[dockerengine.WorkLabel] == failedTarget {
			t.Fatal("failed restore retained target volume", v.Name)
		}
	}
	status, imported := packageHTTPCall(t, base, "/api/v1/work-imports", "POST", auth, map[string]string{"packageId": sourcePackage, "idempotencyKey": "import-exported-work"})
	if status != 202 {
		t.Fatal("import admission", status, imported)
	}
	target := imported["workId"].(string)
	if target == work {
		t.Fatal("source identity reused")
	}
	importOperation := imported["operationId"].(string)
	waitWorkOperation(t, ctx, a, importOperation)
	importedWork, err := a.Store.Work(ctx, target, false)
	if err != nil || importedWork.DesiredState != "stopped" || importedWork.ObservedState != "stopped" {
		t.Fatal("import not atomically stopped", importedWork, err)
	}
	status, replayedImport := packageHTTPCall(t, base, "/api/v1/work-imports", "POST", auth, map[string]string{"packageId": sourcePackage, "idempotencyKey": "import-exported-work"})
	if status != 202 || replayedImport["workId"] != target || replayedImport["operationId"] != importOperation || replayedImport["reused"] != true {
		t.Fatal(status, replayedImport)
	}
	status, targetStarted := packageHTTPCall(t, base, "/api/v1/works/"+target+"/start", "POST", auth, map[string]string{"idempotencyKey": "start-imported-work"})
	if status != 202 {
		t.Fatal(status, targetStarted)
	}
	waitWorkOperation(t, ctx, a, targetStarted["operationId"].(string))
	restoredResponse := request("GET", "/api/v1/works/"+target+"/files/retained.bin", nil, nil)
	restoredBytes, err := io.ReadAll(restoredResponse.Body)
	restoredResponse.Body.Close()
	if err != nil || restoredResponse.StatusCode != 200 || !bytes.Equal(restoredBytes, payload) {
		t.Fatal("imported workspace differs", restoredResponse.StatusCode, err, len(restoredBytes))
	}
	status, targetStopped := packageHTTPCall(t, base, "/api/v1/works/"+target+"/stop", "POST", auth, map[string]string{"idempotencyKey": "stop-imported-work"})
	if status != 202 {
		t.Fatal(status, targetStopped)
	}
	waitWorkOperation(t, ctx, a, targetStopped["operationId"].(string))
	t.Log("Core import completed with new stopped identity and restored bytes:", target)
	current, err := a.Store.Work(ctx, work, false)
	if err != nil || current.ActiveContextID == nil {
		t.Fatal(err)
	}
	skills := filepath.Join(a.options.DataDirectory, "works", work, "contexts", *current.ActiveContextID, "skills")
	if err := os.Rename(skills, skills+".unavailable"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Rename(skills+".unavailable", skills) })
	status, failed := export("unreadable-context-export")
	if status != 202 {
		t.Fatal(status, failed)
	}
	for {
		op, err := a.Store.Operation(ctx, failed["operationId"].(string))
		if err != nil {
			t.Fatal(err)
		}
		if op.State == "failed" {
			break
		}
		if op.State == "succeeded" {
			t.Fatal("missing context silently exported")
		}
		select {
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		case <-time.After(50 * time.Millisecond):
		}
	}
	var job corestore.SnapshotJob
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		var err error
		job, err = corestore.ReadSnapshotJob(tx, failed["operationId"].(string))
		return err
	}); err != nil || job.Phase != "cleaned" {
		t.Fatal("failed capture did not settle", job, err)
	}
	packages, err := a.Store.OpenSnapshotArea("packages")
	if err != nil {
		t.Fatal(err)
	}
	names, err := packages.Entries()
	packages.Close()
	if err != nil || len(names) != 1 {
		t.Fatal("failed capture left a package", names, err)
	}
	if err := os.Rename(skills+".unavailable", skills); err != nil {
		t.Fatal(err)
	}
	status, started := packageHTTPCall(t, base, "/api/v1/works/"+work+"/start", "POST", auth, map[string]string{"idempotencyKey": "start-after-failed-export"})
	if status != 202 {
		t.Fatal(status, started)
	}
	waitWorkOperation(t, ctx, a, started["operationId"].(string))
}
