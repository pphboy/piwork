package cli

import (
	"context"
	"encoding/json"
	"io"
	"mime"
	"net/http"
	"net/url"
	"time"
)

const desktopSkillImportLimit = int64(64 << 20)

// importDesktopWorkSkill forwards one complete Skill directory to the exact
// Core Work import route. The multipart body stays opaque here: Core owns tree
// validation, name rules and atomic publication.
func (d *nativeDesktop) importDesktopWorkSkill(w http.ResponseWriter, r *http.Request, t *desktopTransfers, workID string) {
	if d.view(r.Context(), "")["state"] != "authenticated" {
		desktopTransferError(w, 401, "AUTH_REQUIRED")
		return
	}
	d.mu.Lock()
	coreURL, record, generation := d.identity.coreURL, d.identity.credential, d.identity.generation
	d.mu.Unlock()
	if record == nil {
		desktopTransferError(w, 401, "AUTH_REQUIRED")
		return
	}
	media, params, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || media != "multipart/form-data" || params["boundary"] == "" || len(params["boundary"]) > 70 {
		desktopTransferError(w, 415, "MULTIPART_REQUIRED")
		return
	}
	if r.ContentLength > desktopSkillImportLimit {
		desktopTransferError(w, 413, "SKILL_UPLOAD_LIMIT_EXCEEDED")
		return
	}
	t.mu.Lock()
	if t.busy >= 2 {
		t.mu.Unlock()
		desktopTransferError(w, 429, "TRANSFER_BUSY")
		return
	}
	t.busy++
	t.mu.Unlock()
	defer func() { t.mu.Lock(); t.busy--; t.mu.Unlock() }()
	stageRoot, name, err := t.root.CreateTempDirectory("skill-import-")
	if err != nil {
		desktopTransferError(w, 507, "TRANSFER_STORAGE_FULL")
		return
	}
	defer func() { _ = t.root.RemoveTree(name); _ = stageRoot.Close() }()
	file, err := stageRoot.CreateExclusive("upload.bin")
	if err != nil {
		desktopTransferError(w, 507, "TRANSFER_STORAGE_FULL")
		return
	}
	defer file.Close()
	var total int64
	buffer := make([]byte, 64<<10)
	for {
		_ = http.NewResponseController(w).SetReadDeadline(time.Now().Add(time.Minute))
		n, readErr := r.Body.Read(buffer)
		if n > 0 {
			total += int64(n)
			if total > desktopSkillImportLimit {
				desktopTransferError(w, 413, "SKILL_UPLOAD_LIMIT_EXCEEDED")
				return
			}
			if _, err := file.Write(buffer[:n]); err != nil {
				desktopTransferError(w, 507, "TRANSFER_STORAGE_FULL")
				return
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			desktopTransferError(w, 400, "INVALID_SKILL_UPLOAD")
			return
		}
	}
	if total == 0 {
		desktopTransferError(w, 400, "INVALID_SKILL_UPLOAD")
		return
	}
	if err := file.Sync(); err != nil {
		desktopTransferError(w, 507, "TRANSFER_STORAGE_FULL")
		return
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		desktopTransferError(w, 507, "TRANSFER_STORAGE_FULL")
		return
	}
	d.mu.Lock()
	live := d.identity.generation == generation && d.identity.credential != nil && d.identity.credential.Token == record.Token
	d.mu.Unlock()
	if !live {
		desktopTransferError(w, 409, "CONNECTION_CHANGED")
		return
	}
	api, err := d.client(coreURL, record.Token)
	if err != nil {
		desktopTransferError(w, 503, "CORE_UNAVAILABLE")
		return
	}
	headers := make(http.Header)
	headers.Set("Content-Type", r.Header.Get("Content-Type"))
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Minute)
	defer cancel()
	response, err := api.Binary(ctx, http.MethodPost, "/api/v1/works/"+url.PathEscape(workID)+"/configuration/skills/import", headers, file, total)
	if err != nil {
		desktopTransferError(w, 503, "CORE_UNAVAILABLE")
		return
	}
	defer response.Body.Close()
	if response.StatusCode == 401 {
		d.revokeToken(coreURL, record.Token)
		desktopTransferError(w, 401, "AUTH_REQUIRED")
		return
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, (1<<20)+1))
	if err != nil || len(raw) > 1<<20 || !json.Valid(raw) {
		desktopTransferError(w, 502, "CORE_INVALID_RESPONSE")
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(response.StatusCode)
	_, _ = w.Write(raw)
}
