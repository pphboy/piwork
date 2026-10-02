package cli

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"time"

	"golang.org/x/sys/unix"
	"piwork/internal/client"
	"piwork/internal/pipackage"
)

func resolveUserPackageSource(ctx context.Context, api *client.Client, workID, argument string) (map[string]any, error) {
	parsed, err := pipackage.ParseSource(argument)
	if err != nil {
		return nil, err
	}
	if parsed.Kind == "npm" || parsed.Kind == "git" {
		return map[string]any{"kind": parsed.Kind, "spec": parsed.Spec}, nil
	}
	scratch, err := os.MkdirTemp("", "piwork-pi-package-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(scratch)
	staged := filepath.Join(scratch, "source.zip")
	var digest string
	var size int64
	if parsed.Kind == "local" {
		tree, err := pipackage.OpenTree(ctx, parsed.Path)
		if err != nil {
			return nil, err
		}
		defer tree.Close()
		packed, err := pipackage.PackArchive(ctx, tree, staged)
		if err != nil {
			return nil, err
		}
		digest, size = packed.Digest, packed.Bytes
	} else {
		fd, err := unix.Open(parsed.Path, unix.O_RDONLY|unix.O_NOFOLLOW|unix.O_NONBLOCK|unix.O_CLOEXEC, 0)
		if err != nil {
			return nil, pipackage.ErrSource
		}
		input := os.NewFile(uintptr(fd), "package-source")
		defer input.Close()
		info, err := input.Stat()
		if err != nil || !info.Mode().IsRegular() {
			return nil, pipackage.ErrSource
		}
		if info.Size() > pipackage.CompressedBytes {
			return nil, pipackage.ErrLimit
		}
		output, err := os.OpenFile(staged, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err != nil {
			return nil, err
		}
		hash := sha256.New()
		n, copyErr := io.CopyBuffer(io.MultiWriter(output, hash), io.LimitReader(input, pipackage.CompressedBytes+1), make([]byte, 64<<10))
		syncErr := output.Sync()
		closeErr := output.Close()
		if err := errors.Join(copyErr, syncErr, closeErr); err != nil {
			return nil, err
		}
		if n > pipackage.CompressedBytes {
			return nil, pipackage.ErrLimit
		}
		size, digest = n, hex.EncodeToString(hash.Sum(nil))
		archive, err := pipackage.OpenArchive(ctx, staged)
		if err != nil {
			return nil, err
		}
		archive.Close()
	}
	if size <= 0 || digest == "" {
		return nil, pipackage.ErrSource
	}
	file, err := os.Open(staged)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	headers := make(http.Header)
	headers.Set("Accept", "application/json")
	headers.Set("Content-Type", "application/zip")
	headers.Set("X-Piwork-Sha256", digest)
	headers.Set("X-Piwork-Package-Source", parsed.Kind)
	headers.Set("X-Piwork-Package-Name", url.PathEscape(parsed.DisplayName))
	transferCtx, stop := context.WithTimeout(ctx, 30*time.Minute)
	defer stop()
	response, err := api.Binary(transferCtx, "POST", "/api/v1/works/"+url.PathEscape(workID)+"/package-uploads", headers, file, size)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, &client.APIError{Status: response.StatusCode, Code: "PACKAGE_UPLOAD_FAILED", Text: "Core rejected Pi package upload"}
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, (1<<20)+1))
	if err != nil || len(raw) > 1<<20 {
		return nil, errors.New("Core returned an invalid package upload response")
	}
	var uploaded struct {
		UploadID string `json:"uploadId"`
	}
	if json.Unmarshal(raw, &uploaded) != nil || uploaded.UploadID == "" {
		return nil, errors.New("Core did not return a package upload ID")
	}
	return map[string]any{"kind": "upload", "uploadId": uploaded.UploadID}, nil
}
