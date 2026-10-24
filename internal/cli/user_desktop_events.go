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
	"piwork/internal/contracts"
)

var desktopRunEventsPattern = regexp.MustCompile(`^/_desktop/api/works/([A-Za-z0-9][A-Za-z0-9-]{0,127})/runs/([A-Za-z0-9][A-Za-z0-9-]{0,127})/events$`)

func (d *nativeDesktop) serveRunEvents(w http.ResponseWriter, r *http.Request) bool {
	parts := desktopRunEventsPattern.FindStringSubmatch(r.URL.EscapedPath())
	if parts == nil || r.Method != http.MethodGet {
		return false
	}
	values, queryErr := url.ParseQuery(r.URL.RawQuery)
	modern := false
	if profile, exists := values["responseProfile"]; exists {
		if len(profile) != 1 || profile[0] != contracts.HistoryResponseProfile {
			desktopError(w, 400, "INVALID_CURSOR")
			return true
		}
		modern = true
		values.Del("responseProfile")
	}
	if queryErr != nil || len(values) != 1 || len(values["after"]) != 1 || values.Get("after") == "" {
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
	api, err := d.client(coreURL, token)
	if err != nil {
		desktopError(w, 503, "CORE_UNAVAILABLE")
		return true
	}
	corePath := "/api/v1/works/" + parts[1] + "/runs/" + parts[2]
	var run json.RawMessage
	precheckPath := corePath
	if modern {
		precheckPath = client.HistoryResponsePath(corePath)
	}
	if err := api.Request(r.Context(), http.MethodGet, precheckPath, nil, &run); err != nil {
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
	eventQuery := url.Values{"after": {strconv.FormatUint(after, 10)}}
	if modern {
		eventQuery.Set("responseProfile", contracts.HistoryResponseProfile)
	}
	u := api.Base.ResolveReference(&url.URL{Path: corePath + "/events", RawQuery: eventQuery.Encode()})
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
	var fragmentSequence uint64
	var fragmentOffset int64
	for {
		line, err := reader.ReadBytes('\n')
		total += int64(len(line))
		if total > 16<<20 || len(line) > 1<<20 || err != nil && !errors.Is(err, io.EOF) {
			return true
		}
		if len(line) > 0 && line[len(line)-1] == '\n' {
			var event struct {
				Sequence json.Number `json:"sequence"`
				Kind     struct {
					Case string `json:"$case"`
					Text struct {
						Delta                  string
						ByteOffset, TotalBytes json.Number
						Complete               *bool
					}
				} `json:"kind"`
			}
			if json.Unmarshal(line, &event) != nil {
				return true
			}
			sequence, parseErr := strconv.ParseUint(event.Sequence.String(), 10, 53)
			if parseErr != nil || sequence <= after {
				return true
			}
			advance := true
			if modern && event.Kind.Case == "text" {
				frame := event.Kind.Text
				offset, e1 := frame.ByteOffset.Int64()
				size, e2 := frame.TotalBytes.Int64()
				if frame.Complete == nil || e1 != nil || e2 != nil || offset != fragmentOffset || fragmentSequence != 0 && fragmentSequence != sequence || offset+int64(len(frame.Delta)) > size || *frame.Complete != (offset+int64(len(frame.Delta)) == size) {
					return true
				}
				fragmentSequence = sequence
				fragmentOffset += int64(len(frame.Delta))
				advance = *frame.Complete
				if advance {
					fragmentSequence = 0
					fragmentOffset = 0
				}
			} else if fragmentSequence != 0 {
				return true
			}
			if advance {
				after = sequence
			}
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
