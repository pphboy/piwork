//go:build integration

package coreapp

import (
	"bytes"
	"database/sql"
	"io"
	"strings"
	"testing"

	"piwork/internal/contracts"
	"piwork/internal/corestore"
)

func TestNativeCoreFileJobPermissionsDurableCommitAndCleanup(t *testing.T) {
	a, _, auth, workID, ctx := nativeApplyFixture(t)
	if _, err := a.requireFileImage(); err != nil {
		t.Fatal("native file helper image required", err)
	}
	session, err := a.Identity.Authenticate(ctx, strings.TrimPrefix(auth, "Bearer "))
	if err != nil {
		t.Fatal(err)
	}
	var generation int64
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		return tx.QueryRow(`SELECT max(generation) FROM runtime_generations WHERE work_id=?`, workID).Scan(&generation)
	}); err != nil {
		t.Fatal(err)
	}
	identity := fileAccessIdentity{WorkID: workID, OwnerUserID: session.User.ID, SessionID: session.SessionID, RuntimeGeneration: generation}
	conditions := fileConditions{IfMatch: jsonValue(nil), IfNoneMatch: jsonValue(nil), IfModifiedSince: jsonValue(nil), IfUnmodifiedSince: jsonValue(nil)}
	result, err := a.executeFileJob(ctx, fileExecutionInput{Identity: identity, Action: "MKCOL", Path: []string{"中文"}, Conditions: conditions})
	if err != nil || result.Status != 201 {
		t.Fatal(result, err)
	}
	payload := bytes.Repeat([]byte{0, 255, 7, 13, 10}, 250000)
	result, err = a.executeFileJob(ctx, fileExecutionInput{Identity: identity, Action: "PUT", Path: []string{"中文", "binary"}, Conditions: conditions, ExpectedLength: int64(len(payload)), Body: io.NopCloser(bytes.NewReader(payload))})
	if err != nil || result.Status != 201 || result.Bytes != int64(len(payload)) {
		t.Fatal(result, err)
	}
	var downloaded bytes.Buffer
	result, err = a.executeFileJob(ctx, fileExecutionInput{Identity: identity, Action: "GET", Path: []string{"中文", "binary"}, Conditions: conditions, OnData: func(chunk []byte) error { _, err := downloaded.Write(chunk); return err }})
	if err != nil || result.Status != 200 || !bytes.Equal(downloaded.Bytes(), payload) {
		t.Fatal(result, downloaded.Len(), err)
	}
	conditions.IfNoneMatch = jsonValue("*")
	if _, err := a.executeFileJob(ctx, fileExecutionInput{Identity: identity, Action: "PUT", Path: []string{"中文", "binary"}, Conditions: conditions, Body: io.NopCloser(strings.NewReader("bad"))}); err == nil {
		t.Fatal("failed existence precondition accepted")
	}
	conditions.IfNoneMatch = jsonValue(nil)
	if _, err := a.executeFileJob(ctx, fileExecutionInput{Identity: identity, Action: "PUT", Path: []string{"中文", "binary"}, Conditions: conditions, ExpectedLength: 100, Body: io.NopCloser(strings.NewReader("bad"))}); err == nil {
		t.Fatal("bad upload length accepted")
	}
	// Length failure created an acknowledged temporary. The independent
	// CLEANUP attempt confirms that exact inode is absent before releasing it.
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		jobs, err := corestore.PendingFileJobs(tx, &workID)
		if err != nil {
			return err
		}
		if len(jobs) != 0 {
			t.Errorf("unreleased file journals: %+v", jobs)
		}
		var commits, cleanups int
		if err := tx.QueryRow(`SELECT count(*) FROM work_file_jobs WHERE work_id=? AND state='cleaned'`, workID).Scan(&commits); err != nil {
			return err
		}
		if err := tx.QueryRow(`SELECT count(*) FROM work_file_attempts a JOIN work_file_jobs j ON j.id=a.job_id WHERE j.work_id=? AND a.kind='cleanup' AND a.state='removed'`, workID).Scan(&cleanups); err != nil {
			return err
		}
		if commits != 5 || cleanups < 1 {
			t.Errorf("durable outcome counts: cleaned=%d cleanups=%d", commits, cleanups)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	var metadata []contracts.FileHelperMeta
	result, err = a.executeFileJob(ctx, fileExecutionInput{Identity: identity, Action: "PROPFIND", Path: []string{"中文"}, Depth: 1, Conditions: conditions, OnMeta: func(item contracts.FileHelperMeta) error { metadata = append(metadata, item); return nil }})
	if err != nil || result.Status != 207 || len(metadata) != 2 {
		t.Fatal(result, metadata, err)
	}
	downloaded.Reset()
	if _, err := a.executeFileJob(ctx, fileExecutionInput{Identity: identity, Action: "GET", Path: []string{"中文", "binary"}, Conditions: conditions, OnData: func(chunk []byte) error { _, err := downloaded.Write(chunk); return err }}); err != nil || !bytes.Equal(downloaded.Bytes(), payload) {
		t.Fatal("failed PUT changed original file", err)
	}
	if remaining, err := a.dockerRuntime.ListContainers(ctx, "file-helper"); err != nil || len(remaining) != 0 {
		t.Fatal("file helper leaked", len(remaining), err)
	}
}
