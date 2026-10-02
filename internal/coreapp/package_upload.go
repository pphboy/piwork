package coreapp

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/identity"
	"piwork/internal/pipackage"
	"piwork/internal/workaccess"
)

var packageUploadDigest = regexp.MustCompile(`^[a-f0-9]{64}$`)

type boundedPackageReader struct {
	reader   io.Reader
	control  *http.ResponseController
	deadline time.Time
	progress time.Time
}

func (reader *boundedPackageReader) Read(data []byte) (int, error) {
	next := reader.progress.Add(time.Minute)
	if next.After(reader.deadline) {
		next = reader.deadline
	}
	if !next.After(time.Now()) || reader.control.SetReadDeadline(next) != nil {
		return 0, context.DeadlineExceeded
	}
	n, err := reader.reader.Read(data)
	if n > 0 {
		reader.progress = time.Now()
	}
	return n, err
}

func acquirePackageUploadSlot(a *Application) bool {
	for {
		active := a.packageUploads.Load()
		if active >= 2 {
			return false
		}
		if a.packageUploads.CompareAndSwap(active, active+1) {
			return true
		}
	}
}

func packageUploadError(err error) error {
	var input *pipackage.InputError
	if errors.As(err, &input) {
		return contracts.NewError(input.Code, "")
	}
	if errors.Is(err, context.DeadlineExceeded) || timedOut(err) {
		return contracts.NewError("REQUEST_TIMEOUT", "")
	}
	return contracts.NewError("PI_PACKAGE_INVALID_SOURCE", "")
}

