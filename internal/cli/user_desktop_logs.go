package cli

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"piwork/internal/client"
)

// serveLogExports forwards the explicit log-export routes through the current
// browser/Desktop session. The Core token never enters a URL or response, and
// content is streamed once without a second server-side archive.
func (d *nativeDesktop) serveLogExports(w http.ResponseWriter, r *http.Request, session desktopSession) bool {
	path := r.URL.Path
	if path != "/_desktop/api/log-exports" && !strings.HasPrefix(path, "/_desktop/api/log-exports/") {
		return false
	}
	d.mu.Lock()
	record, coreURL := d.identity.credential, d.identity.coreURL
	d.mu.Unlock()
	if record == nil {
		desktopError(w, 401, "LOCAL_AUTH_REQUIRED")
		return true
	}
	if record.User.Role != "admin" {
		desktopError(w, 403, "PERMISSION_DENIED")
		return true
	}
	if path == "/_desktop/api/log-exports" {
		if r.Method != http.MethodPost {
			desktopError(w, 405, "METHOD_NOT_ALLOWED")
			return true
		}
		input, err := readDesktopObject(r, 2<<20)
		if err != nil {
			desktopInputError(w, err)
			return true
		}
		if len(input) != 1 {
			desktopError(w, 400, "INVALID_REQUEST")
			return true
		}
		raw, present := input["idempotencyKey"]
		var key string
		if !present || json.Unmarshal(raw, &key) != nil || key == "" || len(key) > 256 {
			desktopError(w, 400, "INVALID_REQUEST")
			return true
		}
		api, err := d.client(coreURL, record.Token)
		if err != nil {
			desktopError(w, 503, "CORE_UNAVAILABLE")
			return true
		}
		var accepted map[string]any
		if err := api.Request(r.Context(), http.MethodPost, "/api/v1/log-exports", map[string]string{"idempotencyKey": key}, &accepted); err != nil {
			desktopCoreError(w, err)
			return true
		}
		safe := copyDesktopLogFields(accepted, "exportId", "correlationId", "cutoffTime", "state", "scope", "reused")
		if safe["exportId"] == nil {
			desktopError(w, 502, "INVALID_CORE_RESPONSE")
			return true
		}
		desktopJSON(w, 202, safe)
		return true
	}
	relative := strings.TrimPrefix(path, "/_desktop/api/log-exports/")
	parts := strings.Split(relative, "/")
	if len(parts) == 0 || !desktopLogID(parts[0]) {
		desktopError(w, 404, "NOT_FOUND")
		return true
	}
	exportID := parts[0]
	api, err := d.client(coreURL, record.Token)
	if err != nil {
		desktopError(w, 503, "CORE_UNAVAILABLE")
		return true
	}
	if len(parts) == 1 {
		if r.Method != http.MethodGet {
			desktopError(w, 405, "METHOD_NOT_ALLOWED")
			return true
		}
		var view map[string]any
		if err := api.Request(r.Context(), http.MethodGet, "/api/v1/log-exports/"+url.PathEscape(exportID), nil, &view); err != nil {
			desktopCoreError(w, err)
			return true
		}
		safe := copyDesktopLogFields(view, "exportId", "correlationId", "cutoffTime", "state", "scope", "createdAt", "updatedAt", "progress", "complete", "warningCount", "warnings", "warningsTruncated", "result", "error", "cleanupPending")
		if safe["exportId"] == nil {
			desktopError(w, 502, "INVALID_CORE_RESPONSE")
			return true
		}
		desktopJSON(w, 200, safe)
		return true
	}
	if len(parts) != 2 || parts[1] != "content" || r.Method != http.MethodGet {
		desktopError(w, 404, "NOT_FOUND")
		return true
	}
	headers := make(http.Header)
	headers.Set("Accept", "application/zip")
	response, err := api.Binary(r.Context(), http.MethodGet, "/api/v1/log-exports/"+url.PathEscape(exportID)+"/content", headers, nil, 0)
	if err != nil {
		desktopError(w, 503, "CORE_UNAVAILABLE")
		return true
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		code := "LOG_EXPORT_CONTENT_UNAVAILABLE"
		if response.StatusCode == http.StatusGone {
			code = "LOG_EXPORT_EXPIRED"
		} else if response.StatusCode == http.StatusConflict {
			code = "LOG_EXPORT_NOT_READY"
		}
		desktopError(w, response.StatusCode, code)
		return true
	}
	for _, name := range []string{"Content-Type", "Content-Length", "Content-Disposition", "X-Piwork-SHA256", "Cache-Control"} {
		if value := response.Header.Get(name); value != "" {
			w.Header().Set(name, value)
		}
	}
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(200)
	controller := http.NewResponseController(w)
	buffer := make([]byte, 64<<10)
	for {
		_ = controller.SetWriteDeadline(time.Now().Add(60 * time.Second))
		n, readErr := response.Body.Read(buffer)
		if n > 0 {
			if _, writeErr := w.Write(buffer[:n]); writeErr != nil {
				return true
			}
			_ = controller.Flush()
		}
		if readErr == io.EOF {
			return true
		}
		if readErr != nil {
			return true
		}
	}
}

func desktopLogID(value string) bool {
	if len(value) < 27 || len(value) > 128 {
		return false
	}
	if !strings.HasPrefix(value, "log-export-") {
		return false
	}
	for _, char := range strings.TrimPrefix(value, "log-export-") {
		if !(char >= 'a' && char <= 'z' || char >= '0' && char <= '9' || char == '-') {
			return false
		}
	}
	return true
}

func copyDesktopLogFields(source map[string]any, keys ...string) map[string]any {
	safe := map[string]any{}
	for _, key := range keys {
		if value, ok := source[key]; ok {
			safe[key] = value
		}
	}
	return safe
}

func desktopCoreError(w http.ResponseWriter, err error) {
	var failure *client.APIError
	if !errors.As(err, &failure) {
		desktopError(w, 503, "CORE_UNAVAILABLE")
		return
	}
	status := failure.Status
	if status < 400 || status > 599 {
		status = 503
	}
	desktopError(w, status, failure.Code)
}
