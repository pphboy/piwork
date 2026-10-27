// Package bootrecovery keeps native, script-free reloads at their original URL.
package bootrecovery

import (
	"bytes"
	"encoding/base64"
	"net/http"
	"net/url"
	"strings"
)

const field = "__piwork_boot_retry"

// target uses RequestURI because hosted Console rewrites URL.Path internally.
func target(r *http.Request) string {
	if original, err := url.ParseRequestURI(r.RequestURI); err == nil {
		return original.RequestURI()
	}
	return r.URL.RequestURI()
}

// HTML supplies the original target without reflecting query text as markup.
// An action-less GET form inherits the browser's current fragment. A redirect
// then restores the original query bytes instead of form-encoding them again.
func HTML(content []byte, r *http.Request) []byte {
	value := base64.RawURLEncoding.EncodeToString([]byte(target(r)))
	control := `<input type="hidden" name="` + field + `" value="` + value + `">`
	return bytes.Replace(content, []byte("<!-- PIWORK_BOOT_RECOVERY -->"), []byte(control), 1)
}

// Redirect accepts only a read-only reload of this same path. Authentication
// and Host checks remain the responsibility of the existing entry handlers.
func Redirect(w http.ResponseWriter, r *http.Request) bool {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		return false
	}
	values, err := url.ParseQuery(r.URL.RawQuery)
	encoded, present := values[field]
	if err != nil || !present || len(values) != 1 {
		return false
	}
	invalid := func() bool {
		http.Error(w, "Invalid page recovery target", http.StatusBadRequest)
		return true
	}
	if len(encoded) != 1 {
		return invalid()
	}
	decoded, err := base64.RawURLEncoding.Strict().DecodeString(encoded[0])
	if err != nil || len(decoded) == 0 {
		return invalid()
	}
	address := string(decoded)
	for _, ch := range []byte(address) {
		if ch < 0x20 || ch == 0x7f || ch == '#' {
			return invalid()
		}
	}
	next, err := url.ParseRequestURI(address)
	current, currentErr := url.ParseRequestURI(target(r))
	if err != nil || currentErr != nil || next.IsAbs() || next.Host != "" ||
		!strings.HasPrefix(address, "/") || strings.HasPrefix(address, "//") ||
		next.EscapedPath() != current.EscapedPath() {
		return invalid()
	}
	if nested, err := url.ParseQuery(next.RawQuery); err == nil && len(nested) == 1 {
		if _, present := nested[field]; present {
			return invalid()
		}
	}
	w.Header().Set("Cache-Control", "no-store")
	http.Redirect(w, r, address, http.StatusSeeOther)
	return true
}
