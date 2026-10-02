//go:build integration

package coreapp

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"piwork/internal/identity"
)

func TestNativeSnapshotUploadCancellationRevocationAndCapacity(t *testing.T) {
	a, base, auth, _, ctx := nativeApplyFixture(t)
	payload, err := os.ReadFile("../workpackage/testdata/golden-native-pi-package.work")
	if err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256(payload)
	digest := hex.EncodeToString(hash[:])
	count := func() int {
		t.Helper()
		var n int
		if err := a.Store.Read(ctx, func(tx *sql.Tx) error { return tx.QueryRow(`SELECT count(*) FROM snapshot_transfers`).Scan(&n) }); err != nil {
			t.Fatal(err)
		}
		return n
	}
	waitCount := func(want int) {
		t.Helper()
		deadline := time.Now().Add(10 * time.Second)
		for count() != want {
			if time.Now().After(deadline) {
				t.Fatal("transfer count", count(), want)
			}
			time.Sleep(20 * time.Millisecond)
		}
	}
	type upload struct {
		cancel context.CancelFunc
		writer *io.PipeWriter
		done   chan error
	}
	begin := func() upload {
		t.Helper()
		requestCtx, cancel := context.WithCancel(ctx)
		reader, writer := io.Pipe()
		done := make(chan error, 1)
		req, err := http.NewRequestWithContext(requestCtx, "POST", base+"/api/v1/work-packages", reader)
		if err != nil {
			t.Fatal(err)
		}
		req.ContentLength = 32 << 20
		req.Header.Set("Authorization", auth)
		req.Header.Set("Content-Type", snapshotMIME)
		req.Header.Set("X-Piwork-SHA256", digest)
		go func() {
			response, err := http.DefaultClient.Do(req)
			if response != nil {
				_, _ = io.Copy(io.Discard, response.Body)
				response.Body.Close()
			}
			done <- err
		}()
		if _, err := writer.Write(bytes.Repeat([]byte{1}, 65536)); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { cancel(); writer.Close() })
		return upload{cancel, writer, done}
	}
	first := begin()
	waitCount(1)
	second := begin()
	waitCount(2)
	req, err := http.NewRequestWithContext(ctx, "POST", base+"/api/v1/work-packages", bytes.NewReader(payload))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", auth)
	req.Header.Set("Content-Type", snapshotMIME)
	req.Header.Set("X-Piwork-SHA256", digest)
	response, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := io.ReadAll(response.Body)
	response.Body.Close()
	if response.StatusCode != 503 || !strings.Contains(string(raw), "SNAPSHOT_TRANSFER_BUSY") {
		t.Fatal(response.StatusCode, string(raw))
	}
	for _, upload := range []upload{first, second} {
		upload.cancel()
		upload.writer.Close()
		select {
		case <-upload.done:
		case <-time.After(5 * time.Second):
			t.Fatal("cancelled upload remained blocked")
		}
	}
	waitCount(0)
	// Preserve administrator availability while disabling this stream's owner.
	if _, err := a.Identity.CreateUser(ctx, identity.OperatorPrincipal(), "spare-admin", "development-fixture-pass", "admin"); err != nil {
		t.Fatal(err)
	}
	session, err := a.Identity.Authenticate(ctx, strings.TrimPrefix(auth, "Bearer "))
	if err != nil {
		t.Fatal(err)
	}
	revoked := begin()
	waitCount(1)
	if err := a.Identity.SetEnabled(ctx, identity.OperatorPrincipal(), session.User.ID, false); err != nil {
		t.Fatal(err)
	}
	waitCount(0)
	revoked.cancel()
	revoked.writer.Close()
	select {
	case <-revoked.done:
	case <-time.After(5 * time.Second):
		t.Fatal("revoked upload remained blocked")
	}
	helpers, err := a.dockerRuntime.ListContainers(ctx, "snapshot-helper")
	if err != nil || len(helpers) != 0 {
		t.Fatal("aborted upload left helper", len(helpers), err)
	}
	for _, area := range []string{"transfers", "packages"} {
		root, err := a.Store.OpenSnapshotArea(area)
		if err != nil {
			t.Fatal(err)
		}
		names, err := root.Entries()
		root.Close()
		if err != nil || len(names) != 0 {
			t.Fatal("aborted bytes retained", area, names, err)
		}
	}
}
