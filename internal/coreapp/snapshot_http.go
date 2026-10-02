package coreapp

import (
	"context"
	"database/sql"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"golang.org/x/sys/unix"
	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/identity"
)

func (a *Application) snapshotHTTP(w http.ResponseWriter, r *http.Request, actor identity.Principal, token string) (bool, error) {
	if r.Method == "POST" && r.URL.EscapedPath() == "/api/v1/work-packages" {
		return true, a.uploadSnapshot(w, r, actor, token)
	}
	if r.Method == "POST" && r.URL.EscapedPath() == "/api/v1/work-imports" {
		input, err := readControlJSON[contracts.ImportWorkRequest](r, "ImportWorkRequestSchema", true)
		if err != nil {
			return true, err
		}
		accepted, err := a.acceptWorkImport(r.Context(), actor, input)
		if err != nil {
			_, view := contracts.ProjectError(snapshotPublicError(err))
			if view.Code == "QUOTA_EXCEEDED" {
				send(w, http.StatusConflict, view)
				return true, nil
			}
			return true, err
		}
		send(w, 202, accepted)
		return true, nil
	}
	path := r.URL.EscapedPath()
	const prefix = "/api/v1/works/"
	if r.Method == "GET" && strings.HasPrefix(path, prefix) && strings.HasSuffix(path, "/import-provenance") {
		raw := strings.TrimSuffix(strings.TrimPrefix(path, prefix), "/import-provenance")
		if raw == "" || strings.Contains(raw, "/") {
			return false, nil
		}
		id, err := url.PathUnescape(raw)
		if err != nil || !validResourceID(id) {
			return true, contracts.NewError("NOT_FOUND", "")
		}
		view, err := a.snapshotProvenanceView(r.Context(), actor, id)
		if err != nil {
			return true, err
		}
		send(w, 200, view)
		return true, nil
	}
	if r.Method == "POST" && strings.HasPrefix(path, prefix) && strings.HasSuffix(path, "/exports") {
		raw := strings.TrimSuffix(strings.TrimPrefix(path, prefix), "/exports")
		if strings.Contains(raw, "/") {
			return false, nil
		}
		id, err := url.PathUnescape(raw)
		if err != nil || !validResourceID(id) {
			return true, contracts.NewError("NOT_FOUND", "")
		}
		if values := r.Header.Values("Content-Type"); len(values) != 1 || values[0] != "application/json" {
			return true, contracts.NewError("UNSUPPORTED_MEDIA_TYPE", "")
		}
		input, err := readJSON[workActionInput](r)
		if err != nil {
			return true, err
		}
		if !input.IdempotencyKey.Present || input.IdempotencyKey.Null {
			return true, contracts.NewError("INVALID_REQUEST", "")
		}
		accepted, err := a.acceptWorkExport(r.Context(), actor, id, input.IdempotencyKey.Value)
		if err != nil {
			return true, err
		}
		send(w, 202, accepted)
		return true, nil
	}
	const snapshots = "/api/v1/work-snapshots/"
	if r.Method != "GET" || !strings.HasPrefix(path, snapshots) {
		return false, nil
	}
	parts := strings.Split(strings.TrimPrefix(path, snapshots), "/")
	if len(parts) > 2 || len(parts) < 1 || len(parts) == 2 && parts[1] != "content" {
		return false, nil
	}
	id, err := url.PathUnescape(parts[0])
	if err != nil || !validResourceID(id) {
		return true, contracts.NewError("NOT_FOUND", "")
	}
	var job corestore.SnapshotJob
	var pack corestore.SnapshotPackage
	var operation corestore.OperationRecord
	err = a.Store.Read(r.Context(), func(tx *sql.Tx) error {
		var operationID string
		if err := tx.QueryRow(`SELECT operation_id FROM snapshot_jobs WHERE snapshot_id=?`, id).Scan(&operationID); err != nil {
			return err
		}
		var err error
		job, err = corestore.ReadSnapshotJob(tx, operationID)
		if err != nil {
			return err
		}
		if err := snapshotOwner(actor, job.OwnerUserID); err != nil {
			return err
		}
		if job.PackageID == nil || job.SourceWorkID == nil {
			return corestore.ErrNotFound
		}
		pack, err = corestore.ReadSnapshotPackage(tx, *job.PackageID)
		return err
	})
	if errors.Is(err, sql.ErrNoRows) || errors.Is(err, corestore.ErrNotFound) {
		return true, contracts.NewError("NOT_FOUND", "")
	}
	if err != nil {
		return true, err
	}
	operation, err = a.Store.Operation(r.Context(), job.OperationID)
	if err != nil {
		return true, err
	}
	if len(parts) == 1 {
		var digest, size, expires, failure any
		if pack.State == "ready" {
			digest = pack.Digest
			size = pack.Size
			expires = pack.ExpiresAt
		}
		if operation.State == "failed" {
			failure = map[string]any{"code": "SNAPSHOT_EXPORT_FAILED", "message": "Work export failed"}
		}
		send(w, 200, map[string]any{"workId": job.SourceWorkID, "snapshotId": job.SnapshotID, "operationId": job.OperationID, "state": operation.State, "digest": digest, "size": size, "expiresAt": expires, "error": failure})
		return true, nil
	}
	if _, exists := r.Header["Range"]; exists {
		return true, contracts.NewError("RANGE_NOT_SUPPORTED", "")
	}
	if pack.State == "expired" || pack.ExpiresAt != nil && snapshotExpired(*pack.ExpiresAt) {
		return true, contracts.NewError("PACKAGE_EXPIRED", "")
	}
	if pack.State != "ready" || pack.Digest == nil {
		return true, contracts.NewError("PACKAGE_NOT_READY", "")
	}
	return true, a.downloadSnapshot(w, r, actor, token, job, pack)
}
func snapshotOwner(actor identity.Principal, owner string) error {
	if actor.UserID == owner && !actor.IsOperator() {
		return nil
	}
	if actor.Role == "admin" && !actor.IsOperator() {
		return contracts.NewError("PERMISSION_DENIED", "")
	}
	return contracts.NewError("NOT_FOUND", "")
}
func snapshotExpired(value string) bool {
	expires, err := time.Parse(time.RFC3339Nano, value)
	return err != nil || !expires.After(time.Now())
}
func (a *Application) downloadSnapshot(w http.ResponseWriter, r *http.Request, actor identity.Principal, token string, job corestore.SnapshotJob, pack corestore.SnapshotPackage) error {
	if !a.beginSnapshotTransfer() {
		return contracts.NewError("RUNTIME_UNAVAILABLE", "")
	}
	defer a.snapshotWG.Done()
	transferID := "transfer-" + uuid.NewString()
	now := packageNow()
	deadline := time.Now().Add(30 * time.Minute)
	a.snapshotTransfers.Store(transferID, true)
	defer a.snapshotTransfers.Delete(transferID)
	transfer := corestore.SnapshotTransfer{ID: transferID, OwnerUserID: actor.UserID, PackageID: &pack.ID, SnapshotID: job.SnapshotID, Kind: "download", Phase: "streaming", DeadlineAt: deadline.UTC().Format(time.RFC3339Nano), LastProgressAt: now, CreatedAt: now}
	if err := a.Store.Write(r.Context(), func(tx *sql.Tx) error {
		if err := a.Identity.AuthorizePrincipalTx(tx, actor); err != nil {
			return err
		}
		return corestore.AcceptSnapshotTransfer(tx, transfer, nil)
	}); err != nil {
		return snapshotPublicError(err)
	}
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = a.Store.Write(ctx, func(tx *sql.Tx) error { return corestore.FinishSnapshotTransfer(tx, transferID, true) })
	}()
	packages, err := a.Store.OpenSnapshotArea("packages")
	if err != nil {
		return contracts.NewError("PACKAGE_UNAVAILABLE", "")
	}
	defer packages.Close()
	file, err := packages.OpenFile(pack.ID+".work", unix.O_RDONLY)
	if err != nil {
		return contracts.NewError("PACKAGE_UNAVAILABLE", "")
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() != pack.Size {
		return contracts.NewError("PACKAGE_UNAVAILABLE", "")
	}
	ctx, cancel := context.WithDeadline(r.Context(), deadline)
	defer cancel()
	controller := http.NewResponseController(w)
	stopCore := context.AfterFunc(a.ctx, cancel)
	defer stopCore()
	ioDone := make(chan struct{})
	stopIO := context.AfterFunc(ctx, func() { defer close(ioDone); _ = controller.SetWriteDeadline(time.Now()); file.Close() })
	watchDone := make(chan struct{})
	go func() {
		defer close(watchDone)
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				session, err := a.Identity.Authenticate(ctx, token)
				if err != nil || session.User.ID != actor.UserID || session.SessionID != actor.SessionID {
					cancel()
					return
				}
			}
		}
	}()
	defer func() {
		if !stopIO() {
			<-ioDone
		}
		cancel()
		<-watchDone
		_ = controller.SetWriteDeadline(time.Time{})
	}()
	w.Header().Set("Content-Type", "application/vnd.piwork.work-package")
	w.Header().Set("Content-Length", strconv.FormatInt(pack.Size, 10))
	w.Header().Set("X-Piwork-SHA256", *pack.Digest)
	w.Header().Set("Content-Disposition", `attachment; filename="snapshot.work"`)
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(200)
	buffer := make([]byte, 1<<20)
	lastProgress := time.Now()
	var copied int64
	for {
		if ctx.Err() != nil {
			panic(http.ErrAbortHandler)
		}
		n, readErr := file.Read(buffer)
		if n > 0 {
			_ = controller.SetWriteDeadline(time.Now().Add(60 * time.Second))
			written, writeErr := w.Write(buffer[:n])
			copied += int64(written)
			if writeErr != nil || written != n {
				cancel()
				panic(http.ErrAbortHandler)
			}
			if time.Since(lastProgress) > time.Second {
				if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
					return corestore.UpdateSnapshotTransfer(tx, transferID, "streaming", packageNow(), nil)
				}); err != nil {
					cancel()
					panic(http.ErrAbortHandler)
				}
				lastProgress = time.Now()
			}
		}
		if readErr == io.EOF {
			if copied != pack.Size {
				cancel()
				panic(http.ErrAbortHandler)
			}
			return nil
		}
		if readErr != nil {
			cancel()
			panic(http.ErrAbortHandler)
		}
	}
}

// Admission shares the application close lock so Wait cannot race a new Add.
func (a *Application) beginSnapshotTransfer() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.closed || a.ctx.Err() != nil {
		return false
	}
	a.snapshotWG.Add(1)
	return true
}
