package cli

import (
	"bytes"
	"crypto/subtle"
	"encoding/base64"
	"encoding/xml"
	"errors"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"

	"piwork/internal/client"
)

const proxyFileMetadataLimit = 16_777_216

var proxyFileExpectedLimits = map[string]int64{
	"maxHeaderBytes": 32768, "maxXmlBytes": 65536, "maxXmlDepth": 32, "maxProperties": 128,
	"maxMetadataBytes": 16777216, "maxDirectoryEntries": 10000, "maxTreeEntries": 10000,
	"maxFileBytes": 10737418240, "maxTreeBytes": 10737418240, "maxSegmentBytes": 255,
	"maxPathBytes": 4096, "maxPathDepth": 128, "maxCoreRequests": 16, "maxUserRequests": 8,
	"maxWorkRequests": 4, "maxWorkMutations": 1, "connectTimeoutMs": 10000,
	"helperTimeoutMs": 10000, "idleTimeoutMs": 60000, "requestTimeoutMs": 1800000,
	"authorizationRecheckMs": 2000,
}

type proxyFileCapability struct {
	Version      int              `json:"version"`
	Protocol     string           `json:"protocol"`
	Profile      string           `json:"profile"`
	RootTemplate string           `json:"rootTemplate"`
	Limits       map[string]int64 `json:"limits"`
	Available    bool             `json:"available"`
	Reason       *string          `json:"reason"`
}

func (value proxyFileCapability) valid() bool {
	if value.Version != 1 || value.Protocol != "webdav" || value.Profile != "workspace-transfer-v1" ||
		value.RootTemplate != "/api/v1/works/{workId}/files/" || len(value.Limits) != len(proxyFileExpectedLimits) ||
		value.Available && value.Reason != nil || !value.Available && (value.Reason == nil || *value.Reason != "FILE_HELPER_UNAVAILABLE") {
		return false
	}
	for name, expected := range proxyFileExpectedLimits {
		if value.Limits[name] != expected {
			return false
		}
	}
	return true
}

var proxyWorkIDPattern = regexp.MustCompile(`^[A-Za-z0-9-]{16,128}$`)

type proxyFilePath struct {
	workID string
	path   string
}

type proxyFileError string

func (e proxyFileError) Error() string { return string(e) }

func (p *userProxy) sameFileCredential(header string) bool {
	parts := strings.Fields(header)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Basic") {
		return false
	}
	decoded, err := base64.StdEncoding.Strict().DecodeString(parts[1])
	if err != nil {
		return false
	}
	expected := []byte("piwork:" + p.password)
	return len(decoded) == len(expected) && subtle.ConstantTimeCompare(decoded, expected) == 1
}

func validateProxyFilePath(raw, prefix string) (proxyFilePath, error) {
	if strings.ContainsAny(raw, "?#") || !strings.HasPrefix(raw, prefix) {
		return proxyFilePath{}, proxyFileError("FILE_PATH_INVALID")
	}
	tail := strings.TrimPrefix(raw, prefix)
	slash := strings.IndexByte(tail, '/')
	if slash < 0 {
		slash = len(tail)
	}
	id := tail[:slash]
	if !proxyWorkIDPattern.MatchString(id) {
		return proxyFilePath{}, proxyFileError("FILE_PATH_INVALID")
	}
	rest := tail[slash:]
	if !strings.HasPrefix(rest, "/files") || len(rest) > 6 && rest[6] != '/' {
		return proxyFilePath{}, proxyFileError("FILE_PATH_INVALID")
	}
	suffix := strings.TrimPrefix(rest, "/files")
	if suffix != "" && suffix != "/" {
		if !strings.HasPrefix(suffix, "/") {
			return proxyFilePath{}, proxyFileError("FILE_PATH_INVALID")
		}
		parts := strings.Split(strings.TrimPrefix(suffix, "/"), "/")
		if strings.HasSuffix(suffix, "/") {
			parts = parts[:len(parts)-1]
		}
		if len(parts) > 128 {
			return proxyFilePath{}, proxyFileError("FILE_PATH_TOO_LONG")
		}
		total := 0
		for _, part := range parts {
			if part == "" {
				return proxyFilePath{}, proxyFileError("FILE_PATH_INVALID")
			}
			decoded, err := url.PathUnescape(part)
			if err != nil || !validProxyFileSegment(decoded) {
				return proxyFilePath{}, proxyFileError("FILE_PATH_INVALID")
			}
			if len(decoded) > 255 {
				return proxyFilePath{}, proxyFileError("FILE_PATH_TOO_LONG")
			}
			total += len(decoded) + 1
			if total > 4096 {
				return proxyFilePath{}, proxyFileError("FILE_PATH_TOO_LONG")
			}
		}
	}
	return proxyFilePath{workID: id, path: suffix}, nil
}

