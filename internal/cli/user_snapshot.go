package cli

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"piwork/internal/client"
	"piwork/internal/clientfs"
	"piwork/internal/workpackage"
)

const workPackageMIME = "application/vnd.piwork.work-package"

var sha256HeaderPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)

type snapshotCommand struct {
	kind, id, output, key, name string
	wait                        bool
}

func parseUserSnapshot(args []string) (snapshotCommand, error) {
	invalid := errors.New("invalid Work snapshot command; run piwork-cli --help")
	if len(args) < 2 {
		return snapshotCommand{}, invalid
	}
	cmd := snapshotCommand{}
	var options []string
	switch args[0] {
	case "export":
		if !validCLIId(args[1]) {
			return cmd, invalid
		}
		cmd.kind = "export"
		cmd.id = args[1]
		cmd.output = args[1] + ".work"
		options = args[2:]
	case "snapshot":
		if len(args) < 3 || args[1] != "download" || !validCLIId(args[2]) {
			return cmd, invalid
		}
		cmd.kind = "download"
		cmd.id = args[2]
		options = args[3:]
	case "import":
		if !validCLIId(args[1]) {
			return cmd, invalid
		}
		cmd.kind = "import"
		cmd.id = args[1]
		options = args[2:]
	default:
		return cmd, invalid
	}
	seen := map[string]bool{}
	for i := 0; i < len(options); i++ {
		flag := options[i]
		if seen[flag] {
			return cmd, invalid
		}
		if cmd.kind == "import" && flag == "--wait" {
			seen[flag] = true
			cmd.wait = true
			continue
		}
		if (flag != "--output" && !(cmd.kind == "export" && flag == "--idempotency-key") && !(cmd.kind == "import" && (flag == "--name" || flag == "--idempotency-key"))) || (flag == "--output" && cmd.kind == "import") ||
			i+1 >= len(options) || options[i+1] == "" || strings.HasPrefix(options[i+1], "--") {
			return cmd, invalid
		}
		seen[flag] = true
		i++
		if flag == "--output" {
			cmd.output = options[i]
		} else if flag == "--name" {
			cmd.name = options[i]
		} else {
			cmd.key = options[i]
		}
	}
	if cmd.kind != "import" && (cmd.output == "" || cmd.output == "-") {
		return cmd, invalid
	}
	return cmd, nil
}

func validateUserSnapshot(args []string) error { _, err := parseUserSnapshot(args); return err }

type snapshotMetadata struct {
	WorkID      string  `json:"workId"`
	SnapshotID  string  `json:"snapshotId"`
	OperationID string  `json:"operationId"`
	State       string  `json:"state"`
	Digest      *string `json:"digest"`
	Size        *int64  `json:"size"`
}

func runUserSnapshot(ctx context.Context, api *client.Client, args []string, stderr io.Writer) (any, error) {
	return runUserSnapshotWithin(ctx, api, args, stderr, 120*time.Second)
}

func runUserSnapshotWithin(ctx context.Context, api *client.Client, args []string, stderr io.Writer, observationTimeout time.Duration) (any, error) {
	command, err := parseUserSnapshot(args)
	if err != nil {
		return nil, err
	}
	if command.kind == "import" {
		return importUserSnapshot(ctx, api, command, stderr)
	}
	if err := checkSnapshotDestination(command.output); err != nil {
		return nil, err
	}
	var metadata snapshotMetadata
	if command.kind == "export" {
		key := command.key
		if key == "" {
			key, err = randomKey()
			if err != nil {
				return nil, err
			}
		}
		var accepted map[string]any
		path := "/api/v1/works/" + url.PathEscape(command.id) + "/exports"
		if err := api.Request(ctx, "POST", path, map[string]string{"idempotencyKey": key}, &accepted); err != nil {
			return nil, err
		}
		if observed, err := observeUserOperationWithin(ctx, api, accepted, stderr, observationTimeout); err != nil {
			if envelope, ok := observed.(map[string]any); ok {
				envelope["snapshotId"] = accepted["snapshotId"]
			}
			return observed, err
		}
		id, _ := accepted["snapshotId"].(string)
		if id == "" {
			return nil, errors.New("Core did not return a snapshot ID")
		}
		command.id = id
	}
	if err := api.Request(ctx, "GET", "/api/v1/work-snapshots/"+url.PathEscape(command.id), nil, &metadata); err != nil {
		return nil, err
	}
	if metadata.State != "succeeded" || metadata.Digest == nil || metadata.Size == nil || !sha256HeaderPattern.MatchString(*metadata.Digest) || *metadata.Size <= 0 {
		return nil, errors.New("snapshot is not ready for download")
	}
	transferCtx, stop := context.WithTimeout(ctx, 30*time.Minute)
	defer stop()
	path, err := saveSnapshotDownload(transferCtx, api, command.id, command.output, *metadata.Digest, *metadata.Size)
	if err != nil {
		return nil, err
	}
	return map[string]any{"workId": metadata.WorkID, "snapshotId": command.id, "operationId": metadata.OperationID,
		"path": path, "digest": *metadata.Digest, "size": *metadata.Size}, nil
}

func openSnapshotDirectory(output string) (*clientfs.Directory, string, string, error) {
	if !clientfs.ValidFileName(filepath.Base(output)) {
		return nil, "", "", errors.New("unsafe output filename")
	}
	target, err := filepath.Abs(output)
	if err != nil {
		return nil, "", "", err
	}
	directory, err := clientfs.OpenDirectory(filepath.Dir(output))
	if err != nil {
		return nil, "", "", errors.New("output parent must be a real directory without links")
	}
	name := filepath.Base(target)
	file, err := directory.OpenRegular(name)
	if err == nil {
		file.Close()
		directory.Close()
		return nil, "", "", errors.New("output already exists")
	}
	if !errors.Is(err, os.ErrNotExist) {
		directory.Close()
		return nil, "", "", err
	}
	return directory, name, target, nil
}

