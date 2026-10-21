package cli

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"piwork/internal/client"
	"piwork/internal/clientfs"
)

type logExportLocalError struct{ err error }
type logExportVerificationError struct{ err error }

func (e *logExportVerificationError) Error() string { return e.err.Error() }
func (e *logExportVerificationError) Unwrap() error { return e.err }

func (e *logExportLocalError) Error() string { return e.err.Error() }
func (e *logExportLocalError) Unwrap() error { return e.err }

func logLocalError(err error) error {
	if err == nil {
		return nil
	}
	return &logExportLocalError{err: err}
}

type logsCommand struct {
	kind   string
	id     string
	output string
	key    string
}

func parseUserLogs(args []string) (logsCommand, error) {
	var command logsCommand
	if len(args) == 0 {
		return command, errors.New("logs requires export, show or download")
	}
	command.kind = args[0]
	seen := map[string]bool{}
	positional := []string{}
	for index := 1; index < len(args); index++ {
		value := args[index]
		if strings.HasPrefix(value, "--") {
			name, inline, hasInline := strings.Cut(value, "=")
			if name != "--output" && name != "--idempotency-key" || seen[name] {
				return command, errors.New("invalid or repeated logs option")
			}
			seen[name] = true
			if !hasInline {
				index++
				if index >= len(args) {
					return command, errors.New("logs option requires a value")
				}
				inline = args[index]
			}
			if inline == "" || inline == "-" || strings.HasPrefix(inline, "--") {
				return command, errors.New("logs option requires a safe value")
			}
			if name == "--output" {
				command.output = inline
			} else {
				if len(inline) > 256 {
					return command, errors.New("idempotency key is too long")
				}
				command.key = inline
			}
			continue
		}
		positional = append(positional, value)
	}
	switch command.kind {
	case "export":
		if len(positional) != 0 || command.id != "" {
			return command, errors.New("logs export accepts only --output and --idempotency-key")
		}
	case "show":
		if len(positional) != 1 || seen["--output"] || seen["--idempotency-key"] {
			return command, errors.New("logs show requires one export ID")
		}
		command.id = positional[0]
	case "download":
		if len(positional) != 1 || !seen["--output"] || seen["--idempotency-key"] {
			return command, errors.New("logs download requires an export ID and --output")
		}
		command.id = positional[0]
	default:
		return command, errors.New("invalid logs command")
	}
	if command.id != "" && !strings.HasPrefix(command.id, "log-export-") {
		return command, errors.New("invalid export ID")
	}
	return command, nil
}

func runUserLogs(ctx context.Context, api *client.Client, args []string, stderr io.Writer) (any, error) {
	command, err := parseUserLogs(args)
	if err != nil {
		return nil, err
	}
	if command.kind == "show" {
		return fetchLogExport(ctx, api, command.id)
	}
	output := command.output
	cutoff := ""
	if command.kind == "export" {
		if output == "" {
			key, keyErr := randomKey()
			if keyErr != nil {
				return nil, keyErr
			}
			output = "piwork-logs-" + key + ".zip"
		}
		if err := checkLogExportDestination(output); err != nil {
			return nil, logLocalError(err)
		}
		key := command.key
		if key == "" {
			key, err = randomKey()
			if err != nil {
				return nil, err
			}
		}
		var accepted struct {
			ExportID   string `json:"exportId"`
			CutoffTime string `json:"cutoffTime"`
			State      string `json:"state"`
			Reused     bool   `json:"reused"`
		}
		if err := api.Request(ctx, "POST", "/api/v1/log-exports", map[string]string{"idempotencyKey": key}, &accepted); err != nil {
			fmt.Fprintf(stderr, "Export creation was not confirmed. Retry with --idempotency-key %s\n", key)
			return nil, err
		}
		if accepted.ExportID == "" {
			return nil, errors.New("Core did not return an export ID")
		}
		command.id = accepted.ExportID
		cutoff = accepted.CutoffTime
		fmt.Fprintf(stderr, "Export ID: %s\nCutoff: %s\nCollecting logs...\n", accepted.ExportID, accepted.CutoffTime)
	}
	view, err := waitForLogExport(ctx, api, command.id, stderr)
	if err != nil {
		if view == nil && errors.Is(err, context.Canceled) && command.id != "" {
			view = map[string]any{"exportId": command.id, "cutoffTime": cutoff, "state": "waiting"}
		}
		return view, err
	}
	result, _ := view["result"].(map[string]any)
	digest, _ := result["digest"].(string)
	size, _ := result["size"].(float64)
	if digest == "" || size < 0 {
		return view, errors.New("Core did not return a verifiable export result")
	}
	complete, _ := view["complete"].(bool)
	warnings, _ := view["warningCount"].(float64)
	if complete == false {
		fmt.Fprintf(stderr, "Export is complete with %d gap(s); see the archive manifest.\n", int(warnings))
	}
	path, err := saveLogExport(ctx, api, command.id, output, digest, int64(size))
	if err != nil {
		var failure *client.APIError
		var verification *logExportVerificationError
		if errors.As(err, &failure) || errors.As(err, &verification) {
			return view, err
		}
		return view, logLocalError(err)
	}
	return map[string]any{
		"exportId": command.id, "cutoffTime": view["cutoffTime"], "path": path,
		"size": int64(size), "digest": digest, "complete": complete, "warningCount": int(warnings),
	}, nil
}

func fetchLogExport(ctx context.Context, api *client.Client, exportID string) (any, error) {
	var view map[string]any
	if err := api.Request(ctx, "GET", "/api/v1/log-exports/"+url.PathEscape(exportID), nil, &view); err != nil {
		return nil, err
	}
	return view, nil
}

