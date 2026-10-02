package cli

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"golang.org/x/sys/unix"
	"piwork/internal/client"
	"piwork/internal/workpackage"
)

const desktopTransferLifetime = time.Hour
const desktopTransferStorage = int64(200) << 30
const desktopTransferReserve = int64(1) << 30

var desktopTransferID = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

type desktopTransfer struct {
	id, kind, path, sessionID  string
	created                    time.Time
	phase                      string
	transferred, size          int64
	reservation                int64
	total                      *int64
	digest                     string
	summary                    workpackage.Inspection
	generation                 int
	userID, workID, snapshotID string
	info                       os.FileInfo
	importing, attempted       bool
	accepted                   json.RawMessage
	cancel                     context.CancelFunc
	epoch                      int
}

type desktopTransfers struct {
	mu        sync.Mutex
	directory string
	jobs      map[string]*desktopTransfer
	busy      int
	pending   int64
	reserved  int64
	closed    bool
	epoch     int
	stop      chan struct{}
}

func newDesktopTransfers(credentialPath string) (*desktopTransfers, error) {
	parent := filepath.Join(filepath.Dir(credentialPath), "desktop-transfers-go")
	if err := os.MkdirAll(parent, 0700); err != nil {
		return nil, err
	}
	info, err := os.Lstat(parent)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return nil, errors.New("unsafe Desktop transfer directory")
	}
	resolved, err := filepath.EvalSymlinks(parent)
	if err != nil || resolved != parent {
		return nil, errors.New("unsafe Desktop transfer directory")
	}
	if err := os.Chmod(parent, 0700); err != nil {
		return nil, err
	}
	for _, entry := range mustReadDir(parent) {
		var pid int
		if _, err := fmt.Sscanf(entry.Name(), "instance-%d-", &pid); err != nil || pid <= 0 || pid == os.Getpid() || !entry.IsDir() {
			continue
		}
		if err := syscall.Kill(pid, 0); errors.Is(err, syscall.ESRCH) {
			_ = os.RemoveAll(filepath.Join(parent, entry.Name()))
		}
	}
	dir, err := os.MkdirTemp(parent, fmt.Sprintf("instance-%d-", os.Getpid()))
	if err != nil {
		return nil, err
	}
	t := &desktopTransfers{directory: dir, jobs: map[string]*desktopTransfer{}, stop: make(chan struct{})}
	go t.sweep()
	return t, nil
}

func mustReadDir(path string) []os.DirEntry { entries, _ := os.ReadDir(path); return entries }

func (t *desktopTransfers) expireLocked() {
	for id, job := range t.jobs {
		if time.Since(job.created) < desktopTransferLifetime {
			continue
		}
		if job.cancel != nil {
			job.cancel()
		} else if job.size > 0 {
			t.pending -= job.size
		}
		_ = os.Remove(job.path)
		delete(t.jobs, id)
	}
}

func (t *desktopTransfers) sweep() {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			t.mu.Lock()
			t.expireLocked()
			t.mu.Unlock()
		case <-t.stop:
			return
		}
	}
}

func (t *desktopTransfers) clear() {
	t.mu.Lock()
	if t.closed {
		t.mu.Unlock()
		return
	}
	close(t.stop)
	t.closed = true
	for _, job := range t.jobs {
		if job.cancel != nil {
			job.cancel()
		}
	}
	t.mu.Unlock()
	_ = os.RemoveAll(t.directory)
}

func (t *desktopTransfers) revoke(hadCredential bool) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if hadCredential {
		t.epoch++
	}
	for id, job := range t.jobs {
		if !hadCredential && job.kind == "inspect" {
			continue
		}
		if job.cancel != nil {
			job.cancel()
		}
		if job.path != "" {
			_ = os.Remove(job.path)
		}
		if job.cancel == nil && job.size > 0 {
			t.pending -= job.size
		}
		delete(t.jobs, id)
	}
}

func desktopTransferError(w http.ResponseWriter, status int, code string) {
	message := code
	switch code {
	case "SNAPSHOT_MISMATCH":
		message = "Snapshot content changed"
	case "TRANSFER_STORAGE_FULL":
		message = "Local storage is full"
	case "PACKAGE_INVALID":
		message = "Work package validation failed"
	case "IMPORT_RESULT_UNKNOWN":
		message = "Import was already submitted; check the original Operation before retrying"
	case "PACKAGE_CHANGED":
		message = "Staged package changed"
	}
	desktopJSON(w, status, map[string]string{"code": code, "message": message})
}

