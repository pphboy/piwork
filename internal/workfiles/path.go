// Package workfiles contains the unchanged browser/proxy facing DAV profile.
package workfiles

import (
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"

	"piwork/internal/contracts"
	"piwork/internal/filehelper"
	"piwork/internal/fileprotocol"
)

const Allow = "OPTIONS, PROPFIND, GET, HEAD, PUT, MKCOL, COPY, MOVE, DELETE, PROPPATCH"
const MaxMetadata = 16 << 20
const MaxXML = 64 << 10

var rawPrefix = regexp.MustCompile(`^/api/v1/works/([^/?#]+)/files(?:[/?#]|$)`)
var rawTarget = regexp.MustCompile(`(?s)^/api/v1/works/([A-Za-z0-9-]{16,128})/files(/.*)?$`)
var suffixRange = regexp.MustCompile(`^bytes=-(\d+)$`)
var spanRange = regexp.MustCompile(`^bytes=(\d+)-(\d*)$`)

func fail(code string) error      { return fileprotocol.Failure(code) }
func IsRawTarget(raw string) bool { return rawPrefix.MatchString(raw) }
func RawWorkID(raw string) string {
	match := rawPrefix.FindStringSubmatch(raw)
	if match == nil {
		return ""
	}
	return match[1]
}

type Target struct {
	WorkID                          string
	Segments                        []string
	RootWithoutSlash, TrailingSlash bool
	EncodedPath                     string
}

// RequestURI is parsed before URL normalization and percent-decoded once.
func ParseTarget(raw string) (Target, error) {
	if strings.ContainsAny(raw, "?#") {
		return Target{}, fail("FILE_PATH_INVALID")
	}
	match := rawTarget.FindStringSubmatch(raw)
	if match == nil {
		return Target{}, fail("FILE_PATH_INVALID")
	}
	target := Target{WorkID: match[1], Segments: []string{}, RootWithoutSlash: match[2] == "", TrailingSlash: strings.HasSuffix(match[2], "/")}
	if match[2] != "" && match[2] != "/" {
		pieces := strings.Split(strings.TrimPrefix(match[2], "/"), "/")
		if target.TrailingSlash {
			pieces = pieces[:len(pieces)-1]
		}
		if len(pieces) > 128 {
			return Target{}, fail("FILE_PATH_TOO_LONG")
		}
		for _, part := range pieces {
			decoded, err := url.PathUnescape(part)
			if err != nil {
				return Target{}, fail("FILE_PATH_INVALID")
			}
			target.Segments = append(target.Segments, decoded)
		}
		if err := filehelper.ValidateSegments(target.Segments); err != nil {
			return Target{}, err
		}
	}
	target.EncodedPath = Href(target.WorkID, target.Segments, target.TrailingSlash || target.RootWithoutSlash)
	return target, nil
}
func encodeComponent(value string) string {
	// Match encodeURIComponent, including parentheses/apostrophe/asterisk.
	const digits = "0123456789ABCDEF"
	var encoded strings.Builder
	for i := 0; i < len(value); i++ {
		b := value[i]
		if b >= 'a' && b <= 'z' || b >= 'A' && b <= 'Z' || b >= '0' && b <= '9' || strings.ContainsRune("-_.!~*'()", rune(b)) {
			encoded.WriteByte(b)
		} else {
			encoded.WriteByte('%')
			encoded.WriteByte(digits[b>>4])
			encoded.WriteByte(digits[b&15])
		}
	}
	return encoded.String()
}
func Href(workID string, parts []string, directory bool) string {
	encoded := make([]string, len(parts))
	for i, part := range parts {
		encoded[i] = encodeComponent(part)
	}
	value := "/api/v1/works/" + workID + "/files/" + strings.Join(encoded, "/")
	if directory && len(parts) > 0 {
		value += "/"
	}
	return value
}
func Destination(request *http.Request, sourceWorkID string) ([]string, error) {
	values := request.Header.Values("Destination")
	if len(values) != 1 || values[0] == "" || strings.ContainsAny(values[0], "?#") {
		return nil, fail("FILE_DESTINATION_DENIED")
	}
	raw := values[0]
	if !strings.HasPrefix(raw, "/") {
		position := strings.Index(raw, "://")
		if position < 0 {
			return nil, fail("FILE_DESTINATION_DENIED")
		}
		scheme, rest := strings.ToLower(raw[:position]), raw[position+3:]
		wanted := "http"
		if request.TLS != nil {
			wanted = "https"
		}
		slash := strings.Index(rest, "/")
		if scheme != wanted || slash <= 0 || !strings.EqualFold(rest[:slash], request.Host) {
			return nil, fail("FILE_DESTINATION_DENIED")
		}
		raw = rest[slash:]
	}
	target, err := ParseTarget(raw)
	if err != nil || target.WorkID != sourceWorkID {
		return nil, fail("FILE_DESTINATION_DENIED")
	}
	if len(target.Segments) == 0 {
		return nil, fail("FILE_ROOT_PROTECTED")
	}
	return target.Segments, nil
}
func ReadRange(value string) (any, error) {
	integer := func(text string) (int64, bool) {
		value, err := strconv.ParseInt(text, 10, 64)
		return value, err == nil && value >= 0 && value <= contracts.MaxSafeInteger
	}
	if match := suffixRange.FindStringSubmatch(value); match != nil {
		size, valid := integer(match[1])
		if valid && size > 0 {
			return map[string]any{"suffix": size}, nil
		}
	}
	if match := spanRange.FindStringSubmatch(value); match != nil {
		start, valid := integer(match[1])
		var end any
		if match[2] != "" {
			number, ok := integer(match[2])
			valid = valid && ok && number >= start
			end = number
		}
		if valid {
			return map[string]any{"start": start, "end": end}, nil
		}
	}
	return nil, fail("FILE_RANGE_UNSATISFIABLE")
}
