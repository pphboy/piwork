package pipackage

import (
	"golang.org/x/net/idna"
	"net/url"
	"path"
	"regexp"
	"strconv"
	"strings"
)

type Source struct {
	Kind        string  `json:"kind"`
	Spec        string  `json:"spec,omitempty"`
	URL         string  `json:"url,omitempty"`
	Ref         *string `json:"ref,omitempty"`
	Path        string  `json:"path,omitempty"`
	DisplayName string  `json:"displayName,omitempty"`
}

var npmSource = regexp.MustCompile(`^((?:@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*)(?:@([^@/\s]+))?$`)

func ParseSource(argument string) (Source, error) {
	if argument == "" || strings.TrimSpace(argument) != argument {
		return Source{}, ErrSource
	}
	for _, c := range argument {
		if c < 32 || c == 127 {
			return Source{}, ErrSource
		}
	}
	if strings.HasPrefix(argument, "npm:") {
		spec := strings.TrimPrefix(argument, "npm:")
		parts := npmSource.FindStringSubmatch(spec)
		if len(parts) == 0 || !ValidName(parts[1]) || jsLength(spec) > 4096 {
			return Source{}, ErrSource
		}
		return Source{Kind: "npm", Spec: spec}, nil
	}
	if strings.HasPrefix(argument, "git:") {
		spec := strings.TrimPrefix(argument, "git:")
		source := spec
		var ref *string
		if split := strings.LastIndex(spec, "@"); split > 0 {
			source = spec[:split]
			value := spec[split+1:]
			ref = &value
			if value == "" {
				return Source{}, ErrSource
			}
		}
		if jsLength(spec) > 4096 || strings.Contains(source, "\\") {
			return Source{}, ErrSource
		}
		for _, c := range spec {
			if c <= 32 {
				return Source{}, ErrSource
			}
		}
		if strings.Contains(source, "://") && !strings.HasPrefix(source, "https://") {
			return Source{}, ErrSource
		}
		if !strings.HasPrefix(source, "https://") {
			source = "https://" + source
		}
		parsed, err := url.Parse(source)
		if err != nil || parsed.Scheme != "https" || parsed.Hostname() == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
			return Source{}, ErrSource
		}
		host, err := idna.Lookup.ToASCII(strings.ToLower(parsed.Hostname()))
		if err != nil {
			return Source{}, ErrSource
		}
		if strings.Contains(host, ":") {
			host = "[" + host + "]"
		}
		if port := parsed.Port(); port != "" {
			n, err := strconv.ParseUint(port, 10, 16)
			if err != nil {
				return Source{}, ErrSource
			}
			if n != 443 {
				host += ":" + strconv.FormatUint(n, 10)
			}
		}
		parsed.Host = host
		// WHATWG dot-segment removal preserves empty segments and escaped
		// slashes. Decoding the entire path before cleaning changes Git identity.
		var segments []string
		rawSegments := strings.Split(parsed.EscapedPath(), "/")
		for i, segment := range rawSegments[1:] {
			dot := strings.ReplaceAll(strings.ToLower(segment), "%2e", ".")
			if dot == ".." {
				if len(segments) > 0 {
					segments = segments[:len(segments)-1]
				}
				if i == len(rawSegments)-2 {
					segments = append(segments, "")
				}
				continue
			}
			if dot == "." {
				if i == len(rawSegments)-2 {
					segments = append(segments, "")
				}
				continue
			}
			segments = append(segments, segment)
		}
		escaped := "/" + strings.Join(segments, "/")
		parsed.Path, err = url.PathUnescape(escaped)
		if err != nil {
			return Source{}, ErrSource
		}
		parsed.RawPath = escaped
		parts := strings.FieldsFunc(escaped, func(r rune) bool { return r == '/' })
		if len(parts) < 2 {
			return Source{}, ErrSource
		}
		normalized := parsed.String()
		if strings.HasSuffix(source, "#") {
			normalized += "#"
		}
		return Source{Kind: "git", Spec: spec, URL: normalized, Ref: ref}, nil
	}
	if strings.HasPrefix(argument, "./") || strings.HasPrefix(argument, "../") || strings.HasPrefix(argument, "/") {
		name := path.Base(argument)
		if name == "." || name == ".." || name == "/" {
			return Source{}, ErrSource
		}
		kind := "local"
		if strings.HasSuffix(strings.ToLower(argument), ".zip") {
			kind = "zip"
		}
		return Source{Kind: kind, Path: argument, DisplayName: name}, nil
	}
	return Source{}, ErrSource
}