func randomTransferID() (string, error) {
	var raw [16]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", err
	}
	raw[6] = raw[6]&0x0f | 0x40
	raw[8] = raw[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", raw[:4], raw[4:6], raw[6:8], raw[8:10], raw[10:]), nil
}

func sameDesktopFile(a, b os.FileInfo) bool {
	if a == nil || b == nil || !a.Mode().IsRegular() || !b.Mode().IsRegular() || a.Size() != b.Size() || !a.ModTime().Equal(b.ModTime()) {
		return false
	}
	return os.SameFile(a, b)
}

func (t *desktopTransfers) claim(id, kind, sessionID string, expected *int64, generation int, userID string, cancel context.CancelFunc) (*desktopTransfer, int, string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.expireLocked()
	if t.closed {
		return nil, 503, "TRANSFER_UNAVAILABLE"
	}
	if _, exists := t.jobs[id]; exists {
		return nil, 409, "TRANSFER_EXISTS"
	}
	if t.busy >= 2 {
		return nil, 429, "TRANSFER_BUSY"
	}
	if expected != nil && (*expected < 1 || *expected > workpackage.DefaultLimits.PackageBytes) {
		return nil, 413, "PACKAGE_LIMIT_EXCEEDED"
	}
	reservation := valueOrZero(expected)
	if expected == nil {
		reservation = workpackage.DefaultLimits.PackageBytes
	}
	if t.pending+t.reserved+reservation > desktopTransferStorage {
		return nil, 507, "TRANSFER_STORAGE_FULL"
	}
	var stats unix.Statfs_t
	if unix.Statfs(t.directory, &stats) != nil || int64(stats.Bavail)*int64(stats.Bsize) < desktopTransferReserve+reservation {
		return nil, 507, "TRANSFER_STORAGE_FULL"
	}
	job := &desktopTransfer{id: id, kind: kind, sessionID: sessionID, created: time.Now(), phase: "receiving", generation: generation, userID: userID, total: expected, cancel: cancel, epoch: t.epoch, reservation: reservation}
	job.path = filepath.Join(t.directory, id)
	if kind == "download" {
		job.phase = "downloading"
	}
	t.jobs[id] = job
	t.busy++
	t.reserved += reservation
	return job, 0, ""
}

func valueOrZero(value *int64) int64 {
	if value == nil {
		return 0
	}
	return *value
}

func (t *desktopTransfers) finish(job *desktopTransfer, success bool) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.busy--
	t.reserved -= job.reservation
	job.cancel = nil
	if t.jobs[job.id] != job || job.epoch != t.epoch || t.closed {
		if job.path != "" {
			_ = os.Remove(job.path)
		}
		return
	}
	if success {
		job.phase = "ready"
		t.pending += job.size
	} else {
		delete(t.jobs, job.id)
		if job.path != "" {
			_ = os.Remove(job.path)
		}
	}
}

func (t *desktopTransfers) get(id, sessionID, kind string) (*desktopTransfer, int, string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.expireLocked()
	job := t.jobs[id]
	if job == nil || job.sessionID != sessionID || job.kind != kind || time.Since(job.created) >= desktopTransferLifetime {
		return nil, 404, "TRANSFER_NOT_FOUND"
	}
	return job, 0, ""
}

func (d *nativeDesktop) transferStore() (*desktopTransfers, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.transfers == nil {
		t, err := newDesktopTransfers(d.store.Path)
		if err != nil {
			return nil, err
		}
		d.transfers = t
	}
	return d.transfers, nil
}

