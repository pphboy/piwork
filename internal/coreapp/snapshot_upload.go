package coreapp

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/google/uuid"
	"golang.org/x/sys/unix"
	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/dockerengine"
	"piwork/internal/identity"
	"piwork/internal/workpackage"
)

const snapshotMIME = "application/vnd.piwork.work-package"

func snapshotSingleHeader(r *http.Request, name string) (string, bool) {
	values := r.Header.Values(name)
	if len(values) != 1 {
		return "", false
	}
	return values[0], true
}

type snapshotUploadProgress struct {
	reader io.Reader
	last   time.Time
	update func() error
}

func (r *snapshotUploadProgress) Read(buffer []byte) (int, error) {
	n, err := r.reader.Read(buffer)
	if n > 0 && time.Since(r.last) >= time.Second {
		if updateErr := r.update(); updateErr != nil {
			return n, updateErr
		}
		r.last = time.Now()
	}
	return n, err
}

func (a *Application) uploadSnapshot(w http.ResponseWriter, r *http.Request, actor identity.Principal, token string) (returned error) {
	if !a.beginSnapshotTransfer() {
		return contracts.NewError("RUNTIME_UNAVAILABLE", "")
	}
	defer a.snapshotWG.Done()
	if a.Status().State != "READY" {
		return contracts.NewError("RUNTIME_UNAVAILABLE", "")
	}
	image, err := a.requireSnapshotImage()
	if err != nil {
		return err
	}
	media, ok := snapshotSingleHeader(r, "Content-Type")
	if !ok || media != snapshotMIME {
		return contracts.NewError("UNSUPPORTED_MEDIA_TYPE", "")
	}
	digest, ok := snapshotSingleHeader(r, "X-Piwork-SHA256")
	if !ok || !packageUploadDigest.MatchString(digest) {
		return contracts.NewError("INVALID_DIGEST", "")
	}
	if r.ContentLength <= 0 || len(r.TransferEncoding) != 0 {
		return contracts.NewError("CONTENT_LENGTH_REQUIRED", "")
	}
	if r.ContentLength > workpackage.DefaultLimits.PackageBytes {
		return contracts.NewError("PACKAGE_LIMIT_EXCEEDED", "")
	}
	now := packageNow()
	deadline := time.Now().Add(30 * time.Minute)
	transferID, packageID := "transfer-"+uuid.NewString(), "package-"+uuid.NewString()
	a.snapshotTransfers.Store(transferID, true)
	defer a.snapshotTransfers.Delete(transferID)
	transfer := corestore.SnapshotTransfer{ID: transferID, OwnerUserID: actor.UserID, PackageID: &packageID, Kind: "upload", Phase: "accepted", DeadlineAt: deadline.UTC().Format(time.RFC3339Nano), LastProgressAt: now, CreatedAt: now}
	if err := a.Store.Write(r.Context(), func(tx *sql.Tx) error {
		if err := a.Identity.AuthorizePrincipalTx(tx, actor); err != nil {
			return err
		}
		return corestore.AcceptSnapshotTransfer(tx, transfer, &corestore.SnapshotPackage{ID: packageID, OwnerUserID: actor.UserID, State: "staging", CreatedAt: now})
	}); err != nil {
		return snapshotPublicError(err)
	}
	var journal *snapshotHelperJournal
	sealed := false
	defer func() {
		if sealed {
			return
		}
		cleanup, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := a.cleanupSnapshotUpload(cleanup, transfer, journal, false); err != nil {
			raw := (*string)(nil)
			if journal != nil {
				value := string(snapshotRaw(journal))
				raw = &value
			}
			_ = a.Store.Write(cleanup, func(tx *sql.Tx) error {
				return corestore.UpdateSnapshotTransfer(tx, transferID, "cleanup-pending", packageNow(), raw)
			})
		}
	}()
	area, err := a.Store.OpenSnapshotArea("transfers")
	if err != nil {
		return err
	}
	defer area.Close()
	root, err := area.OpenDirectory(transferID)
	if err != nil {
		return err
	}
	defer root.Close()
	ownerMarker := snapshotRaw(snapshotUploadOwner{TransferID: transferID, PackageID: packageID, OwnerUserID: actor.UserID})
	if err := root.AtomicWrite("transfer-owner.json", "transfer-owner.tmp", ownerMarker); err != nil {
		return err
	}
	file, err := root.OpenFile("package.work", unix.O_RDWR|unix.O_CREAT|unix.O_EXCL)
	if err != nil {
		return err
	}
	defer file.Close()
	ctx, cancel := context.WithDeadline(r.Context(), deadline)
	defer cancel()
	controller := http.NewResponseController(w)
	stopCore := context.AfterFunc(a.ctx, cancel)
	defer stopCore()
	ioDone := make(chan struct{})
	stopIO := context.AfterFunc(ctx, func() { defer close(ioDone); _ = controller.SetReadDeadline(time.Now()); r.Body.Close() })
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
		_ = controller.SetReadDeadline(time.Time{})
	}()
	bounded := &boundedPackageReader{reader: r.Body, control: controller, deadline: deadline, progress: time.Now()}
	progress := &snapshotUploadProgress{reader: bounded, last: time.Now(), update: func() error {
		return a.Store.Write(ctx, func(tx *sql.Tx) error {
			return corestore.UpdateSnapshotTransfer(tx, transferID, "streaming", packageNow(), nil)
		})
	}}
	hash := sha256.New()
	size, err := io.CopyBuffer(io.MultiWriter(file, hash), io.LimitReader(progress, r.ContentLength+1), make([]byte, 1<<20))
	if err != nil {
		if ctx.Err() != nil || timedOut(err) {
			return contracts.NewError("REQUEST_TIMEOUT", "")
		}
		return contracts.NewError("PACKAGE_INVALID", "")
	}
	if size != r.ContentLength || hex.EncodeToString(hash.Sum(nil)) != digest {
		return contracts.NewError("PACKAGE_INVALID", "")
	}
	if err := file.Sync(); err != nil {
		return err
	}
	if err := root.Sync(); err != nil {
		return err
	}
	// Core independently verifies every received byte and all static capabilities;
	// neither a client inspect result nor the helper's receipt is a substitute.
	verified, err := workpackage.Read(ctx, io.NewSectionReader(file, 0, size), workpackage.ReadOptions{})
	if err != nil {
		return snapshotPublicError(err)
	}
	if err := workpackage.ValidatePackageContent(ctx, verified, verified.Open(file)); err != nil {
		return snapshotPublicError(err)
	}
	if err := workpackage.ValidateImages(ctx, verified, file); err != nil {
		return snapshotPublicError(err)
	}
	if verified.Digest != digest || verified.Size != size {
		return contracts.NewError("PACKAGE_INVALID", "")
	}
	journal = &snapshotHelperJournal{Spec: dockerengine.SnapshotHelperSpec{WorkID: "core", JobID: transferID, AttemptID: "attempt-" + uuid.NewString(), ImageID: image, SpoolDirectory: filepath.Join(a.options.DataDirectory, "snapshots", "transfers", transferID), Action: "verify-package", Epoch: 1, SpoolUser: strconv.Itoa(os.Geteuid()) + ":" + strconv.Itoa(os.Getegid())}, CreationIssued: true}
	marker := string(snapshotRaw(journal))
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		return corestore.UpdateSnapshotTransfer(tx, transferID, "verifying", packageNow(), &marker)
	}); err != nil {
		return err
	}
	ensured, err := a.dockerRuntime.EnsureSnapshotHelper(ctx, journal.Spec)
	if err != nil {
		return err
	}
	journal.ContainerID = ensured.ID
	marker = string(snapshotRaw(journal))
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		return corestore.UpdateSnapshotTransfer(tx, transferID, "verifying", packageNow(), &marker)
	}); err != nil {
		return err
	}
	output, runErr := a.dockerRuntime.RunSnapshotHelper(ctx, journal.Spec)
	cleanup, stopCleanup := context.WithTimeout(context.Background(), 15*time.Second)
	removeErr := a.retireSnapshotUploadHelper(cleanup, transferID, *journal)
	stopCleanup()
	if removeErr != nil {
		return removeErr
	}
	journal = nil
	if runErr != nil {
		return snapshotPublicError(runErr)
	}
	var receipt struct {
		Digest              string                            `json:"digest"`
		Size                int64                             `json:"size"`
		BindingRequirements contracts.WorkBindingRequirements `json:"bindingRequirements"`
	}
	if strictMetadata(output, &receipt) != nil || receipt.Digest != digest || receipt.Size != size || !bytes.Equal(snapshotRaw(receipt.BindingRequirements), snapshotRaw(verified.Spec.Bindings)) {
		return contracts.NewError("PACKAGE_INVALID", "")
	}
	session, err := a.Identity.Authenticate(ctx, token)
	if err != nil {
		return err
	}
	if session.SessionID != actor.SessionID || session.User.ID != actor.UserID {
		return contracts.NewError("AUTHENTICATION_REQUIRED", "")
	}
	packages, err := a.Store.OpenSnapshotArea("packages")
	if err != nil {
		return err
	}
	defer packages.Close()
	if err := root.PublishTo("package.work", packages, packageID+".work", false); err != nil {
		return err
	}
	ready := packageNow()
	expires := time.Now().Add(24 * time.Hour).UTC().Format(time.RFC3339Nano)
	var selected corestore.SnapshotPackage
	err = a.Store.Write(ctx, func(tx *sql.Tx) error {
		if err := a.Identity.AuthorizePrincipalTx(tx, actor); err != nil {
			return err
		}
		var err error
		selected, err = corestore.SealOrReuseSnapshotPackage(tx, packageID, actor.UserID, digest, size, ready, expires)
		if err != nil {
			return err
		}
		return corestore.FinishSnapshotTransfer(tx, transferID, true)
	})
	if err != nil {
		return err
	}
	sealed = true
	if selected.ID != packageID {
		_ = packages.Remove(packageID + ".work")
	}
	_ = area.RemoveTree(transferID)
	send(w, 201, map[string]any{"packageId": selected.ID, "digest": digest, "size": size, "expiresAt": selected.ExpiresAt, "bindingRequirements": receipt.BindingRequirements})
	return nil
}
func (a *Application) retireSnapshotUploadHelper(ctx context.Context, transferID string, journal snapshotHelperJournal) error {
	spec := journal.Spec
	if spec.JobID != transferID || spec.WorkID != "core" || spec.Action != "verify-package" || spec.SpoolDirectory != filepath.Join(a.options.DataDirectory, "snapshots", "transfers", transferID) {
		return corestore.ErrStorage
	}
	view, err := a.dockerRuntime.InspectSnapshotHelper(ctx, spec)
	if err != nil {
		return err
	}
	if view != nil {
		if journal.ContainerID != "" && journal.ContainerID != view.ID {
			return dockerengine.ErrIdentity
		}
		journal.ContainerID = view.ID
		marker := string(snapshotRaw(journal))
		if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
			_, err := tx.Exec(`UPDATE snapshot_transfers SET helper_id=?,last_progress_at=? WHERE id=?`, marker, packageNow(), transferID)
			return err
		}); err != nil {
			return err
		}
		if err := a.dockerRuntime.RemoveSnapshotHelper(ctx, spec, view.ID); err != nil {
			return err
		}
	} else if journal.ContainerID != "" {
		if err := a.dockerRuntime.ConfirmContainerAbsent(ctx, journal.ContainerID, dockerengine.SnapshotHelperName(a.Store.InstallationID(), spec.JobID, spec.AttemptID)); err != nil {
			return err
		}
	} else if journal.CreationIssued {
		return dockerengine.ErrStateUnknown
	}
	return a.Store.Write(ctx, func(tx *sql.Tx) error {
		if _, err := tx.Exec(`UPDATE snapshot_transfers SET helper_id=NULL,last_progress_at=? WHERE id=?`, packageNow(), transferID); err != nil {
			return err
		}
		_, err := tx.Exec(`DELETE FROM resource_bindings WHERE installation_id=? AND resource_kind='snapshot-helper' AND logical_id=?`, a.Store.InstallationID(), spec.WorkID+"/"+dockerengine.SnapshotHelperIdentity(spec).LogicalID)
		return err
	})
}
func (a *Application) cleanupSnapshotUpload(ctx context.Context, transfer corestore.SnapshotTransfer, journal *snapshotHelperJournal, keepPackage bool) error {
	if journal != nil {
		if err := a.retireSnapshotUploadHelper(ctx, transfer.ID, *journal); err != nil {
			return err
		}
	}
	if !keepPackage && transfer.PackageID != nil {
		packages, err := a.Store.OpenSnapshotArea("packages")
		if err != nil {
			return err
		}
		removeErr := packages.Remove(*transfer.PackageID + ".work")
		packages.Close()
		if removeErr != nil && !errors.Is(removeErr, os.ErrNotExist) {
			return removeErr
		}
	}
	area, err := a.Store.OpenSnapshotArea("transfers")
	if err != nil {
		return err
	}
	err = area.RemoveTree(transfer.ID)
	area.Close()
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return a.Store.Write(ctx, func(tx *sql.Tx) error {
		if !keepPackage && transfer.PackageID != nil {
			if _, err := tx.Exec(`UPDATE snapshot_packages SET state='expired' WHERE id=? AND state='staging'`, *transfer.PackageID); err != nil {
				return err
			}
		}
		return corestore.FinishSnapshotTransfer(tx, transfer.ID, true)
	})
}