func waitForLogExport(ctx context.Context, api *client.Client, exportID string, stderr io.Writer) (map[string]any, error) {
	delay := 500 * time.Millisecond
	lastState, lastProcessed := "", -1.0
	for {
		var view map[string]any
		err := api.Request(ctx, "GET", "/api/v1/log-exports/"+url.PathEscape(exportID), nil, &view)
		if err != nil {
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			if !transientLogExportError(err) {
				return nil, err
			}
			fmt.Fprintln(stderr, "Observation interrupted; retrying the same export.")
			if err := sleepLogExport(ctx, delay); err != nil {
				return nil, err
			}
			if delay < 5*time.Second {
				delay *= 2
				if delay > 5*time.Second {
					delay = 5 * time.Second
				}
			}
			continue
		}
		delay = 500 * time.Millisecond
		state, _ := view["state"].(string)
		progress, _ := view["progress"].(map[string]any)
		processed, _ := progress["processedSources"].(float64)
		total, _ := progress["totalSources"].(float64)
		if state != lastState || processed != lastProcessed {
			switch state {
			case "collecting":
				fmt.Fprintf(stderr, "Collecting logs (%d/%d sources)...\n", int(processed), int(total))
			case "packing":
				fmt.Fprintln(stderr, "Creating archive...")
			}
			lastState, lastProcessed = state, processed
		}
		switch state {
		case "ready":
			return view, nil
		case "failed", "interrupted":
			return view, &client.APIError{Status: 409, Code: "OPERATION_FAILED", Text: "log export " + state}
		case "expired":
			return view, &client.APIError{Status: 410, Code: "LOG_EXPORT_EXPIRED", Text: "log export has expired; run logs export again"}
		}
		if err := sleepLogExport(ctx, 500*time.Millisecond); err != nil {
			return nil, err
		}
	}
}

func transientLogExportError(err error) bool {
	var failure *client.APIError
	if !errors.As(err, &failure) {
		return false
	}
	return failure.Code == "NETWORK_ERROR" || failure.Status == 502 || failure.Status == 503 || failure.Status == 504
}

func sleepLogExport(ctx context.Context, delay time.Duration) error {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func checkLogExportDestination(output string) error {
	directory, _, _, err := openLogExportDirectory(output)
	if err == nil {
		directory.Close()
	}
	return err
}

func openLogExportDirectory(output string) (*clientfs.Directory, string, string, error) {
	if output == "" || output == "-" || !clientfs.ValidFileName(filepath.Base(output)) {
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

func saveLogExport(ctx context.Context, api *client.Client, exportID, output, digest string, size int64) (string, error) {
	directory, name, target, err := openLogExportDirectory(output)
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
	transferCtx, stop := context.WithTimeout(ctx, 30*time.Minute)
	defer stop()
	headers := make(http.Header)
	headers.Set("Accept", "application/zip")
	response, err := api.Binary(transferCtx, "GET", "/api/v1/log-exports/"+url.PathEscape(exportID)+"/content", headers, nil, 0)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return "", &client.APIError{Status: response.StatusCode, Code: "LOG_EXPORT_CONTENT_UNAVAILABLE", Text: "log export content is unavailable"}
	}
	length, err := strconv.ParseInt(response.Header.Get("Content-Length"), 10, 64)
	if err != nil || length != size || response.Header.Get("Content-Type") != "application/zip" || response.Header.Get("X-Piwork-SHA256") != digest || size < 0 || size > 1<<30 {
		return "", &logExportVerificationError{errors.New("log export download metadata does not match")}
	}
	hash := sha256.New()
	written, err := io.CopyBuffer(io.MultiWriter(file, hash), io.LimitReader(response.Body, size+1), make([]byte, 64<<10))
	if err != nil {
		return "", &client.APIError{Status: 503, Code: "NETWORK_ERROR", Text: "log export transfer was interrupted"}
	}
	if written != size || hex.EncodeToString(hash.Sum(nil)) != digest {
		return "", &logExportVerificationError{errors.New("log export download digest mismatch")}
	}
	if err := file.Sync(); err != nil {
		return "", err
	}
	if err := file.Close(); err != nil {
		return "", err
	}
	if err := directory.PublishNoReplace(transferCtx, temporary, name); err != nil {
		return "", err
	}
	return target, nil
}

func logExportText(value map[string]any, kind string) (string, bool) {
	if kind == "show" {
		var builder strings.Builder
		fmt.Fprintf(&builder, "Export ID: %v\nState: %v\nCutoff: %v\n", value["exportId"], value["state"], value["cutoffTime"])
		if progress, ok := value["progress"].(map[string]any); ok {
			fmt.Fprintf(&builder, "Progress: %v/%v sources\n", progress["processedSources"], progress["totalSources"])
		}
		if result, ok := value["result"].(map[string]any); ok {
			fmt.Fprintf(&builder, "Complete: %v\nFile: %v (%v bytes)\nExpires: %v\n", value["complete"], result["filename"], result["size"], result["expiresAt"])
		}
		if failure, ok := value["error"].(map[string]any); ok {
			fmt.Fprintf(&builder, "Error: %v (%v)\n", failure["message"], failure["code"])
		}
		fmt.Fprintf(&builder, "Warnings: %v\n", value["warningCount"])
		return builder.String(), true
	}
	if value["path"] != nil {
		var builder strings.Builder
		fmt.Fprintf(&builder, "Export ID: %v\nCutoff: %v\nSaved: %v\nSize: %v\nDigest: %v\nComplete: %v\nWarnings: %v\n", value["exportId"], value["cutoffTime"], value["path"], value["size"], value["digest"], value["complete"], value["warningCount"])
		return builder.String(), true
	}
	return "", false
}