func (d *nativeDesktop) serveTransfer(w http.ResponseWriter, r *http.Request, session desktopSession) bool {
	path := strings.TrimPrefix(r.URL.Path, "/_desktop/api/")
	parts := strings.Split(path, "/")
	transferPath := path == "work-packages" || path == "work-imports" ||
		len(parts) >= 2 && (parts[0] == "work-packages" || parts[0] == "downloads") ||
		len(parts) == 3 && (parts[0] == "work-snapshots" && parts[2] == "downloads" || parts[0] == "works" && parts[2] == "package-uploads")
	if !transferPath {
		return false
	}
	if r.URL.RawQuery != "" {
		desktopTransferError(w, 400, "INVALID_TRANSFER")
		return true
	}
	t, err := d.transferStore()
	if err != nil {
		desktopTransferError(w, 503, "TRANSFER_STORAGE_INVALID")
		return true
	}
	switch {
	case path == "work-packages" && r.Method == http.MethodPost:
		d.receiveDesktopPackage(w, r, session, t)
	case path == "work-imports" && r.Method == http.MethodPost:
		d.importDesktopPackage(w, r, session, t)
	case len(parts) == 2 && parts[0] == "work-packages" && desktopTransferID.MatchString(parts[1]) && (r.Method == http.MethodGet || r.Method == http.MethodDelete):
		d.desktopTransferStatus(w, r, session, t, parts[1], "inspect")
	case len(parts) == 2 && parts[0] == "downloads" && desktopTransferID.MatchString(parts[1]) && (r.Method == http.MethodGet || r.Method == http.MethodDelete):
		d.desktopTransferStatus(w, r, session, t, parts[1], "download")
	case len(parts) == 3 && parts[0] == "downloads" && parts[2] == "content" && desktopTransferID.MatchString(parts[1]) && r.Method == http.MethodGet:
		d.serveDesktopDownload(w, r, session, t, parts[1])
	case len(parts) == 3 && parts[0] == "work-snapshots" && parts[2] == "downloads" && desktopIDPattern.MatchString(parts[1]) && r.Method == http.MethodPost:
		d.prepareDesktopDownload(w, r, session, t, parts[1])
	case len(parts) == 3 && parts[0] == "works" && parts[2] == "package-uploads" && desktopIDPattern.MatchString(parts[1]) && r.Method == http.MethodPost:
		d.uploadDesktopPiPackage(w, r, session, t, parts[1])
	default:
		desktopTransferError(w, 404, "TRANSFER_NOT_FOUND")
	}
	return true
}

func desktopTransferWrite(w http.ResponseWriter, r io.Reader, file *os.File, expected *int64, progress func(int64)) (int64, string, error) {
	hash := sha256.New()
	buffer := make([]byte, 64<<10)
	var size int64
	for {
		_ = http.NewResponseController(w).SetReadDeadline(time.Now().Add(time.Minute))
		n, err := r.Read(buffer)
		if n > 0 {
			size += int64(n)
			if size > workpackage.DefaultLimits.PackageBytes || expected != nil && size > *expected {
				return size, "", errors.New("PACKAGE_LIMIT_EXCEEDED")
			}
			if _, e := file.Write(buffer[:n]); e != nil {
				return size, "", e
			}
			_, _ = hash.Write(buffer[:n])
			progress(size)
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return size, "", err
		}
	}
	if expected != nil && size != *expected {
		return size, "", errors.New("PACKAGE_LENGTH_MISMATCH")
	}
	if err := file.Sync(); err != nil {
		return size, "", err
	}
	return size, hex.EncodeToString(hash.Sum(nil)), nil
}

func (d *nativeDesktop) receiveDesktopPackage(w http.ResponseWriter, r *http.Request, s desktopSession, t *desktopTransfers) {
	if r.Header.Get("Content-Type") != workPackageMIME {
		desktopTransferError(w, 415, "PACKAGE_MIME_REQUIRED")
		return
	}
	id := r.Header.Get("X-Piwork-Transfer-Id")
	if id == "" {
		id, _ = randomTransferID()
	}
	if !desktopTransferID.MatchString(id) {
		desktopTransferError(w, 400, "INVALID_TRANSFER")
		return
	}
	var expected *int64
	if r.ContentLength >= 0 {
		n := r.ContentLength
		expected = &n
	}
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	job, status, code := t.claim(id, "inspect", s.id, expected, 0, "", cancel)
	if status != 0 {
		desktopTransferError(w, status, code)
		return
	}
	success := false
	defer func() { t.finish(job, success) }()
	file, err := os.OpenFile(job.path, os.O_RDWR|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		desktopTransferError(w, 507, "TRANSFER_STORAGE_FULL")
		return
	}
	defer file.Close()
	size, digest, err := desktopTransferWrite(w, r.Body, file, expected, func(n int64) { t.mu.Lock(); job.transferred = n; t.mu.Unlock() })
	if err != nil {
		if err.Error() == "PACKAGE_LIMIT_EXCEEDED" {
			desktopTransferError(w, 413, err.Error())
		} else if err.Error() == "PACKAGE_LENGTH_MISMATCH" {
			desktopTransferError(w, 400, err.Error())
		} else {
			desktopTransferError(w, 507, "TRANSFER_STORAGE_FULL")
		}
		return
	}
	t.mu.Lock()
	job.phase = "validating"
	t.mu.Unlock()
	inspection, err := workpackage.Inspect(ctx, file, size)
	if err != nil || inspection.Size != size || inspection.Digest != digest {
		desktopTransferError(w, 400, "PACKAGE_INVALID")
		return
	}
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		desktopTransferError(w, 409, "PACKAGE_CHANGED")
		return
	}
	t.mu.Lock()
	job.size = size
	job.digest = digest
	job.summary = inspection
	job.info = info
	t.mu.Unlock()
	success = true
	desktopJSON(w, 200, map[string]any{"transferId": id, "summary": inspection})
}

