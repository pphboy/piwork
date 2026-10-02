//go:build integration

package coreapp

import (
	"bytes"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"piwork/internal/corestore"
)

func TestNativeCoreUploadsIndependentlyVerifiesAndDeduplicatesPackage(t *testing.T) {
	a, base, auth, _, ctx := nativeApplyFixture(t)
	if os.Getenv("PIWORK_TEST_NATIVE_SNAPSHOT_HELPER_IMAGE") == "" {
		t.Fatal("native helper required")
	}
	fixture, err := os.ReadFile("../workpackage/testdata/golden-native-pi-package.work")
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(fixture)
	digest := hex.EncodeToString(sum[:])
	call := func(body []byte, hash, media string) (int, map[string]any) {
		t.Helper()
		req, err := http.NewRequestWithContext(ctx, "POST", base+"/api/v1/work-packages", bytes.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Authorization", auth)
		req.Header.Set("Content-Type", media)
		req.Header.Set("X-Piwork-SHA256", hash)
		response, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		raw, err := io.ReadAll(response.Body)
		response.Body.Close()
		if err != nil {
			t.Fatal(err)
		}
		var data map[string]any
		if err := json.Unmarshal(raw, &data); err != nil {
			t.Fatal(response.StatusCode, string(raw))
		}
		return response.StatusCode, data
	}
	status, data := call(fixture, digest, "application/octet-stream")
	if status != 415 {
		t.Fatal(status, data)
	}
	status, data = call(fixture, strings.Repeat("0", 64), snapshotMIME)
	if status != 400 || data["code"] != "PACKAGE_INVALID" {
		t.Fatal(status, data)
	}
	damaged := append([]byte(nil), fixture...)
	damaged[len(damaged)-1] ^= 1
	damagedHash := sha256.Sum256(damaged)
	status, data = call(damaged, hex.EncodeToString(damagedHash[:]), snapshotMIME)
	if status != 400 || data["code"] != "PACKAGE_INVALID" {
		t.Fatal(status, data)
	}
	tsOnly, err := os.ReadFile("../workpackage/testdata/golden-pi-package.work")
	if err != nil {
		t.Fatal(err)
	}
	tsHash := sha256.Sum256(tsOnly)
	status, data = call(tsOnly, hex.EncodeToString(tsHash[:]), snapshotMIME)
	if status != 400 || data["code"] != "PACKAGE_INCOMPATIBLE" {
		t.Fatal(status, data)
	}
	status, first := call(fixture, digest, snapshotMIME)
	if status != 201 || first["digest"] != digest || first["size"] != float64(len(fixture)) {
		t.Fatal(status, first)
	}
	status, second := call(fixture, digest, snapshotMIME)
	if status != 201 || second["packageId"] != first["packageId"] {
		t.Fatal(status, second)
	}
	var transfers []corestore.SnapshotTransfer
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error { var err error; transfers, err = corestore.SnapshotTransfers(tx); return err }); err != nil || len(transfers) != 0 {
		t.Fatal(transfers, err)
	}
	helpers, err := a.dockerRuntime.ListContainers(ctx, "snapshot-helper")
	if err != nil || len(helpers) != 0 {
		t.Fatal(len(helpers), err)
	}
	area, err := a.Store.OpenSnapshotArea("transfers")
	if err != nil {
		t.Fatal(err)
	}
	names, err := area.Entries()
	area.Close()
	if err != nil || len(names) != 0 {
		t.Fatal(names, err)
	}
	if err := a.collectSnapshotGarbage(ctx, time.Now().Add(25*time.Hour)); err != nil {
		t.Fatal(err)
	}
	packages, err := a.Store.OpenSnapshotArea("packages")
	if err != nil {
		t.Fatal(err)
	}
	names, err = packages.Entries()
	packages.Close()
	if err != nil || len(names) != 0 {
		t.Fatal("expired bytes retained", names, err)
	}
	var record corestore.SnapshotPackage
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		var err error
		record, err = corestore.ReadSnapshotPackage(tx, first["packageId"].(string))
		return err
	}); err != nil || record.State != "expired" || record.Digest == nil || *record.Digest != digest {
		t.Fatal(record, err)
	}
}