func (a *Application) packageUpload(w http.ResponseWriter, r *http.Request, actor identity.Principal, scope, workID string) error {
	if scope == "core" {
		if !actor.IsOperator() {
			if err := a.Identity.AuthorizeAdministrator(r.Context(), actor); err != nil {
				return err
			}
		}
	} else {
		if _, err := workaccess.Work(r.Context(), a.Store, actor, workID, workaccess.Control); err != nil {
			return err
		}
	}
	if r.Header.Get("Content-Type") != "application/zip" {
		return contracts.NewError("PI_PACKAGE_UNSUPPORTED_MEDIA_TYPE", "")
	}
	nameEncoded := r.Header.Get("X-Piwork-Package-Name")
	name, err := url.PathUnescape(nameEncoded)
	if err != nil || !utf8.ValidString(name) || name == "" || name == "." || name == ".." || len(name) > 255 || strings.ContainsAny(name, "/\\\x00") {
		return contracts.NewError("PI_PACKAGE_INVALID_SOURCE", "")
	}
	length, digest := r.ContentLength, r.Header.Get("X-Piwork-Sha256")
	kind := r.Header.Get("X-Piwork-Package-Source")
	if length <= 0 || !packageUploadDigest.MatchString(digest) || kind != "local" && kind != "zip" {
		return contracts.NewError("PI_PACKAGE_INVALID_SOURCE", "")
	}
	if length > pipackage.CompressedBytes {
		return contracts.NewError("PI_PACKAGE_LIMIT_EXCEEDED", "")
	}
	if !acquirePackageUploadSlot(a) {
		return contracts.NewError("RATE_LIMITED", "").WithRetryAfter(1000)
	}
	defer a.packageUploads.Add(-1)
	root, err := a.Store.OpenPackageUploadsRoot()
	if err != nil {
		return corestore.ErrStorage
	}
	defer root.Close()
	id := "upload-" + uuid.NewString()
	stage, final, inspection := id+".staging", id+".zip", id+".inspection"
	defer root.Remove(stage)
	defer root.RemoveTree(inspection)
	file, err := root.OpenFile(stage, os.O_WRONLY|os.O_CREATE|os.O_EXCL)
	if err != nil {
		return corestore.ErrStorage
	}
	now := time.Now()
	reader := &boundedPackageReader{reader: r.Body, control: http.NewResponseController(w), deadline: now.Add(30 * time.Minute), progress: now}
	hash := sha256.New()
	count, copyErr := io.Copy(io.MultiWriter(file, hash), io.LimitReader(reader, pipackage.CompressedBytes+1))
	syncErr, closeErr := file.Sync(), file.Close()
	if copyErr != nil {
		return packageUploadError(copyErr)
	}
	if count > pipackage.CompressedBytes {
		return contracts.NewError("PI_PACKAGE_LIMIT_EXCEEDED", "")
	}
	if syncErr != nil || closeErr != nil {
		return corestore.ErrStorage
	}
	if count != length || hex.EncodeToString(hash.Sum(nil)) != digest {
		return contracts.NewError("PI_PACKAGE_INVALID_SOURCE", "")
	}
	stagePath, err := root.Path(stage)
	if err != nil {
		return corestore.ErrStorage
	}
	inspectionPath, err := root.Path(inspection)
	if err != nil {
		return corestore.ErrStorage
	}
	if _, err := pipackage.ExtractArchive(r.Context(), stagePath, inspectionPath); err != nil {
		return packageUploadError(err)
	}
	if err := root.RemoveTree(inspection); err != nil {
		return corestore.ErrStorage
	}
	if err := root.RenameNoReplace(stage, final); err != nil {
		return corestore.ErrStorage
	}
	committed := false
	defer func() {
		if !committed {
			_ = root.Remove(final)
		}
	}()
	if err := root.Sync(); err != nil {
		return corestore.ErrStorage
	}
	created := time.Now().UTC()
	expires := created.Add(24 * time.Hour).Format(time.RFC3339Nano)
	contentDigest := "sha256:" + digest
	actorID := actor.UserID
	if actor.IsOperator() {
		actorID = "operator"
	}
	err = a.Store.Write(r.Context(), func(tx *sql.Tx) error {
		if actor.IsOperator() {
			values := r.Header.Values("Authorization")
			if len(values) != 1 || !strings.HasPrefix(values[0], "Operator ") || !a.Settings.VerifyOperator(r.Context(), strings.TrimPrefix(values[0], "Operator ")) {
				return contracts.NewError("OPERATOR_AUTHENTICATION_REQUIRED", "")
			}
		} else {
			if err := a.Identity.AuthorizePrincipalTx(tx, actor); err != nil {
				return err
			}
			if scope == "core" && actor.Role != "admin" {
				return contracts.NewError("PERMISSION_DENIED", "")
			}
		}
		var scopedWork *string
		if scope == "work" {
			work, err := corestore.ReadWork(tx, workID, false)
			if errors.Is(err, corestore.ErrNotFound) || err == nil && work.OwnerUserID != actor.UserID && actor.Role != "admin" {
				return contracts.NewError("NOT_FOUND", "")
			}
			if err != nil {
				return err
			}
			scopedWork = &workID
		}
		return corestore.InsertPackageUpload(tx, corestore.PackageUpload{ID: id, ActorID: actorID, ScopeKind: scope, WorkID: scopedWork, SourceKind: kind, DisplayName: name, Digest: &contentDigest, Size: count, State: "ready", ExpiresAt: &expires, CreatedAt: created.Format(time.RFC3339Nano)})
	})
	if err != nil {
		return err
	}
	committed = true
	send(w, http.StatusCreated, map[string]string{"uploadId": id, "expiresAt": expires})
	return nil
}

func (a *Application) workPackageUpload(w http.ResponseWriter, r *http.Request, actor identity.Principal) (bool, error) {
	if r.Method != http.MethodPost || !strings.HasPrefix(r.URL.EscapedPath(), "/api/v1/works/") || !strings.HasSuffix(r.URL.EscapedPath(), "/package-uploads") {
		return false, nil
	}
	parts := strings.Split(strings.TrimPrefix(r.URL.EscapedPath(), "/api/v1/works/"), "/")
	if len(parts) != 2 || parts[0] == "" {
		return false, nil
	}
	id, err := url.PathUnescape(parts[0])
	if err != nil || id == "" || id == "." || id == ".." || strings.ContainsAny(id, "/\\\x00") {
		return true, contracts.NewError("NOT_FOUND", "")
	}
	return true, a.packageUpload(w, r, actor, "work", id)
}