func (d *nativeDesktop) desktopTransferStatus(w http.ResponseWriter, r *http.Request, s desktopSession, t *desktopTransfers, id, kind string) {
	job, status, code := t.get(id, s.id, kind)
	if status != 0 {
		desktopTransferError(w, status, code)
		return
	}
	if kind == "download" && !d.desktopTransferOwner(r, job) {
		desktopTransferError(w, 401, "AUTH_REQUIRED")
		return
	}
	if r.Method == http.MethodDelete {
		t.mu.Lock()
		if job.cancel != nil {
			job.cancel()
		} else {
			delete(t.jobs, id)
			t.pending -= job.size
			_ = os.Remove(job.path)
		}
		t.mu.Unlock()
		desktopJSON(w, 200, map[string]bool{"removed": true})
		return
	}
	t.mu.Lock()
	phase, transferred, total, size, digest, summary, workID, snapshotID := job.phase, job.transferred, job.total, job.size, job.digest, job.summary, job.workID, job.snapshotID
	t.mu.Unlock()
	value := map[string]any{"transferId": id, "kind": kind, "phase": phase, "transferred": transferred, "total": total}
	if phase == "ready" || phase == "accepted" || phase == "unknown" {
		value["size"] = size
		value["digest"] = digest
		if kind == "inspect" {
			value["summary"] = summary
		} else {
			value["workId"] = workID
			value["snapshotId"] = snapshotID
			value["ready"] = true
		}
	}
	desktopJSON(w, 200, value)
}

