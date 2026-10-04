package cli

import (
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"piwork/internal/client"
)

const desktopFilesPrefix = "/_desktop/files"

func desktopFileFail(w http.ResponseWriter, method, code string) {
	status := proxyFileErrorStatus(code)
	content := `<?xml version="1.0" encoding="utf-8"?><d:error xmlns:d="DAV:" xmlns:p="urn:piwork:files"><p:code>` + code + `</p:code></d:error>`
	w.Header().Set("Content-Type", "application/xml; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Piwork-File-Error", code)
	w.Header().Set("Content-Length", strconv.Itoa(len(content)))
	w.WriteHeader(status)
	if method != http.MethodHead {
		_, _ = io.WriteString(w, content)
	}
}

func desktopFileDestination(raw, workID, origin string) (string, error) {
	value := raw
	if !strings.HasPrefix(raw, "/") {
		parsed, err := url.Parse(raw)
		if err != nil || parsed.Scheme != "http" || parsed.Host != strings.TrimPrefix(origin, "http://") || parsed.User != nil || parsed.RawQuery != "" || parsed.ForceQuery || parsed.Fragment != "" {
			return "", proxyFileError("FILE_DESTINATION_DENIED")
		}
		value = parsed.EscapedPath()
	}
	if !strings.HasPrefix(value, desktopFilesPrefix+"/works/") {
		return "", proxyFileError("FILE_DESTINATION_DENIED")
	}
	return proxyFileDestination(strings.TrimPrefix(value, desktopFilesPrefix), workID, origin)
}

