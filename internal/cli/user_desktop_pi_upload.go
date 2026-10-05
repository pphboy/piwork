package cli

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/url"
	"path/filepath"
	"strings"
	"time"

	"piwork/internal/client"
	"piwork/internal/clientfs"
	"piwork/internal/localweb"
	"piwork/internal/pipackage"
)

type desktopPackageInput struct {
	filename, name, source string
	bytes                  int64
	digest                 string
}

var errDesktopPiUploadMedia = errors.New("UNSUPPORTED_MEDIA_TYPE")

// The browser sends a multipart upload for either one ZIP or one directory.
// The directory's first component is its display name, not part of the Pi
// package tree that Core installs.
func receiveDesktopPiPackage(ctx context.Context, w http.ResponseWriter, r *http.Request, stage string) (desktopPackageInput, error) {
	media, params, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || media != "multipart/form-data" || params["boundary"] == "" || len(params["boundary"]) > 70 {
		return desktopPackageInput{}, errDesktopPiUploadMedia
	}
	if r.ContentLength > pipackage.RestoredBytes+(64<<20) {
		return desktopPackageInput{}, pipackage.ErrLimit
	}
	reader := multipart.NewReader(io.LimitReader(r.Body, pipackage.RestoredBytes+(64<<20)+1), params["boundary"])
	var kind, rootName, zipName string
	var count, total int64
	seen := map[string]bool{}
	treeRoot := filepath.Join(stage, "tree")
	stageRoot, err := clientfs.OpenPrivateDirectory(stage, false)
	if err != nil {
		return desktopPackageInput{}, err
	}
	defer stageRoot.Close()
	treeDirectory, err := stageRoot.Child("tree", true)
	if err != nil {
		return desktopPackageInput{}, err
	}
	defer treeDirectory.Close()
	for {
		if err := ctx.Err(); err != nil {
			return desktopPackageInput{}, err
		}
		_ = http.NewResponseController(w).SetReadDeadline(time.Now().Add(time.Minute))
		part, err := reader.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			return desktopPackageInput{}, err
		}
		field := part.FormName()
		if field == "kind" {
			if kind != "" || count != 0 {
				part.Close()
				return desktopPackageInput{}, pipackage.ErrSource
			}
			value, err := io.ReadAll(io.LimitReader(part, 17))
			part.Close()
			if err != nil || string(value) != "zip" && string(value) != "local" {
				return desktopPackageInput{}, pipackage.ErrSource
			}
			kind = string(value)
			continue
		}
		_, disposition, err := mime.ParseMediaType(part.Header.Get("Content-Disposition"))
		name := disposition["filename"]
		if err != nil || kind == "" || name == "" || (kind == "zip" && field != "zip" || kind == "local" && field != "files") {
			part.Close()
			return desktopPackageInput{}, pipackage.ErrSource
		}
		validated, ok := localweb.UploadPath(url.PathEscape(name), pipackage.MaxPathBytes, pipackage.MaxDepth)
		if !ok || seen[validated] || kind == "zip" && strings.Contains(validated, "/") {
			part.Close()
			return desktopPackageInput{}, pipackage.ErrSource
		}
		seen[validated] = true
		count++
		if count > pipackage.MaxEntries {
			part.Close()
			return desktopPackageInput{}, pipackage.ErrLimit
		}
		parent := stageRoot
		leaf := "package.zip"
		if kind == "zip" {
			if count != 1 || !localweb.DisplayName(validated) {
				part.Close()
				return desktopPackageInput{}, pipackage.ErrSource
			}
			zipName = validated
		} else {
			parts := strings.Split(validated, "/")
			if len(parts) < 2 || !localweb.DisplayName(parts[0]) {
				part.Close()
				return desktopPackageInput{}, pipackage.ErrSource
			}
			if rootName == "" {
				rootName = parts[0]
			} else if rootName != parts[0] {
				part.Close()
				return desktopPackageInput{}, pipackage.ErrSource
			}
			parent = treeDirectory
			for _, component := range parts[1 : len(parts)-1] {
				next, openErr := parent.Child(component, true)
				if parent != treeDirectory {
					parent.Close()
				}
				if openErr != nil {
					part.Close()
					return desktopPackageInput{}, openErr
				}
				parent = next
			}
			leaf = parts[len(parts)-1]
		}
		file, err := parent.CreateExclusive(leaf)
		if parent != stageRoot && parent != treeDirectory {
			parent.Close()
		}
		if err != nil {
			part.Close()
			return desktopPackageInput{}, err
		}
		var fileBytes int64
		buffer := make([]byte, 64<<10)
		for {
			_ = http.NewResponseController(w).SetReadDeadline(time.Now().Add(time.Minute))
			n, readErr := part.Read(buffer)
			if n > 0 {
				fileBytes += int64(n)
				total += int64(n)
				if fileBytes > pipackage.FileBytes || total > pipackage.RestoredBytes || kind == "zip" && fileBytes > pipackage.CompressedBytes {
					file.Close()
					part.Close()
					return desktopPackageInput{}, pipackage.ErrLimit
				}
				if _, err := file.Write(buffer[:n]); err != nil {
					file.Close()
					part.Close()
					return desktopPackageInput{}, err
				}
			}
			if readErr == io.EOF {
				break
			}
			if readErr != nil {
				file.Close()
				part.Close()
				return desktopPackageInput{}, readErr
			}
		}
		if err := file.Sync(); err != nil {
			file.Close()
			part.Close()
			return desktopPackageInput{}, err
		}
		if err := file.Close(); err != nil {
			part.Close()
			return desktopPackageInput{}, err
		}
		part.Close()
	}
	if count == 0 {
		return desktopPackageInput{}, pipackage.ErrSource
	}
	if kind == "zip" {
		archive, err := pipackage.OpenArchive(ctx, filepath.Join(stage, "package.zip"))
		if err != nil {
			return desktopPackageInput{}, err
		}
		archive.Close()
		return desktopPackageInput{filename: filepath.Join(stage, "package.zip"), name: zipName, source: "zip", bytes: total}, nil
	}
	if !seen[rootName+"/package.json"] {
		return desktopPackageInput{}, pipackage.ErrSource
	}
	tree, err := pipackage.OpenTree(ctx, treeRoot)
	if err != nil {
		return desktopPackageInput{}, err
	}
	defer tree.Close()
	filename := filepath.Join(stage, "package.zip")
	packed, err := pipackage.PackArchive(ctx, tree, filename)
	if err != nil {
		return desktopPackageInput{}, err
	}
	return desktopPackageInput{filename: filename, name: rootName, source: "local", bytes: packed.Bytes, digest: packed.Digest}, nil
}