func validProxyFileSegment(value string) bool {
	if !utf8.ValidString(value) || value == "" || value == "." || value == ".." || strings.ContainsAny(value, "/\\") {
		return false
	}
	for _, runeValue := range value {
		if runeValue < 0x20 && runeValue != '\t' && runeValue != '\n' && runeValue != '\r' || runeValue == 0xfffe || runeValue == 0xffff {
			return false
		}
	}
	return true
}

func proxyFileCorePath(raw string) (proxyFilePath, error) {
	target, err := validateProxyFilePath(raw, "/works/")
	if err != nil {
		return target, err
	}
	target.path = "/api/v1/works/" + target.workID + "/files" + target.path
	return target, nil
}

func proxyFileLocalPath(raw, workID string) (string, error) {
	target, err := validateProxyFilePath(raw, "/api/v1/works/")
	if err != nil || target.workID != workID {
		return "", proxyFileError("FILE_BACKEND_PROTOCOL_ERROR")
	}
	return "/works/" + workID + "/files" + target.path, nil
}

func proxyFileDestination(raw, workID, origin string) (string, error) {
	path := raw
	if !strings.HasPrefix(raw, "/") {
		parsed, err := url.Parse(raw)
		if err != nil || parsed.Scheme != "http" || parsed.User != nil || !strings.EqualFold(parsed.Host, strings.TrimPrefix(origin, "http://")) || parsed.RawQuery != "" || parsed.ForceQuery || parsed.Fragment != "" {
			return "", proxyFileError("FILE_DESTINATION_DENIED")
		}
		path = parsed.EscapedPath()
	}
	target, err := proxyFileCorePath(path)
	if err != nil || target.workID != workID || strings.HasSuffix(target.path, "/files") || strings.HasSuffix(target.path, "/files/") {
		return "", proxyFileError("FILE_DESTINATION_DENIED")
	}
	return target.path, nil
}

func proxyFileErrorStatus(code string) int {
	switch code {
	case "FILE_PATH_INVALID", "FILE_REQUEST_INVALID", "FILE_DEPTH_UNSUPPORTED":
		return 400
	case "LOCAL_AUTH_REQUIRED":
		return 401
	case "AUTH_REQUIRED":
		return 401
	case "FILE_REQUEST_DENIED", "FILE_DESTINATION_DENIED", "LOCAL_CREDENTIAL_TARGET_DENIED", "FILE_ROOT_PROTECTED", "LOCAL_CSRF_OR_AUTH_REQUIRED":
		return 403
	case "FILE_MUTATION_BUSY", "CONNECTION_CHANGED":
		return 409
	case "FILE_METHOD_NOT_ALLOWED":
		return 405
	case "FILE_PATH_TOO_LONG":
		return 414
	case "FILE_LIMIT_EXCEEDED":
		return 413
	case "FILE_ACCESS_UNSUPPORTED":
		return 501
	case "FILE_HELPER_UNAVAILABLE":
		return 503
	default:
		return 502
	}
}

func proxyFileFail(w http.ResponseWriter, method, code string) {
	status := proxyFileErrorStatus(code)
	body := `<?xml version="1.0" encoding="utf-8"?><d:error xmlns:d="DAV:" xmlns:p="urn:piwork:files"><p:code>` + code + `</p:code></d:error>`
	w.Header().Set("Content-Type", "application/xml; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Piwork-File-Error", code)
	if code == "LOCAL_AUTH_REQUIRED" {
		w.Header().Set("WWW-Authenticate", `Basic realm="piwork Work files", charset="UTF-8"`)
	}
	w.Header().Set("Content-Length", strconv.Itoa(len(body)))
	w.WriteHeader(status)
	if method != http.MethodHead {
		_, _ = io.WriteString(w, body)
	}
}

