//go:build integration && linux

package coreapp

import (
	"bytes"
	"context"
	"database/sql"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"golang.org/x/sys/unix"
	"piwork/internal/corestore"
	"piwork/internal/dockerengine"
)

func TestNativeSELinuxSnapshotRejectsUserAttributesAndRetries(t *testing.T) {
	if os.Getenv("PIWORK_TEST_SELINUX") != "1" {
		t.Skip("requires opt-in SELinux Enforcing host with local Docker volume access")
	}
	enforcing, err := os.ReadFile("/sys/fs/selinux/enforce")
	if err != nil || strings.TrimSpace(string(enforcing)) != "1" {
		t.Fatal("SELinux Enforcing required", err)
	}
	a, base, auth, work, _ := nativeApplyFixture(t)
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Minute)
	defer cancel()
	payload := []byte("retain these bytes after an unsupported attribute failure\x00\xff")
	req, err := http.NewRequestWithContext(ctx, "PUT", base+"/api/v1/works/"+work+"/files/unsupported-attribute.bin", bytes.NewReader(payload))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", auth)
	response, err := (&http.Client{Timeout: time.Minute}).Do(req)
	if err != nil {
		t.Fatal(err)
	}
	data, _ := io.ReadAll(response.Body)
	response.Body.Close()
	if response.StatusCode != 201 {
		t.Fatal(response.StatusCode, string(data))
	}
	status, stopped := packageHTTPCall(t, base, "/api/v1/works/"+work+"/stop", "POST", auth, map[string]string{"idempotencyKey": "selinux-attribute-stop"})
	if status != 202 {
		t.Fatal(status, stopped)
	}
	waitWorkOperation(t, ctx, a, stopped["operationId"].(string))
	volumes, err := a.dockerRuntime.ListVolumes(ctx)
	if err != nil {
		t.Fatal(err)
	}
	path := ""
	for _, volume := range volumes {
		if volume.Labels[dockerengine.WorkLabel] == work && volume.Labels[dockerengine.LogicalLabel] == "work-workspace" {
			path = filepath.Join(volume.Mountpoint, "unsupported-attribute.bin")
		}
	}
	if path == "" {
		t.Fatal("no owned workspace volume")
	}
	readAttribute := func(name string) []byte {
		t.Helper()
		value := make([]byte, 4096)
		n, err := unix.Lgetxattr(path, name, value)
		if err != nil {
			t.Fatal("required real attribute", name, err)
		}
		return value[:n]
	}
	metadata := func() [4]int64 {
		t.Helper()
		var stat unix.Stat_t
		if err := unix.Lstat(path, &stat); err != nil {
			t.Fatal(err)
		}
		return [4]int64{int64(stat.Uid), int64(stat.Gid), int64(stat.Mode), stat.Mtim.Sec*1e9 + stat.Mtim.Nsec}
	}
	label := readAttribute("security.selinux")
	if !bytes.Contains(label, []byte("container_file_t:s0")) {
		t.Fatal("expected normal managed volume policy label", string(label))
	}
	if err := unix.Lsetxattr(path, "user.snapshot-test", []byte("keep"), 0); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = unix.Lremovexattr(path, "user.snapshot-test") })
	before := metadata()
	status, rejected := packageHTTPCall(t, base, "/api/v1/works/"+work+"/exports", "POST", auth, map[string]string{"idempotencyKey": "selinux-attribute-export"})
	if status != 202 {
		t.Fatal(status, rejected)
	}
	operation := waitApplyFailure(t, ctx, a, rejected["operationId"].(string))
	if operation.ErrorJSON == nil || !strings.Contains(*operation.ErrorJSON, "SNAPSHOT_STORAGE_UNSUPPORTED") {
		t.Fatal("unsupported attribute did not fail honestly", operation.ErrorJSON)
	}
	var job corestore.SnapshotJob
	var holds, artifacts, packages int
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		var err error
		job, err = corestore.ReadSnapshotJob(tx, operation.ID)
		if err != nil {
			return err
		}
		if err := tx.QueryRow(`SELECT count(*) FROM work_snapshot_locks WHERE operation_id=?`, operation.ID).Scan(&holds); err != nil {
			return err
		}
		if err := tx.QueryRow(`SELECT count(*) FROM snapshot_artifacts WHERE operation_id=? AND state!='cleaned'`, operation.ID).Scan(&artifacts); err != nil {
			return err
		}
		return tx.QueryRow(`SELECT count(*) FROM snapshot_packages WHERE state IN ('staging','ready')`).Scan(&packages)
	}); err != nil || job.Phase != "cleaned" || job.CleanupError != nil || holds != 0 || artifacts != 0 || packages != 0 {
		t.Fatal("failed export did not release its journal and gate", job, holds, artifacts, packages, err)
	}
	packageRoot, err := a.Store.OpenSnapshotArea("packages")
	if err != nil {
		t.Fatal(err)
	}
	entries, err := packageRoot.Entries()
	packageRoot.Close()
	if err != nil || len(entries) != 0 {
		t.Fatal("failed export left a package file", entries, err)
	}
	data, err = os.ReadFile(path)
	if err != nil || !bytes.Equal(data, payload) || metadata() != before || !bytes.Equal(readAttribute("user.snapshot-test"), []byte("keep")) || !bytes.Equal(readAttribute("security.selinux"), label) {
		t.Fatal("failed export changed original bytes, attributes or metadata", err)
	}
	current, err := a.Store.Work(ctx, work, false)
	if err != nil || current.DesiredState != "stopped" || current.ObservedState != "stopped" {
		t.Fatal("failed export changed source lifecycle", current, err)
	}
	// Only the fixture removes its own unsupported attribute; product code must
	// have left it intact. A new key must succeed after the original gate settles.
	if err := unix.Lremovexattr(path, "user.snapshot-test"); err != nil {
		t.Fatal(err)
	}
	status, retried := packageHTTPCall(t, base, "/api/v1/works/"+work+"/exports", "POST", auth, map[string]string{"idempotencyKey": "selinux-attribute-export-retry"})
	if status != 202 {
		t.Fatal(status, retried)
	}
	waitWorkOperation(t, ctx, a, retried["operationId"].(string))
	t.Log("real attribute rejected and journal cleaned; new-key retry succeeded:", operation.ID, retried["operationId"], a.Store.InstallationID())
}