func (d *nativeDesktop) uploadDesktopPiPackage(w http.ResponseWriter, r *http.Request, _ desktopSession, t *desktopTransfers, workID string) {
	if d.view(r.Context(), "")["state"] != "authenticated" {
		desktopTransferError(w, 401, "AUTH_REQUIRED")
		return
	}
	d.mu.Lock()
	coreURL, record, generation := d.identity.coreURL, d.identity.credential, d.identity.generation
	d.mu.Unlock()
	api, _ := client.New(coreURL, record.Token)
	var work json.RawMessage
	if err := api.Request(r.Context(), "GET", "/api/v1/works/"+url.PathEscape(workID), nil, &work); err != nil {
		var apiErr *client.APIError
		if errors.As(err, &apiErr) && apiErr.Status == 401 {
			d.revokeToken(coreURL, record.Token)
		}
		desktopControlFailure(w, err)
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
	stageRoot, name, err := t.root.CreateTempDirectory("pi-package-")
	if err != nil {
		desktopTransferError(w, 507, "TRANSFER_STORAGE_FULL")
		return
	}
	defer func() { _ = t.root.RemoveTree(name); _ = stageRoot.Close() }()
	stage := filepath.Join(t.directory, name)
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Minute)
	defer cancel()
	input, err := receiveDesktopPiPackage(ctx, w, r, stage)
	if err != nil {
		var packageErr *pipackage.InputError
		switch {
		case errors.Is(err, errDesktopPiUploadMedia):
			desktopTransferError(w, 415, "MULTIPART_REQUIRED")
		case errors.As(err, &packageErr):
			status := 400
			if packageErr.Code == "PI_PACKAGE_LIMIT_EXCEEDED" {
				status = 413
			}
			desktopTransferError(w, status, packageErr.Code)
		default:
			desktopTransferError(w, 400, "INVALID_PACKAGE_UPLOAD")
		}
		return
	}
	d.mu.Lock()
	live := d.identity.generation == generation && d.identity.credential != nil && d.identity.credential.Token == record.Token
	d.mu.Unlock()
	if !live {
		desktopTransferError(w, 409, "CONNECTION_CHANGED")
		return
	}
	file, err := stageRoot.OpenRegular(filepath.Base(input.filename))
	if err != nil {
		desktopTransferError(w, 507, "TRANSFER_STORAGE_FULL")
		return
	}
	defer file.Close()
	if input.digest == "" {
		hash := sha256.New()
		if _, err := io.Copy(hash, file); err != nil {
			desktopTransferError(w, 507, "TRANSFER_STORAGE_FULL")
			return
		}
		input.digest = hex.EncodeToString(hash.Sum(nil))
		_, _ = file.Seek(0, io.SeekStart)
	}
	headers := make(http.Header)
	headers.Set("Accept", "application/json")
	headers.Set("Content-Type", "application/zip")
	headers.Set("X-Piwork-Sha256", input.digest)
	headers.Set("X-Piwork-Package-Source", input.source)
	headers.Set("X-Piwork-Package-Name", url.PathEscape(input.name))
	response, err := api.Binary(ctx, "POST", "/api/v1/works/"+url.PathEscape(workID)+"/package-uploads", headers, file, input.bytes)
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
	if response.StatusCode != 201 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(response.StatusCode)
		_, _ = w.Write(raw)
		return
	}
	var uploaded struct {
		UploadID string `json:"uploadId"`
	}
	if json.Unmarshal(raw, &uploaded) != nil || uploaded.UploadID == "" {
		desktopTransferError(w, 502, "CORE_INVALID_RESPONSE")
		return
	}
	desktopJSON(w, 201, json.RawMessage(raw))
}
