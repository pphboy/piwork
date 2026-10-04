package cli

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"time"

	"piwork/internal/client"
)

var desktopRunEventsPattern = regexp.MustCompile(`^/_desktop/api/works/([A-Za-z0-9][A-Za-z0-9-]{0,127})/runs/([A-Za-z0-9][A-Za-z0-9-]{0,127})/events$`)

func (d *nativeDesktop) serveRunEvents(w http.ResponseWriter, r *http.Request) bool {
	parts := desktopRunEventsPattern.FindStringSubmatch(r.URL.EscapedPath())
	if parts == nil || r.Method != http.MethodGet {
		return false
	}
	values := r.URL.Query()
	if len(values) != 1 || len(values["after"]) != 1 || values.Get("after") == "" {
		desktopError(w, 400, "INVALID_CURSOR")
		return true
	}
	for _, digit := range values.Get("after") {
		if digit < '0' || digit > '9' {
			desktopError(w, 400, "INVALID_CURSOR")
			return true
		}
	}
	after, err := strconv.ParseUint(values.Get("after"), 10, 53)
	if err != nil {
		desktopError(w, 400, "INVALID_CURSOR")
		return true
	}
	if d.view(r.Context(), "")["state"] != "authenticated" {
		desktopError(w, 401, "AUTH_REQUIRED")
		return true
	}
	d.mu.Lock()
	if d.identity.credential == nil || !d.identity.checked {
		d.mu.Unlock()
		desktopError(w, 401, "AUTH_REQUIRED")
		return true
	}
	coreURL, token, generation := d.identity.coreURL, d.identity.credential.Token, d.identity.generation
	d.mu.Unlock()
	api, err := client.New(coreURL, token)
	if err != nil {
		desktopError(w, 503, "CORE_UNAVAILABLE")
		return true
	}
	corePath := "/api/v1/works/" + parts[1] + "/runs/" + parts[2]
	var run json.RawMessage
	if err := api.Request(r.Context(), http.MethodGet, corePath, nil, &run); err != nil {
		var apiErr *client.APIError
		if errors.As(err, &apiErr) && apiErr.Status == 401 {
			d.revokeToken(coreURL, token)
		}
		desktopControlFailure(w, err)
		return true
	}
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	go func() {
		ticker := time.NewTicker(500 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				d.mu.Lock()
				current := d.identity.generation == generation && d.identity.checked && d.identity.credential != nil && d.identity.credential.Token == token
				d.mu.Unlock()
				if !current {
					cancel()
					return
				}
			}
		}
	}()
	u := api.Base.ResolveReference(&url.URL{Path: corePath + "/events", RawQuery: "after=" + strconv.FormatUint(after, 10)})
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		desktopError(w, 503, "RUN_STREAM_UNAVAILABLE")
		return true
	}
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Accept", "application/x-ndjson")
	streamClient := *api.HTTP
	streamClient.Timeout = 0
	response, err := streamClient.Do(request)
	if err != nil {
		desktopError(w, 503, "RUN_STREAM_UNAVAILABLE")
		return true
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		if response.StatusCode == 401 {
			d.revokeToken(coreURL, token)
		}
		var failure struct {
			Code string `json:"code"`
		}
		_ = json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&failure)
		if failure.Code == "" {
			failure.Code = "RUN_STREAM_UNAVAILABLE"
		}
		desktopError(w, response.StatusCode, failure.Code)
		return true
	}
	if response.Header.Get("Content-Type") != "application/x-ndjson" {
		desktopError(w, 503, "RUN_STREAM_UNAVAILABLE")
		return true
	}
	d.mu.Lock()
	current := d.identity.generation == generation && d.identity.checked && d.identity.credential != nil && d.identity.credential.Token == token
	d.mu.Unlock()
	if !current {
		desktopError(w, 409, "CONNECTION_CHANGED")
		return true
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		desktopError(w, 503, "RUN_STREAM_UNAVAILABLE")
		return true
	}
	w.Header().Set("Content-Type", "application/x-ndjson")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(200)
	reader := bufio.NewReader(io.LimitReader(response.Body, (16<<20)+1))
	var total int64
	for {
		line, err := reader.ReadBytes('\n')
		total += int64(len(line))
		if total > 16<<20 || len(line) > 1<<20 || err != nil && !errors.Is(err, io.EOF) {
			return true
		}
		if len(line) > 0 && line[len(line)-1] == '\n' {
			var event struct {
				Sequence json.Number `json:"sequence"`
			}
			if json.Unmarshal(line, &event) != nil {
				return true
			}
			sequence, parseErr := strconv.ParseUint(event.Sequence.String(), 10, 53)
			if parseErr != nil || sequence <= after {
				return true
			}
			after = sequence
			if _, writeErr := w.Write(line); writeErr != nil {
				return true
			}
			flusher.Flush()
		}
		if errors.Is(err, io.EOF) {
			return true
		}
	}
}
