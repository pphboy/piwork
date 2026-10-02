package coreoperator

import (
	"bytes"
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
	"time"

	"github.com/google/uuid"
	"golang.org/x/sys/unix"
	"piwork/internal/contracts"
	"piwork/internal/pipackage"
)

func runPackageMutation(ctx context.Context, c *connection, v invocation, stdout, stderr io.Writer) int {
	source, err := resolvePackageSource(ctx, c, v.source)
	if err != nil {
		return failure(err, stderr)
	}
	body := map[string]any{"source": source, "idempotencyKey": uuid.NewString()}
	path := "/control/packages"
	if v.command == "packages-install" {
		body["addToDefaults"] = v.has("--default")
	} else {
		path += "/" + url.PathEscape(v.id) + "/update"
	}
	accepted, err := c.request(ctx, "POST", path, body)
	if err != nil {
		return failure(err, stderr)
	}
	raw, err := json.Marshal(accepted)
	if err != nil {
		return failure(&transportError{}, stderr)
	}
	acceptance, err := contracts.Decode[contracts.PiPackageOperationAcceptance](bytes.NewReader(raw), "PiPackageOperationAcceptanceSchema", 64<<10)
	if err != nil || acceptance.Scope != "core" || string(acceptance.WorkId) != "null" {
		return failure(&transportError{}, stderr)
	}
	if !v.has("--wait") {
		return output(stdout, accepted, v.json)
	}
	return finishPackageWait(ctx, c, acceptance, v.json, v.has("--verbose"), stdout, stderr)
}

func resolvePackageSource(ctx context.Context, c *connection, source pipackage.Source) (map[string]any, error) {
	if source.Kind == "npm" || source.Kind == "git" {
		return map[string]any{"kind": source.Kind, "spec": source.Spec}, nil
	}
	path := source.Path
	if source.Kind == "local" {
		tree, err := pipackage.OpenTree(ctx, path)
		if err != nil {
			return nil, usage("local package directory is unavailable or unsafe")
		}
		defer tree.Close()
		temp, err := os.MkdirTemp("", "piwork-package-upload-")
		if err != nil {
			return nil, usage("could not prepare local package upload")
		}
		defer os.RemoveAll(temp)
		path = filepath.Join(temp, "source.zip")
		if _, err := pipackage.PackArchive(ctx, tree, path); err != nil {
			return nil, usage("local package cannot be safely archived within package limits")
		}
	}
	file, err := os.OpenFile(path, os.O_RDONLY|unix.O_NOFOLLOW|unix.O_NONBLOCK, 0)
	if err != nil {
		return nil, usage("package ZIP is unavailable")
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() <= 0 || info.Size() > pipackage.CompressedBytes {
		return nil, usage("package ZIP is not a regular file within package limits")
	}
	archive, err := pipackage.OpenArchiveFile(ctx, file)
	if err != nil {
		return nil, usage("package ZIP is unsafe or invalid")
	}
	archive.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, io.LimitReader(file, pipackage.CompressedBytes+1)); err != nil {
		return nil, usage("could not read package ZIP")
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return nil, usage("could not read package ZIP")
	}
	request, err := http.NewRequestWithContext(ctx, "POST", c.base+"/control/package-uploads", file)
	if err != nil {
		return nil, usage("invalid package upload request")
	}
	request.ContentLength = info.Size()
	request.Header.Set("Authorization", "Operator "+c.token)
	request.Header.Set("Content-Type", "application/zip")
	request.Header.Set("X-Piwork-Sha256", hex.EncodeToString(hash.Sum(nil)))
	request.Header.Set("X-Piwork-Package-Source", source.Kind)
	request.Header.Set("X-Piwork-Package-Name", url.PathEscape(source.DisplayName))
	// Transfers have server-enforced size/progress/deadline bounds. The normal
	// short control-request timeout must not cut off a valid large ZIP upload.
	uploadClient := *c.client
	uploadClient.Timeout = 0
	response, err := uploadClient.Do(request)
	if err != nil {
		return nil, &transportError{cause: err}
	}
	defer response.Body.Close()
	value, err := c.readResponse(response)
	if err != nil {
		return nil, err
	}
	raw, _ := json.Marshal(value)
	view, err := contracts.Decode[contracts.PiPackageUploadResult](bytes.NewReader(raw), "PiPackageUploadResultSchema", 64<<10)
	if err != nil {
		return nil, &transportError{}
	}
	return map[string]any{"kind": "upload", "uploadId": view.UploadId}, nil
}

type packageWaitClock struct {
	now   func() time.Time
	pause func(context.Context, time.Duration) error
}

func finishPackageWait(ctx context.Context, c *connection, accepted contracts.PiPackageOperationAcceptance, compact, verbose bool, stdout, stderr io.Writer) int {
	clock := packageWaitClock{now: time.Now, pause: func(ctx context.Context, delay time.Duration) error {
		timer := time.NewTimer(delay)
		defer timer.Stop()
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-timer.C:
			return nil
		}
	}}
	return waitPackageOperation(ctx, c, accepted, compact, verbose, stdout, stderr, clock)
}

