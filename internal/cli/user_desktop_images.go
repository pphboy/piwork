package cli

import (
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"piwork/internal/chatimages"
	"piwork/internal/client"
	"strconv"
	"strings"
)

// The caller holds the identity-bound local content guard. No Core token is sent to the browser.
func (d *nativeDesktop) serveChatImage(w http.ResponseWriter, r *http.Request) bool {
	parts := strings.Split(strings.TrimPrefix(r.URL.EscapedPath(), "/_desktop/api/"), "/")
	if len(parts) != 8 || parts[0] != "works" || parts[2] != "sessions" || parts[4] != "runs" || parts[6] != "images" {
		return false
	}
	if r.Method != http.MethodGet || r.URL.RawQuery != "" {
		desktopError(w, 400, "INVALID_INPUT")
		return true
	}
	for _, i := range []int{1, 3, 5} {
		if _, ok := desktopResourcePart(parts[i], desktopIDPattern); !ok {
			desktopError(w, 400, "INVALID_INPUT")
			return true
		}
	}
	index, err := strconv.Atoi(parts[7])
	if err != nil || index < 0 || index > 3 || strconv.Itoa(index) != parts[7] {
		desktopError(w, 400, "INVALID_INPUT")
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
	base, token := d.identity.coreURL, d.identity.credential.Token
	d.mu.Unlock()
	api, err := client.New(base, token)
	if err != nil {
		desktopError(w, 503, "CORE_UNAVAILABLE")
		return true
	}
	path := "/api/v1/" + strings.Join(parts, "/")
	ref, err := url.ParseRequestURI(path)
	if err != nil {
		desktopError(w, 400, "INVALID_INPUT")
		return true
	}
	request, err := http.NewRequestWithContext(r.Context(), http.MethodGet, api.Base.ResolveReference(ref).String(), nil)
	if err != nil {
		desktopError(w, 400, "INVALID_INPUT")
		return true
	}
	request.Header.Set("Authorization", "Bearer "+token)
	response, err := api.HTTP.Do(request)
	if err != nil {
		desktopError(w, 503, "CORE_UNAVAILABLE")
		return true
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		var value struct {
			Code string `json:"code"`
		}
		_ = json.NewDecoder(io.LimitReader(response.Body, 65536)).Decode(&value)
		if response.StatusCode == 401 {
			d.revokeToken(base, token)
		}
		code := value.Code
		if code == "" {
			code = "IMAGE_UNAVAILABLE"
		}
		desktopError(w, response.StatusCode, code)
		return true
	}
	kind := response.Header.Get("Content-Type")
	if (kind != "image/png" && kind != "image/jpeg" && kind != "image/webp") || response.ContentLength <= 0 || response.ContentLength > chatimages.MaxImageBytes {
		desktopError(w, 502, "IMAGE_HISTORY_CORRUPT")
		return true
	}
	w.Header().Set("Content-Type", kind)
	w.Header().Set("Content-Length", strconv.FormatInt(response.ContentLength, 10))
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(200)
	_, _ = io.CopyN(w, response.Body, response.ContentLength)
	return true
}
