package coreapp

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"net/http"
	"net/url"
	"time"
	"unicode/utf8"

	"piwork/internal/contracts"
	"piwork/internal/identity"
	"piwork/internal/skillartifact"
)

// Admin-only Skill content operations read and replace one file of the current
// verified artifact. The catalog metadata and public discovery responses keep
// their existing shape.

func (a *Application) adminSkillFiles(w http.ResponseWriter, r *http.Request, actor identity.Principal, name string) error {
	if err := a.Identity.AuthorizeAdministrator(r.Context(), actor); err != nil {
		return err
	}
	a.skillMu.Lock()
	defer a.skillMu.Unlock()
	snapshot, err := a.managedSkillSnapshot(r.Context(), name)
	if err != nil {
		return err
	}
	files := make([]contracts.AdminSkillFileEntry, 0, len(snapshot.Files))
	for _, file := range snapshot.Files {
		files = append(files, contracts.AdminSkillFileEntry{Path: file.Path, Size: int64(len(file.Data))})
	}
	send(w, http.StatusOK, contracts.AdminSkillFileList{Files: files})
	return nil
}

func (a *Application) adminSkillFileRead(w http.ResponseWriter, r *http.Request, actor identity.Principal, name string) error {
	if err := a.Identity.AuthorizeAdministrator(r.Context(), actor); err != nil {
		return err
	}
	relative, err := skillContentPath(r.URL.RawQuery)
	if err != nil {
		return err
	}
	a.skillMu.Lock()
	defer a.skillMu.Unlock()
	snapshot, err := a.managedSkillSnapshot(r.Context(), name)
	if err != nil {
		return err
	}
	data, ok := skillartifact.ReadFile(snapshot, relative)
	if !ok {
		return contracts.NewError("SKILL_FILE_NOT_FOUND", "")
	}
	if !utf8.Valid(data) || bytes.IndexByte(data, 0) >= 0 {
		return contracts.NewError("SKILL_FILE_NOT_TEXT", "")
	}
	w.Header().Set("Cache-Control", "no-store")
	send(w, http.StatusOK, contracts.AdminSkillFile{Path: relative, Content: string(data), Version: skillartifact.FileVersion(data)})
	return nil
}

func (a *Application) adminSkillFileSave(w http.ResponseWriter, r *http.Request, actor identity.Principal, name string) error {
	if err := a.Identity.AuthorizeAdministrator(r.Context(), actor); err != nil {
		return err
	}
	if r.ContentLength > skillUploadMaxBody {
		return contracts.NewError("SKILL_UPLOAD_LIMIT_EXCEEDED", "")
	}
	_ = http.NewResponseController(w).SetReadDeadline(time.Now().Add(30 * time.Minute))
	if !acquireSkillUploadSlot(a) {
		return contracts.NewError("SKILL_UPLOAD_BUSY", "").WithRetryAfter(1000)
	}
	defer a.skillUploads.Add(-1)
	input, err := readControlJSONLimit[contracts.AdminSkillFileSave](r, "AdminSkillFileSaveSchema", true, skillUploadMaxBody)
	if err != nil {
		_, view := contracts.ProjectError(err)
		switch view.Code {
		case "REQUEST_TOO_LARGE":
			return contracts.NewError("SKILL_UPLOAD_LIMIT_EXCEEDED", "")
		case "UNSUPPORTED_MEDIA_TYPE", "REQUEST_TIMEOUT":
			return err
		}
		return contracts.NewError("SKILL_FILE_INVALID", "")
	}
	if !skillartifact.ValidRelativePath(input.Path) || input.ExpectedVersion == "" {
		return contracts.NewError("SKILL_FILE_INVALID", "")
	}
	if len(input.Content) > skillUploadMaxFile {
		return contracts.NewError("SKILL_UPLOAD_LIMIT_EXCEEDED", "")
	}
	a.skillMu.Lock()
	defer a.skillMu.Unlock()
	snapshot, err := a.managedSkillSnapshot(r.Context(), name)
	if err != nil {
		return err
	}
	data, ok := skillartifact.ReadFile(snapshot, input.Path)
	if !ok {
		return contracts.NewError("SKILL_FILE_NOT_FOUND", "")
	}
	if !utf8.Valid(data) || bytes.IndexByte(data, 0) >= 0 {
		return contracts.NewError("SKILL_FILE_NOT_TEXT", "")
	}
	if skillartifact.FileVersion(data) != input.ExpectedVersion {
		return contracts.NewError("SKILL_FILE_CONFLICT", "")
	}
	next, err := skillartifact.ReplaceFile(snapshot, input.Path, []byte(input.Content))
	if err != nil {
		switch {
		case errors.Is(err, skillartifact.ErrFileNotFound):
			return contracts.NewError("SKILL_FILE_NOT_FOUND", "")
		case errors.Is(err, skillartifact.ErrFileNotText):
			return contracts.NewError("SKILL_FILE_NOT_TEXT", "")
		default:
			return contracts.NewError("SKILL_UPLOAD_LIMIT_EXCEEDED", "")
		}
	}
	if err := a.Identity.AuthorizeAdministrator(r.Context(), actor); err != nil {
		return err
	}
	if _, err := a.publishSkillSnapshotLocked(r.Context(), actor, next, true); err != nil {
		_, view := contracts.ProjectError(err)
		switch view.Code {
		case "NOT_FOUND":
			return contracts.NewError("SKILL_UNAVAILABLE", "")
		case "CONFLICT":
			return contracts.NewError("SKILL_FILE_CONFLICT", "")
		case "INVALID_REQUEST":
			return contracts.NewError("SKILL_FILE_INVALID", "")
		}
		return err
	}
	w.Header().Set("Cache-Control", "no-store")
	send(w, http.StatusOK, contracts.AdminSkillFileSaved{Path: input.Path, Version: skillartifact.FileVersion([]byte(input.Content))})
	return nil
}

// managedSkillSnapshot loads the catalog pointer and its complete verified
// artifact. Callers hold skillMu so a concurrent publication cannot swap the
// artifact between the catalog read and the content read.
func (a *Application) managedSkillSnapshot(ctx context.Context, name string) (skillartifact.Snapshot, error) {
	var identity string
	err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		return tx.QueryRowContext(ctx, `SELECT resolved_digest FROM catalog_entries WHERE kind='skill' AND name=?`, name).Scan(&identity)
	})
	if errors.Is(err, sql.ErrNoRows) || err == nil && identity == "" {
		return skillartifact.Snapshot{}, contracts.NewError("SKILL_UNAVAILABLE", "")
	}
	if err != nil {
		return skillartifact.Snapshot{}, err
	}
	snapshot, err := skillartifact.Load(a.Store, name, identity)
	if err != nil {
		return skillartifact.Snapshot{}, contracts.NewError("SKILL_UNAVAILABLE", "")
	}
	return snapshot, nil
}

func skillContentPath(rawQuery string) (string, error) {
	query, err := url.ParseQuery(rawQuery)
	if err != nil || len(query) != 1 {
		return "", contracts.NewError("SKILL_FILE_INVALID", "")
	}
	values, ok := query["path"]
	if !ok || len(values) != 1 || !skillartifact.ValidRelativePath(values[0]) {
		return "", contracts.NewError("SKILL_FILE_INVALID", "")
	}
	return values[0], nil
}