func (d *nativeDesktop) desktopTransferOwner(r *http.Request, job *desktopTransfer) bool {
	if d.view(r.Context(), "")["state"] != "authenticated" {
		return false
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.identity.credential != nil && d.identity.generation == job.generation && d.identity.credential.User.ID == job.userID
}

func desktopTransferFile(job *desktopTransfer) (*os.File, error) {
	file, err := os.OpenFile(job.path, os.O_RDONLY|unix.O_NOFOLLOW, 0)
	if err != nil {
		return nil, err
	}
	info, err := file.Stat()
	if err != nil || !sameDesktopFile(job.info, info) {
		file.Close()
		return nil, errors.New("PACKAGE_CHANGED")
	}
	return file, nil
}

func (d *nativeDesktop) importDesktopPackage(w http.ResponseWriter, r *http.Request, s desktopSession, t *desktopTransfers) {
	input, err := desktopControlInput(r, "transferId", "name")
	if err != nil {
		desktopControlFailure(w, err)
		return
	}
	var id, name string
	if json.Unmarshal(input["transferId"], &id) != nil || !desktopTransferID.MatchString(id) {
		desktopTransferError(w, 400, "INVALID_TRANSFER")
		return
	}
	if raw, ok := input["name"]; ok {
		if json.Unmarshal(raw, &name) != nil || strings.TrimSpace(name) == "" || len(name) > 128 || strings.ContainsRune(name, 0) {
			desktopTransferError(w, 400, "INVALID_NAME")
			return
		}
	}
	job, status, code := t.get(id, s.id, "inspect")
	if status != 0 {
		desktopTransferError(w, status, code)
		return
	}
	if d.view(r.Context(), "")["state"] != "authenticated" {
		desktopTransferError(w, 401, "AUTH_REQUIRED")
		return
	}
	d.mu.Lock()
	coreURL, record, generation := d.identity.coreURL, d.identity.credential, d.identity.generation
	d.mu.Unlock()
	t.mu.Lock()
	if job.phase != "ready" && job.phase != "accepted" && job.phase != "unknown" {
		t.mu.Unlock()
		desktopTransferError(w, 409, "TRANSFER_NOT_READY")
		return
	}
	if len(job.accepted) > 0 {
		accepted := append([]byte(nil), job.accepted...)
		t.mu.Unlock()
		desktopJSON(w, 202, json.RawMessage(accepted))
		return
	}
	if job.attempted || job.importing {
		t.mu.Unlock()
		desktopTransferError(w, 409, "IMPORT_RESULT_UNKNOWN")
		return
	}
	job.importing = true
	job.phase = "uploading"
	t.mu.Unlock()
	defer func() {
		t.mu.Lock()
		job.importing = false
		if !job.attempted && job.phase != "accepted" {
			job.phase = "ready"
		}
		t.mu.Unlock()
	}()
	file, err := desktopTransferFile(job)
	if err != nil {
		desktopTransferError(w, 409, "PACKAGE_CHANGED")
		return
	}
	defer file.Close()
	hash := sha256.New()
	n, err := io.Copy(hash, file)
	if err != nil || n != job.size || hex.EncodeToString(hash.Sum(nil)) != job.digest {
		desktopTransferError(w, 409, "PACKAGE_CHANGED")
		return
	}
	_, _ = file.Seek(0, io.SeekStart)
	api, _ := client.New(coreURL, record.Token)
	headers := make(http.Header)
	headers.Set("Content-Type", workPackageMIME)
	headers.Set("X-Piwork-Sha256", job.digest)
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Minute)
	defer cancel()
	response, err := api.Binary(ctx, "POST", "/api/v1/work-packages", headers, file, job.size)
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
	if response.StatusCode != 201 && response.StatusCode != 200 {
		desktopTransferError(w, response.StatusCode, "PACKAGE_UPLOAD_FAILED")
		return
	}
	var uploaded struct {
		PackageID string `json:"packageId"`
		Digest    string `json:"digest"`
		Size      int64  `json:"size"`
	}
	if json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&uploaded) != nil || uploaded.PackageID == "" || uploaded.Digest != job.digest || uploaded.Size != job.size {
		desktopTransferError(w, 502, "PACKAGE_CHANGED")
		return
	}
	after, _ := file.Stat()
	if !sameDesktopFile(job.info, after) {
		desktopTransferError(w, 409, "PACKAGE_CHANGED")
		return
	}
	d.mu.Lock()
	live := d.identity.generation == generation && d.identity.credential != nil && d.identity.credential.Token == record.Token
	d.mu.Unlock()
	if !live {
		desktopTransferError(w, 409, "CONNECTION_CHANGED")
		return
	}
	key, _ := desktopRandomKey()
	payload := map[string]string{"packageId": uploaded.PackageID, "idempotencyKey": key}
	if name != "" {
		payload["name"] = name
	}
	t.mu.Lock()
	job.attempted = true
	job.phase = "submitting"
	t.mu.Unlock()
	var accepted json.RawMessage
	err = api.Request(ctx, "POST", "/api/v1/work-imports", payload, &accepted)
	if err != nil {
		var apiErr *client.APIError
		if errors.As(err, &apiErr) && apiErr.Status == 401 {
			d.revokeToken(coreURL, record.Token)
		}
		if errors.As(err, &apiErr) && apiErr.Status >= 400 && apiErr.Status < 500 && apiErr.Status != 408 {
			t.mu.Lock()
			job.attempted = false
			t.mu.Unlock()
		}
		desktopControlFailure(w, err)
		return
	}
	t.mu.Lock()
	job.accepted = append([]byte(nil), accepted...)
	job.phase = "accepted"
	t.mu.Unlock()
	var value map[string]json.RawMessage
	_ = json.Unmarshal(accepted, &value)
	if value != nil {
		saved := (desktopOperationRecords{credentialPath: d.store.Path}).accept(coreURL, record.User.ID, "Import Work", accepted) == nil
		value["localRecordSaved"], _ = json.Marshal(saved)
		desktopJSON(w, 202, value)
	} else {
		desktopJSON(w, 202, json.RawMessage(accepted))
	}
}

