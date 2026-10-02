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
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"

	"piwork/internal/client"
	"piwork/internal/pipackage"
)

type consolePackageInput struct {
	filename, name, source string
	bytes                  int64
	digest                 string
}

var errConsoleUploadMedia = errors.New("UNSUPPORTED_MEDIA_TYPE")

func consoleDisplayName(value string) bool {
	if value == "" || value == "." || value == ".." || len(value) > 255 || !utf8.ValidString(value) {
		return false
	}
	for _, letter := range value {
		if letter < 0x20 || letter == 0x7f || letter == '\\' || letter == '/' {
			return false
		}
	}
	return true
}

func consoleUploadPath(encoded string) (string, bool) {
	value, err := url.PathUnescape(encoded)
	if err != nil || value == "" || !utf8.ValidString(value) || len(value) > pipackage.MaxPathBytes || strings.HasPrefix(value, "/") || strings.Contains(value, "\\") {
		return "", false
	}
	if len(value) >= 2 && value[1] == ':' && (value[0] >= 'A' && value[0] <= 'Z' || value[0] >= 'a' && value[0] <= 'z') {
		return "", false
	}
	parts := strings.Split(value, "/")
	if len(parts) > pipackage.MaxDepth {
		return "", false
	}
	for _, part := range parts {
		if part == "" || part == "." || part == ".." || len(part) > 255 {
			return "", false
		}
		for _, letter := range part {
			if letter < 0x20 || letter == 0x7f {
				return "", false
			}
		}
	}
	return value, true
}

func (c *nativeConsole) uploadPackage(w http.ResponseWriter, r *http.Request, sessionID string, session consoleSession, kind string) {
	c.mu.Lock()
	if c.uploads >= 2 {
		c.mu.Unlock()
		consoleFailure(w, 429, "CONSOLE_UPLOAD_BUSY")
		return
	}
	c.uploads++
	c.mu.Unlock()
	defer func() { c.mu.Lock(); c.uploads--; c.mu.Unlock() }()
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Minute)
	defer cancel()
	staging := filepath.Join(c.options.dataDir, "staging")
	if err := os.MkdirAll(staging, 0700); err != nil {
		consoleFailure(w, 503, "CONSOLE_UPLOAD_UNAVAILABLE")
		return
	}
	stage, err := os.MkdirTemp(staging, "input-")
	if err != nil {
		consoleFailure(w, 503, "CONSOLE_UPLOAD_UNAVAILABLE")
		return
	}
	defer os.RemoveAll(stage)
	var input consolePackageInput
	if kind == "zip" {
		input, err = receiveConsoleZip(ctx, w, r, stage)
	} else {
		input, err = receiveConsoleDirectory(ctx, w, r, stage)
	}
	if err != nil {
		var packageErr *pipackage.InputError
		switch {
		case errors.Is(err, errConsoleUploadMedia):
			consoleFailure(w, 415, "UNSUPPORTED_MEDIA_TYPE")
		case errors.As(err, &packageErr):
			status := 400
			if packageErr.Code == "PI_PACKAGE_LIMIT_EXCEEDED" {
				status = 413
			}
			consoleFailure(w, status, packageErr.Code)
		case errors.Is(err, context.DeadlineExceeded) || errors.Is(err, os.ErrDeadlineExceeded):
			consoleFailure(w, 408, "CONSOLE_UPLOAD_TIMEOUT")
		default:
			consoleFailure(w, 400, "PI_PACKAGE_INVALID_SOURCE")
		}
		return
	}
	currentID, current, live, sessionErr := c.activeSession(r)
	if sessionErr != nil {
		consoleFailure(w, 502, "CORE_UNAVAILABLE")
		return
	}
	if !live || currentID != sessionID || current.token != session.token {
		consoleFailure(w, 401, "AUTHENTICATION_REQUIRED")
		return
	}
	file, err := os.Open(input.filename)
	if err != nil {
		consoleFailure(w, 503, "CONSOLE_UPLOAD_UNAVAILABLE")
		return
	}
	defer file.Close()
	api, _ := client.New(c.options.coreURL, session.token)
	headers := make(http.Header)
	headers.Set("Accept", "application/json")
	headers.Set("Content-Type", "application/zip")
	headers.Set("X-Piwork-Sha256", input.digest)
	headers.Set("X-Piwork-Package-Source", input.source)
	headers.Set("X-Piwork-Package-Name", url.PathEscape(input.name))
	response, err := api.Binary(ctx, "POST", "/api/v1/admin/package-uploads", headers, file, input.bytes)
	if err != nil {
		consoleFailure(w, 502, "CORE_UNAVAILABLE")
		return
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, (1<<20)+1))
	if err != nil || len(raw) > 1<<20 || !json.Valid(raw) {
		consoleFailure(w, 502, "CORE_INVALID_RESPONSE")
		return
	}
	if response.StatusCode != 201 {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(response.StatusCode)
		_, _ = w.Write(raw)
		return
	}
	var result struct {
		UploadID  string `json:"uploadId"`
		ExpiresAt string `json:"expiresAt"`
	}
	if json.Unmarshal(raw, &result) != nil || result.UploadID == "" || result.ExpiresAt == "" {
		consoleFailure(w, 502, "CORE_INVALID_RESPONSE")
		return
	}
	consoleJSON(w, 201, result)
}