func waitPackageOperation(ctx context.Context, c *connection, accepted contracts.PiPackageOperationAcceptance, compact, verbose bool, stdout, stderr io.Writer, clock packageWaitClock) int {
	id := string(accepted.OperationId)
	started, lastHeartbeat := clock.now(), clock.now()
	lastPhase := ""
	retry := 250 * time.Millisecond
	observingFailure := false
	progress := func(message string) {
		if verbose {
			fmt.Fprintf(stderr, "Package Operation %s: %s; elapsed %.0fs\n", id, message, clock.now().Sub(started).Seconds())
		}
	}
	progress("accepted; waiting")
	for {
		if ctx.Err() != nil {
			return packageWaiting(stdout, stderr, accepted, compact, true)
		}
		query, cancel := context.WithTimeout(ctx, 30*time.Second)
		value, err := c.request(query, "GET", "/control/operations/"+url.PathEscape(id), nil)
		cancel()
		if err != nil {
			if ctx.Err() != nil {
				return packageWaiting(stdout, stderr, accepted, compact, true)
			}
			var network *transportError
			var api *apiError
			temporary := errors.As(err, &network) || errors.As(err, &api) && (api.status == 502 || api.status == 503 || api.status == 504)
			if !temporary {
				return packageWaiting(stdout, stderr, accepted, compact, false)
			}
			progress(fmt.Sprintf("observation retry in %dms", retry.Milliseconds()))
			observingFailure = true
			if err := clock.pause(ctx, retry); err != nil {
				return packageWaiting(stdout, stderr, accepted, compact, true)
			}
			retry = min(retry*2, 5*time.Second)
			continue
		}
		operation, ok := value.(map[string]any)
		if !ok || operation["operationId"] != id || operation["workId"] != nil {
			return packageWaiting(stdout, stderr, accepted, compact, false)
		}
		if observingFailure {
			progress("observation recovered")
			observingFailure = false
		}
		retry = 250 * time.Millisecond
		phase, _ := operation["packagePhase"].(string)
		if !validPackagePhase(phase) {
			return packageWaiting(stdout, stderr, accepted, compact, false)
		}
		if phase != lastPhase {
			progress("phase " + phase)
			lastPhase = phase
			lastHeartbeat = clock.now()
		} else if clock.now().Sub(lastHeartbeat) >= 30*time.Second {
			progress("still " + phase)
			lastHeartbeat = clock.now()
		}
		state, _ := operation["state"].(string)
		if state == "succeeded" || state == "failed" || state == "superseded" {
			if state != "succeeded" {
				diagnostic, _ := operation["error"].(map[string]any)
				stage, _ := diagnostic["stage"].(string)
				code, _ := diagnostic["code"].(string)
				if !validPackagePhase(stage) {
					stage = "prepare"
				}
				if !safePackageErrorCode.MatchString(code) {
					code = "PI_PACKAGE_PREPARATION_FAILED"
				}
				if state == "failed" || operation["error"] != nil {
					operation["error"] = map[string]string{"stage": stage, "code": code}
				}
				progress("terminal stage=" + stage + " code=" + code)
			}
			if code := output(stdout, operation, compact); code != 0 {
				return code
			}
			if state != "succeeded" {
				fmt.Fprintf(stderr, "piwork-serve: Package Operation %s %s; inspect: piwork-serve operation show %s\n", id, state, id)
				return 6
			}
			return 0
		}
		if state != "pending" && state != "running" {
			return packageWaiting(stdout, stderr, accepted, compact, false)
		}
		if err := clock.pause(ctx, 250*time.Millisecond); err != nil {
			return packageWaiting(stdout, stderr, accepted, compact, true)
		}
	}
}

var safePackageErrorCode = regexp.MustCompile(`^[A-Z][A-Z0-9_]{0,63}$`)

func validPackagePhase(phase string) bool {
	switch phase {
	case "queued", "source", "prepare", "validate", "publish", "cleanup-pending", "succeeded", "failed", "superseded":
		return true
	}
	return false
}

func packageWaiting(stdout, stderr io.Writer, accepted contracts.PiPackageOperationAcceptance, compact, interrupted bool) int {
	code, exit := "OPERATION_OBSERVATION_UNAVAILABLE", 5
	if interrupted {
		code, exit = "OPERATION_WAIT_INTERRUPTED", 130
	}
	raw, _ := json.Marshal(accepted)
	var view map[string]any
	json.Unmarshal(raw, &view)
	view["state"], view["result"], view["error"] = "waiting", nil, map[string]string{"code": code, "message": "The package Operation remains queryable."}
	if written := output(stdout, view, compact); written != 0 {
		return written
	}
	fmt.Fprintf(stderr, "piwork-serve: %s; inspect: piwork-serve operation show %s\n", code, accepted.OperationId)
	return exit
}
