package contracts

import (
	"errors"
	"net"
	"net/url"
	"strings"
)

// NormalizeModelEndpoint gives private execution and portable preference binding the same identity.
func NormalizeModelEndpoint(value *string) (*string, error) {
	if value == nil {
		return nil, nil
	}
	u, err := url.Parse(*value)
	if err != nil || u.Host == "" || u.Scheme != "http" && u.Scheme != "https" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return nil, errors.New("invalid model endpoint")
	}
	u.Scheme = strings.ToLower(u.Scheme)
	host := strings.ToLower(u.Hostname())
	port := u.Port()
	if port == "80" && u.Scheme == "http" || port == "443" && u.Scheme == "https" {
		port = ""
	}
	if port != "" {
		u.Host = net.JoinHostPort(host, port)
	} else if strings.Contains(host, ":") {
		u.Host = "[" + host + "]"
	} else {
		u.Host = host
	}
	u = u.ResolveReference(&url.URL{Path: u.Path, RawPath: u.RawPath})
	endpoint := strings.TrimRight(u.String(), "/")
	return &endpoint, nil
}

// NormalizeProtocolModelEndpoint is for new connection input. Retained Work
// descriptors continue using NormalizeModelEndpoint to preserve their facts.
func NormalizeProtocolModelEndpoint(api string, value *string) (*string, error) {
	if value == nil {
		return nil, nil
	}
	trimmed := strings.TrimSpace(*value)
	endpoint, err := NormalizeModelEndpoint(&trimmed)
	if err != nil || endpoint == nil {
		return endpoint, err
	}
	if api == "anthropic-messages" {
		for strings.HasSuffix(*endpoint, "/v1") {
			normalized := strings.TrimSuffix(*endpoint, "/v1")
			endpoint = &normalized
		}
	}
	return endpoint, nil
}