func (p *userProxy) serveFile(w http.ResponseWriter, r *http.Request) {
	fail := func(code string) { proxyFileFail(w, r.Method, code) }
	origin := "http://" + r.Host
	if !p.localRequest(r) {
		fail("FILE_REQUEST_DENIED")
		return
	}
	if !p.sameFileCredential(r.Header.Get("Authorization")) {
		fail("LOCAL_AUTH_REQUIRED")
		return
	}
	target, err := proxyFileCorePath(r.RequestURI)
	if err != nil {
		fail(string(err.(proxyFileError)))
		return
	}
	var capability proxyFileCapability
	if err := p.api.Request(r.Context(), http.MethodGet, "/api/v1/file-access", nil, &capability); err != nil {
		var apiErr *client.APIError
		if errors.As(err, &apiErr) && apiErr.Status == 401 {
			p.sessionLost()
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
	headers := make(http.Header)
	for name, values := range r.Header {
		lower := strings.ToLower(name)
		if lower == "authorization" || lower == "cookie" || lower == "host" || lower == "forwarded" || strings.HasPrefix(lower, "x-forwarded-") || strings.HasPrefix(lower, "proxy-") || strings.HasPrefix(lower, "x-piwork-") ||
			lower == "connection" || lower == "upgrade" || lower == "te" || lower == "trailer" || lower == "keep-alive" || lower == "transfer-encoding" {
			continue
		}
		headers[name] = append([]string(nil), values...)
	}
	if r.Method == "COPY" || r.Method == "MOVE" {
		mapped, err := proxyFileDestination(r.Header.Get("Destination"), target.workID, origin)
		if err != nil {
			fail("FILE_DESTINATION_DENIED")
			return
		}
		headers.Set("Destination", mapped)
	}
	var body io.Reader
	if r.Body != nil && r.Body != http.NoBody {
		body = r.Body
	}
	response, err := p.api.Binary(r.Context(), r.Method, target.path, headers, body, r.ContentLength)
	if err != nil {
		fail("CORE_UNAVAILABLE")
		return
	}
	defer response.Body.Close()
	if response.StatusCode == 401 {
		p.sessionLost()
		fail("AUTH_REQUIRED")
		return
	}
	returned := make(http.Header)
	for name, values := range response.Header {
		lower := strings.ToLower(name)
		if lower == "connection" || lower == "transfer-encoding" || lower == "keep-alive" || lower == "proxy-authenticate" || lower == "proxy-authorization" || lower == "upgrade" {
			continue
		}
		returned[name] = append([]string(nil), values...)
	}
	if location := response.Header.Get("Location"); location != "" {
		mapped, err := proxyFileLocalPath(location, target.workID)
		if err != nil {
			fail("FILE_BACKEND_PROTOCOL_ERROR")
			return
		}
		returned.Set("Location", mapped)
	}
	contentType := strings.ToLower(strings.TrimSpace(strings.SplitN(response.Header.Get("Content-Type"), ";", 2)[0]))
	if r.Method != http.MethodHead && contentType == "application/xml" {
		body, err := io.ReadAll(io.LimitReader(response.Body, proxyFileMetadataLimit+1))
		if err != nil || len(body) > proxyFileMetadataLimit {
			fail("FILE_LIMIT_EXCEEDED")
			return
		}
		mapped, err := mapProxyDavXML(body, target.workID)
		if err != nil {
			fail("FILE_BACKEND_PROTOCOL_ERROR")
			return
		}
		returned.Set("Content-Length", strconv.Itoa(len(mapped)))
		copyProxyFileHeaders(w.Header(), returned)
		w.WriteHeader(response.StatusCode)
		_, _ = w.Write(mapped)
		return
	}
	copyProxyFileHeaders(w.Header(), returned)
	w.WriteHeader(response.StatusCode)
	_, _ = io.Copy(proxyFlushingWriter{ResponseWriter: w}, response.Body)
}

type proxyFlushingWriter struct{ http.ResponseWriter }

func (w proxyFlushingWriter) Write(chunk []byte) (int, error) {
	n, err := w.ResponseWriter.Write(chunk)
	if n > 0 {
		if flusher, ok := w.ResponseWriter.(http.Flusher); ok {
			flusher.Flush()
		}
	}
	return n, err
}

func copyProxyFileHeaders(target, source http.Header) {
	for name, values := range source {
		target[name] = append([]string(nil), values...)
	}
}

func mapProxyDavXML(input []byte, workID string) ([]byte, error) {
	return mapProxyDavXMLPrefix(input, workID, "")
}

func mapProxyDavXMLPrefix(input []byte, workID, prefix string) ([]byte, error) {
	decoder := xml.NewDecoder(bytes.NewReader(input))
	decoder.Strict = true
	var output bytes.Buffer
	encoder := xml.NewEncoder(&output)
	depth := 0
	insideHref := false
	var href strings.Builder
	for {
		token, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
		switch item := token.(type) {
		case xml.Directive:
			return nil, proxyFileError("FILE_BACKEND_PROTOCOL_ERROR")
		case xml.ProcInst:
			if item.Target != "xml" || depth != 0 {
				return nil, proxyFileError("FILE_BACKEND_PROTOCOL_ERROR")
			}
		case xml.StartElement:
			depth++
			if depth > 32 || insideHref {
				return nil, proxyFileError("FILE_BACKEND_PROTOCOL_ERROR")
			}
			if item.Name.Space == "DAV:" && item.Name.Local == "href" {
				insideHref = true
				href.Reset()
			}
		case xml.CharData:
			if insideHref {
				href.Write(item)
				continue
			}
		case xml.EndElement:
			if insideHref && item.Name.Space == "DAV:" && item.Name.Local == "href" {
				path, err := proxyFileLocalPath(href.String(), workID)
				if err != nil {
					return nil, err
				}
				if err := encoder.EncodeToken(xml.CharData(prefix + path)); err != nil {
					return nil, err
				}
				insideHref = false
			}
			depth--
		}
		if err := encoder.EncodeToken(token); err != nil {
			return nil, err
		}
		if output.Len() > proxyFileMetadataLimit {
			return nil, proxyFileError("FILE_LIMIT_EXCEEDED")
		}
	}
	if depth != 0 || insideHref || encoder.Flush() != nil || output.Len() > proxyFileMetadataLimit {
		return nil, proxyFileError("FILE_BACKEND_PROTOCOL_ERROR")
	}
	return output.Bytes(), nil
}