func (d *nativeDesktop) serveFiles(w http.ResponseWriter, r *http.Request) {
	fail := func(code string) { desktopFileFail(w, r.Method, code) }
	method := r.Method
	switch method {
	case "OPTIONS", "PROPFIND", "GET", "HEAD", "PUT", "MKCOL", "COPY", "MOVE", "DELETE":
	default:
		fail("FILE_METHOD_NOT_ALLOWED")
		return
	}
	mutation := method != "GET" && method != "HEAD" && method != "OPTIONS"
	if !d.sameOrigin(r) {
		fail("FILE_REQUEST_DENIED")
		return
	}
	session, ok := d.authorize(r, mutation)
	if !ok {
		if mutation {
			fail("LOCAL_CSRF_OR_AUTH_REQUIRED")
		} else {
			fail("LOCAL_AUTH_REQUIRED")
		}
		return
	}
	guarded, request, finish, ok := d.guardContent(w, r, session)
	if !ok {
		return
	}
	defer finish()
	w, r = guarded, request
	if r.URL.RawQuery != "" {
		fail("FILE_PATH_INVALID")
		return
	}
	target, err := proxyFileCorePath(strings.TrimPrefix(r.URL.EscapedPath(), desktopFilesPrefix))
	if err != nil {
		fail(string(err.(proxyFileError)))
		return
	}
	if method == "PROPFIND" && r.Header.Get("Depth") != "0" && r.Header.Get("Depth") != "1" {
		fail("FILE_DEPTH_UNSUPPORTED")
		return
	}
	if method == "PUT" && r.ContentLength > proxyFileExpectedLimits["maxFileBytes"] {
		fail("FILE_LIMIT_EXCEEDED")
		return
	}
	write := method == "PUT" || method == "MKCOL" || method == "COPY" || method == "MOVE" || method == "DELETE"
	if write && (strings.HasSuffix(target.path, "/files") || strings.HasSuffix(target.path, "/files/")) {
		fail("FILE_ROOT_PROTECTED")
		return
	}
	if write {
		d.mu.Lock()
		if d.fileWrites == nil {
			d.fileWrites = map[string]bool{}
		}
		if d.fileWrites[target.workID] {
			d.mu.Unlock()
			fail("FILE_MUTATION_BUSY")
			return
		}
		d.fileWrites[target.workID] = true
		d.mu.Unlock()
		defer func() { d.mu.Lock(); delete(d.fileWrites, target.workID); d.mu.Unlock() }()
	}
	if d.view(r.Context(), "")["state"] != "authenticated" {
		fail("AUTH_REQUIRED")
		return
	}
	d.mu.Lock()
	if d.identity.credential == nil || !d.identity.checked {
		d.mu.Unlock()
		fail("AUTH_REQUIRED")
		return
	}
	coreURL, token, generation := d.identity.coreURL, d.identity.credential.Token, d.identity.generation
	d.mu.Unlock()
	api, err := client.New(coreURL, token)
	if err != nil {
		fail("CORE_UNAVAILABLE")
		return
	}
	var capability proxyFileCapability
	if err := api.Request(r.Context(), "GET", "/api/v1/file-access", nil, &capability); err != nil {
		var apiErr *client.APIError
		if errors.As(err, &apiErr) && apiErr.Status == 401 {
			d.revokeToken(coreURL, token)
			fail("AUTH_REQUIRED")
		} else if errors.As(err, &apiErr) && apiErr.Status == 404 {
			fail("FILE_ACCESS_UNSUPPORTED")
		} else {
			fail("CORE_UNAVAILABLE")
		}
		return
	}
	if !capability.valid() {
		fail("FILE_ACCESS_UNSUPPORTED")
		return
	}
	if !capability.Available {
		fail("FILE_HELPER_UNAVAILABLE")
		return
	}
	requested := make(http.Header)
	connectionFields := map[string]bool{}
	for _, field := range strings.Split(r.Header.Get("Connection"), ",") {
		connectionFields[strings.ToLower(strings.TrimSpace(field))] = true
	}
	for name, values := range r.Header {
		lower := strings.ToLower(name)
		if connectionFields[lower] || lower == "authorization" || lower == "cookie" || lower == "host" || lower == "origin" || lower == "referer" ||
			lower == "connection" || lower == "transfer-encoding" || lower == "keep-alive" || lower == "te" || lower == "trailer" || lower == "upgrade" ||
			strings.HasPrefix(lower, "proxy-") || strings.HasPrefix(lower, "x-piwork-") {
			continue
		}
		requested[name] = append([]string(nil), values...)
	}
	if method == "COPY" || method == "MOVE" {
		mapped, err := desktopFileDestination(r.Header.Get("Destination"), target.workID, d.origin)
		if err != nil {
			fail("FILE_DESTINATION_DENIED")
			return
		}
		requested.Set("Destination", mapped)
	}
	d.mu.Lock()
	current := d.identity.generation == generation && d.identity.checked && d.identity.credential != nil && d.identity.credential.Token == token
	d.mu.Unlock()
	if !current {
		fail("CONNECTION_CHANGED")
		return
	}
	var body io.Reader
	if r.Body != nil && r.Body != http.NoBody {
		body = r.Body
	}
	response, err := api.Binary(r.Context(), method, target.path, requested, body, r.ContentLength)
	if err != nil {
		fail("CORE_UNAVAILABLE")
		return
	}
	defer response.Body.Close()
	if response.StatusCode == 401 {
		d.revokeToken(coreURL, token)
		fail("AUTH_REQUIRED")
		return
	}
	d.mu.Lock()
	current = d.identity.generation == generation && d.identity.checked && d.identity.credential != nil && d.identity.credential.Token == token
	d.mu.Unlock()
	if !current {
		fail("CONNECTION_CHANGED")
		return
	}
	returned := make(http.Header)
	for name, values := range response.Header {
		lower := strings.ToLower(name)
		if lower == "connection" || lower == "transfer-encoding" || lower == "keep-alive" || lower == "te" || lower == "trailer" || lower == "upgrade" ||
			lower == "set-cookie" || lower == "www-authenticate" || strings.HasPrefix(lower, "proxy-") || strings.HasPrefix(lower, "x-piwork-gateway-") {
			continue
		}
		returned[name] = append([]string(nil), values...)
	}
	returned.Set("Cache-Control", "no-store")
	returned.Set("Referrer-Policy", "no-referrer")
	if location := response.Header.Get("Location"); location != "" {
		mapped, err := proxyFileLocalPath(location, target.workID)
		if err != nil {
			fail("FILE_BACKEND_PROTOCOL_ERROR")
			return
		}
		returned.Set("Location", desktopFilesPrefix+mapped)
	}
	contentType := strings.ToLower(strings.TrimSpace(strings.SplitN(response.Header.Get("Content-Type"), ";", 2)[0]))
	if response.StatusCode == 207 && (contentType == "application/xml" || contentType == "text/xml") {
		raw, err := io.ReadAll(io.LimitReader(response.Body, proxyFileMetadataLimit+1))
		if err != nil || len(raw) > proxyFileMetadataLimit {
			fail("FILE_LIMIT_EXCEEDED")
			return
		}
		mapped, err := mapProxyDavXMLPrefix(raw, target.workID, desktopFilesPrefix)
		if err != nil {
			fail("FILE_BACKEND_PROTOCOL_ERROR")
			return
		}
		returned.Set("Content-Length", strconv.Itoa(len(mapped)))
		copyProxyFileHeaders(w.Header(), returned)
		w.WriteHeader(207)
		_, _ = w.Write(mapped)
		return
	}
	copyProxyFileHeaders(w.Header(), returned)
	w.WriteHeader(response.StatusCode)
	if method != "HEAD" {
		_, _ = io.Copy(w, response.Body)
	}
}