func checkSnapshotDestination(output string) error {
	directory, _, _, err := openSnapshotDirectory(output)
	if err == nil {
		directory.Close()
	}
	return err
}

func saveSnapshotDownload(ctx context.Context, api *client.Client, snapshotID, output, digest string, size int64) (string, error) {
	directory, name, target, err := openSnapshotDirectory(output)
	if err != nil {
		return "", err
	}
	defer directory.Close()
	key, err := randomKey()
	if err != nil {
		return "", err
	}
	temporary := ".piwork-" + key + ".tmp"
	file, err := directory.CreatePrivateExclusive(temporary)
	if err != nil {
		return "", err
	}
	defer func() { file.Close(); _ = directory.Remove(temporary) }()
	headers := make(http.Header)
	headers.Set("Accept", workPackageMIME)
	response, err := api.Binary(ctx, "GET", "/api/v1/work-snapshots/"+url.PathEscape(snapshotID)+"/content", headers, nil, 0)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return "", &client.APIError{Status: response.StatusCode, Code: "SNAPSHOT_DOWNLOAD_FAILED", Text: "Core snapshot content is unavailable"}
	}
	length, err := strconv.ParseInt(response.Header.Get("Content-Length"), 10, 64)
	if err != nil || length != size || response.Header.Get("Content-Type") != workPackageMIME || response.Header.Get("X-Piwork-Sha256") != digest || size > workpackage.DefaultLimits.PackageBytes {
		return "", errors.New("snapshot download metadata does not match")
	}
	hash := sha256.New()
	n, err := io.CopyBuffer(io.MultiWriter(file, hash), io.LimitReader(response.Body, size+1), make([]byte, 64<<10))
	if err != nil || n != size || hex.EncodeToString(hash.Sum(nil)) != digest {
		return "", errors.New("snapshot download digest mismatch")
	}
	if err := file.Sync(); err != nil {
		return "", err
	}
	inspection, err := workpackage.Inspect(ctx, file, size)
	if err != nil || inspection.Digest != digest || inspection.Size != size {
		return "", errors.New("downloaded Work package verification failed")
	}
	if err := file.Close(); err != nil {
		return "", err
	}
	if err := directory.PublishNoReplace(ctx, temporary, name); err != nil {
		return "", err
	}
	return target, nil
}

func snapshotWarning(stderr io.Writer) {
	fmt.Fprintln(stderr, "Warning: a Work package contains private Work content and may include credentials.")
}

func importUserSnapshot(ctx context.Context, api *client.Client, command snapshotCommand, stderr io.Writer) (any, error) {
	path, err := filepath.Abs(command.id)
	if err != nil {
		return nil, err
	}
	directory, err := clientfs.OpenDirectory(filepath.Dir(command.id))
	if err != nil {
		return nil, errors.New("unable to open Work package")
	}
	defer directory.Close()
	file, err := directory.OpenRegular(filepath.Base(path))
	if err != nil {
		return nil, errors.New("unable to open Work package")
	}
	defer file.Close()
	before, err := clientfs.Identity(file)
	if err != nil {
		return nil, errors.New("input must be a regular file")
	}
	stable := func() bool {
		after, err := clientfs.Identity(file)
		if err != nil || after != before {
			return false
		}
		current, err := directory.OpenRegular(filepath.Base(path))
		if err != nil {
			return false
		}
		defer current.Close()
		identity, err := clientfs.Identity(current)
		return err == nil && identity == before
	}
	inspection, err := workpackage.Inspect(ctx, file, before.Size)
	if err != nil {
		return nil, err
	}
	if !stable() {
		return nil, errors.New("input package changed during validation")
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return nil, err
	}
	headers := make(http.Header)
	headers.Set("Accept", "application/json")
	headers.Set("Content-Type", workPackageMIME)
	headers.Set("X-Piwork-Sha256", inspection.Digest)
	transferCtx, stop := context.WithTimeout(ctx, 30*time.Minute)
	defer stop()
	response, err := api.Binary(transferCtx, "POST", "/api/v1/work-packages", headers, file, before.Size)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, &client.APIError{Status: response.StatusCode, Code: "PACKAGE_UPLOAD_FAILED", Text: "Core rejected Work package upload"}
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, (1<<20)+1))
	if err != nil || len(raw) > 1<<20 {
		return nil, errors.New("Core returned an invalid upload response")
	}
	var uploaded struct {
		PackageID, Digest string
		Size              int64
	}
	if json.Unmarshal(raw, &uploaded) != nil || uploaded.PackageID == "" || uploaded.Digest != inspection.Digest || uploaded.Size != before.Size {
		return nil, errors.New("Core package identity changed")
	}
	if !stable() {
		return nil, errors.New("input package changed during upload")
	}
	key := command.key
	if key == "" {
		key, err = randomKey()
		if err != nil {
			return nil, err
		}
	}
	input := map[string]string{"packageId": uploaded.PackageID, "idempotencyKey": key}
	if command.name != "" {
		input["name"] = command.name
	}
	var accepted map[string]any
	if err := api.Request(ctx, "POST", "/api/v1/work-imports", input, &accepted); err != nil {
		return nil, err
	}
	if !command.wait {
		return accepted, nil
	}
	result, err := observeUserOperation(ctx, api, accepted, stderr)
	if value, ok := result.(map[string]any); ok {
		value["name"] = accepted["name"]
	}
	return result, err
}