func receiveConsoleZip(ctx context.Context, w http.ResponseWriter, r *http.Request, stage string) (consolePackageInput, error) {
	if r.Header.Get("Content-Type") != "application/zip" {
		return consolePackageInput{}, errConsoleUploadMedia
	}
	name, err := url.PathUnescape(r.Header.Get("X-Piwork-Package-Name"))
	if err != nil || !consoleDisplayName(name) {
		return consolePackageInput{}, pipackage.ErrSource
	}
	if r.ContentLength > pipackage.CompressedBytes {
		return consolePackageInput{}, pipackage.ErrLimit
	}
	filename := filepath.Join(stage, "package.zip")
	file, err := os.OpenFile(filename, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return consolePackageInput{}, err
	}
	hash := sha256.New()
	reader := io.LimitReader(r.Body, pipackage.CompressedBytes+1)
	deadline := http.NewResponseController(w)
	buffer := make([]byte, 64<<10)
	var total int64
	for {
		if err := ctx.Err(); err != nil {
			file.Close()
			return consolePackageInput{}, err
		}
		_ = deadline.SetReadDeadline(time.Now().Add(time.Minute))
		n, readErr := reader.Read(buffer)
		if n > 0 {
			total += int64(n)
			if total > pipackage.CompressedBytes {
				file.Close()
				return consolePackageInput{}, pipackage.ErrLimit
			}
			if _, err := file.Write(buffer[:n]); err != nil {
				file.Close()
				return consolePackageInput{}, err
			}
			_, _ = hash.Write(buffer[:n])
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			file.Close()
			return consolePackageInput{}, readErr
		}
	}
	if err := file.Sync(); err != nil {
		file.Close()
		return consolePackageInput{}, err
	}
	if err := file.Close(); err != nil {
		return consolePackageInput{}, err
	}
	archive, err := pipackage.OpenArchive(ctx, filename)
	if err != nil {
		return consolePackageInput{}, err
	}
	archive.Close()
	return consolePackageInput{filename: filename, name: name, source: "zip", bytes: total, digest: hex.EncodeToString(hash.Sum(nil))}, nil
}

func receiveConsoleDirectory(ctx context.Context, w http.ResponseWriter, r *http.Request, stage string) (consolePackageInput, error) {
	mediaType, params, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mediaType != "multipart/form-data" || params["boundary"] == "" || len(params["boundary"]) > 70 {
		return consolePackageInput{}, errConsoleUploadMedia
	}
	if r.ContentLength > pipackage.RestoredBytes+(64<<20) {
		return consolePackageInput{}, pipackage.ErrLimit
	}
	reader := multipart.NewReader(io.LimitReader(r.Body, pipackage.RestoredBytes+(64<<20)+1), params["boundary"])
	root := filepath.Join(stage, "tree")
	if err := os.Mkdir(root, 0700); err != nil {
		return consolePackageInput{}, err
	}
	seen := map[string]bool{}
	var name string
	var entries int
	var content int64
	deadline := http.NewResponseController(w)
	for {
		if err := ctx.Err(); err != nil {
			return consolePackageInput{}, err
		}
		_ = deadline.SetReadDeadline(time.Now().Add(time.Minute))
		part, err := reader.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			return consolePackageInput{}, err
		}
		if name == "" {
			if part.FormName() != "directoryName" || part.FileName() != "" {
				part.Close()
				return consolePackageInput{}, pipackage.ErrSource
			}
			raw, err := io.ReadAll(io.LimitReader(part, 256))
			part.Close()
			if err != nil || len(raw) > 255 || !consoleDisplayName(string(raw)) {
				return consolePackageInput{}, pipackage.ErrSource
			}
			name = string(raw)
			continue
		}
		if part.FormName() != "files" || part.FileName() == "" {
			part.Close()
			return consolePackageInput{}, pipackage.ErrSource
		}
		path, ok := consoleUploadPath(part.FileName())
		if !ok || seen[path] {
			part.Close()
			return consolePackageInput{}, pipackage.ErrSource
		}
		seen[path] = true
		entries++
		if entries > pipackage.MaxEntries {
			part.Close()
			return consolePackageInput{}, pipackage.ErrLimit
		}
		absolute := filepath.Join(root, filepath.FromSlash(path))
		if err := os.MkdirAll(filepath.Dir(absolute), 0700); err != nil {
			part.Close()
			return consolePackageInput{}, err
		}
		file, err := os.OpenFile(absolute, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err != nil {
			part.Close()
			return consolePackageInput{}, pipackage.ErrSource
		}
		var fileSize int64
		buffer := make([]byte, 64<<10)
		for {
			_ = deadline.SetReadDeadline(time.Now().Add(time.Minute))
			n, readErr := part.Read(buffer)
			if n > 0 {
				fileSize += int64(n)
				content += int64(n)
				if fileSize > pipackage.FileBytes || content > pipackage.RestoredBytes {
					file.Close()
					part.Close()
					return consolePackageInput{}, pipackage.ErrLimit
				}
				if _, err := file.Write(buffer[:n]); err != nil {
					file.Close()
					part.Close()
					return consolePackageInput{}, err
				}
			}
			if readErr == io.EOF {
				break
			}
			if readErr != nil {
				file.Close()
				part.Close()
				return consolePackageInput{}, readErr
			}
		}
		if err := file.Close(); err != nil {
			part.Close()
			return consolePackageInput{}, err
		}
		part.Close()
	}
	if name == "" || !seen["package.json"] {
		return consolePackageInput{}, pipackage.ErrSource
	}
	tree, err := pipackage.OpenTree(ctx, root)
	if err != nil {
		return consolePackageInput{}, err
	}
	defer tree.Close()
	filename := filepath.Join(stage, "package.zip")
	packed, err := pipackage.PackArchive(ctx, tree, filename)
	if err != nil {
		return consolePackageInput{}, err
	}
	return consolePackageInput{filename: filename, name: name, source: "local", bytes: packed.Bytes, digest: packed.Digest}, nil
}
