//go:build integration

package coreapp

import (
	"context"
	"database/sql"
	"strings"
	"testing"
	"time"

	"piwork/internal/corestore"
	"piwork/internal/fileprotocol"
)

func TestNativeCoreFileRecoveryRetainsUnknownCreateAndRetiresLateAttempt(t *testing.T) {
	a, _, auth, id, ctx := nativeApplyFixture(t)
	session, err := a.Identity.Authenticate(ctx, strings.TrimPrefix(auth, "Bearer "))
	if err != nil {
		t.Fatal(err)
	}
	var generation int64
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		return tx.QueryRow(`SELECT max(generation) FROM runtime_generations WHERE work_id=?`, id).Scan(&generation)
	}); err != nil {
		t.Fatal(err)
	}
	input := fileExecutionInput{Identity: fileAccessIdentity{WorkID: id, OwnerUserID: session.User.ID, SessionID: session.SessionID, RuntimeGeneration: generation}, Action: "PUT", Path: []string{"never-published"}, Conditions: emptyFileConditions()}
	job, attempt, err := a.acceptFileJob(ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		if err := corestore.UpdateFileJobState(tx, job.ID, "accepted", "starting", packageNow(), nil); err != nil {
			return err
		}
		return corestore.UpdateFileAttempt(tx, attempt.ID, "planned", "creating", packageNow(), nil)
	}); err != nil {
		t.Fatal(err)
	}
	attempt.State = "creating"
	if err := a.recoverFileJob(ctx, job.ID, false); fileprotocol.Code(err) != "FILE_CLEANUP_REQUIRED" {
		t.Fatal("unanswered create was treated as absent", err)
	}
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		pending, err := corestore.PendingFileJobs(tx, &id)
		if len(pending) != 1 || pending[0].ID != job.ID {
			t.Error("lost accepted job", pending)
		}
		attempts, err2 := corestore.FileAttempts(tx, job.ID)
		if err2 != nil {
			return err2
		}
		if len(attempts) != 1 || attempts[0].State != "creating" || attempts[0].ContainerID != nil {
			t.Error("invented create result", attempts)
		}
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := a.validateFileAccess(ctx, input.Identity); fileprotocol.Code(err) != "FILE_CLEANUP_REQUIRED" {
		t.Fatal("cleanup did not block this Work", err)
	}
	// The exact journaled late create arrives after its request is gone. It
	// remains unstarted and is retired by identity, without repeating PUT.
	created, err := a.dockerRuntime.EnsureFileHelper(ctx, fileAttemptSpec(job, attempt))
	if err != nil {
		t.Fatal(err)
	}
	if err := a.recoverFileJob(ctx, job.ID, true); err != nil {
		t.Fatal("late helper not retired", err)
	}
	if err := a.dockerRuntime.ConfirmContainerAbsent(ctx, created.ID, attempt.ContainerName); err != nil {
		t.Fatal(err)
	}
	if _, err := a.executeFileJob(ctx, fileExecutionInput{Identity: input.Identity, Action: "HEAD", Path: input.Path, Conditions: emptyFileConditions()}); fileprotocol.Code(err) != "FILE_NOT_FOUND" {
		t.Fatal("recovery replayed PUT", err)
	}
	// A temporary whose inode was never acknowledged is not guessed from its
	// pathname, even once the helper has a proven exit.
	job, attempt, err = a.acceptFileJob(ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		return corestore.InsertFileTemporary(tx, corestore.FileTemporary{ID: "temporary-00000000-0000-0000-0000-000000000001", JobID: job.ID, ParentSegmentsJSON: "[]", Name: ".piwork-file-unknown.tmp", State: "planned", CreatedAt: packageNow(), UpdatedAt: packageNow()})
	}); err != nil {
		t.Fatal(err)
	}
	if err := a.recoverFileJob(ctx, job.ID, false); fileprotocol.Code(err) != "FILE_CLEANUP_REQUIRED" {
		t.Fatal("unknown inode was guessed", err)
	}
	if err := a.recoverFileJob(ctx, job.ID, true); fileprotocol.Code(err) != "FILE_CLEANUP_REQUIRED" {
		t.Fatal("explicit retry guessed inode", err)
	}
	// Keep the ambiguous journal for the test assertion, then delete only this
	// never-created fixture intent so normal fixture shutdown can be verified.
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		if _, err := tx.Exec(`DELETE FROM work_file_temporaries WHERE job_id=?`, job.ID); err != nil {
			return err
		}
		return corestore.MarkFileCleaned(tx, job.ID, packageNow())
	}); err != nil {
		t.Fatal(err)
	}
	closing, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	if err := a.Close(closing); err != nil {
		t.Fatal(err)
	}
}