func (d *nativeDesktop) prepareDesktopDownload(w http.ResponseWriter, r *http.Request, s desktopSession, t *desktopTransfers, snapshotID string) {
	if d.view(r.Context(), "")["state"] != "authenticated" {
		desktopTransferError(w, 401, "AUTH_REQUIRED")
		return
	}
	d.mu.Lock()
	coreURL, record, generation := d.identity.coreURL, d.identity.credential, d.identity.generation
	d.mu.Unlock()
	api, _ := client.New(coreURL, record.Token)
	var metadata snapshotMetadata
	if err := api.Request(r.Context(), "GET", "/api/v1/work-snapshots/"+snapshotID, nil, &metadata); err != nil {
		var apiErr *client.APIError
		if errors.As(err, &apiErr) && apiErr.Status == 401 {
			d.revokeToken(coreURL, record.Token)
		}
		desktopControlFailure(w, err)
		return
	}
	if metadata.State != "succeeded" || metadata.Digest == nil || metadata.Size == nil || !sha256HeaderPattern.MatchString(*metadata.Digest) || !desktopIDPattern.MatchString(metadata.WorkID) {
		desktopTransferError(w, 409, "SNAPSHOT_NOT_READY")
		return
	}
	id := r.Header.Get("X-Piwork-Transfer-Id")
	if id == "" {
		id, _ = randomTransferID()
	}
	if !desktopTransferID.MatchString(id) {
		desktopTransferError(w, 400, "INVALID_TRANSFER")
		return
	}
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	idle := time.AfterFunc(time.Minute, cancel)
	defer idle.Stop()
	job, status, code := t.claim(id, "download", s.id, metadata.Size, generation, record.User.ID, cancel)
	if status != 0 {
		desktopTransferError(w, status, code)
		return
	}
	success := false
	defer func() { t.finish(job, success) }()
	file, err := os.OpenFile(job.path, os.O_RDWR|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		desktopTransferError(w, 507, "TRANSFER_STORAGE_FULL")
		return
	}
	defer file.Close()
	headers := make(http.Header)
	headers.Set("Accept", workPackageMIME)
	response, err := api.Binary(ctx, "GET", "/api/v1/work-snapshots/"+snapshotID+"/content", headers, nil, 0)
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
	if response.StatusCode != 200 {
		desktopTransferError(w, response.StatusCode, "SNAPSHOT_DOWNLOAD_FAILED")
		return
	}
	length, err := strconv.ParseInt(response.Header.Get("Content-Length"), 10, 64)
	if err != nil || length != *metadata.Size || response.Header.Get("Content-Type") != workPackageMIME || response.Header.Get("X-Piwork-Sha256") != *metadata.Digest {
		desktopTransferError(w, 502, "SNAPSHOT_MISMATCH")
		return
	}
	size, digest, err := desktopTransferWrite(w, response.Body, file, metadata.Size, func(n int64) { idle.Reset(time.Minute); t.mu.Lock(); job.transferred = n; t.mu.Unlock() })
	if err != nil || size != *metadata.Size || digest != *metadata.Digest {
		desktopTransferError(w, 502, "SNAPSHOT_MISMATCH")
		return
	}
	t.mu.Lock()
	job.phase = "validating"
	t.mu.Unlock()
	inspection, err := workpackage.Inspect(ctx, file, size)
	if err != nil || inspection.Digest != digest || inspection.Size != size {
		desktopTransferError(w, 502, "SNAPSHOT_MISMATCH")
		return
	}
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		desktopTransferError(w, 502, "SNAPSHOT_MISMATCH")
		return
	}
	d.mu.Lock()
	live := d.identity.generation == generation && d.identity.credential != nil && d.identity.credential.Token == record.Token
	d.mu.Unlock()
	if !live {
		desktopTransferError(w, 409, "CONNECTION_CHANGED")
		return
	}
	t.mu.Lock()
	job.size = size
	job.digest = digest
	job.summary = inspection
	job.info = info
	job.snapshotID = snapshotID
	job.workID = metadata.WorkID
	t.mu.Unlock()
	success = true
	desktopJSON(w, 200, map[string]any{"transferId": id, "workId": metadata.WorkID, "snapshotId": snapshotID, "size": size, "digest": digest, "ready": true})
}

func (d *nativeDesktop) serveDesktopDownload(w http.ResponseWriter, r *http.Request, s desktopSession, t *desktopTransfers, id string) {
	job, status, code := t.get(id, s.id, "download")
	if status != 0 {
		desktopTransferError(w, status, code)
		return
	}
	if !d.desktopTransferOwner(r, job) {
		desktopTransferError(w, 401, "AUTH_REQUIRED")
		return
	}
	t.mu.Lock()
	ready, size, workID := job.phase == "ready", job.size, job.workID
	t.mu.Unlock()
	if !ready {
		desktopTransferError(w, 409, "TRANSFER_NOT_READY")
		return
	}
	file, err := desktopTransferFile(job)
	if err != nil {
		desktopTransferError(w, 409, "PACKAGE_CHANGED")
		return
	}
	defer file.Close()
	w.Header().Set("Content-Type", workPackageMIME)
	w.Header().Set("Content-Length", strconv.FormatInt(size, 10))
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s.work\"", workID))
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.WriteHeader(200)
	_, _ = io.Copy(w, file)
}
