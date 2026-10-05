// Package localweb contains the stateless helpers shared by the local browser apps.
package localweb

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"unicode/utf8"
)

// BrowserAsset accepts one embedded module filename, never a host path.
var BrowserAsset = regexp.MustCompile(`^[a-z][a-z0-9-]*\.js$`)
var IDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9-]{0,127}$`)
var NamePattern = regexp.MustCompile(`^(?:@[a-z0-9][a-z0-9._-]*/)?[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`)

func ResourcePart(raw string, pattern *regexp.Regexp) (string, bool) {
	value, err := url.PathUnescape(raw)
	return value, err == nil && pattern.MatchString(value) && !strings.ContainsAny(value, "\\\x00")
}

func Secret() (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

func ReadObject(r *http.Request, limit int64) (map[string]json.RawMessage, error) {
	if r.Header.Get("Content-Type") != "application/json" {
		return nil, errors.New("JSON_REQUIRED")
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(raw)) > limit {
		return nil, errors.New("REQUEST_TOO_LARGE")
	}
	var value map[string]json.RawMessage
	if json.Unmarshal(raw, &value) != nil || value == nil {
		return nil, errors.New("INVALID_JSON")
	}
	return value, nil
}

func IsLocalCoreHost(host string) bool {
	return host == "localhost" || host == "127.0.0.1" || host == "::1"
}

func DisplayName(value string) bool {
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

func UploadPath(encoded string, maxPathBytes, maxDepth int) (string, bool) {
	value, err := url.PathUnescape(encoded)
	if err != nil || value == "" || !utf8.ValidString(value) || len(value) > maxPathBytes || strings.HasPrefix(value, "/") || strings.Contains(value, "\\") {
		return "", false
	}
	if len(value) >= 2 && value[1] == ':' && (value[0] >= 'A' && value[0] <= 'Z' || value[0] >= 'a' && value[0] <= 'z') {
		return "", false
	}
	parts := strings.Split(value, "/")
	if len(parts) > maxDepth {
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
