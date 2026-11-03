package coreapp

import (
	"net/http"
	"net/url"
)

// modelTestContextHeaders carries only a fresh anonymous Test identity. It
// never receives authentication, user identities, or persistent Session state.
func modelTestContextHeaders(api string, target *url.URL, testID, version string) http.Header {
	headers := http.Header{"User-Agent": {"piwork/" + version}}
	if target == nil || target.Scheme != "https" || target.Hostname() != "opencode.ai" || target.User != nil || target.RawQuery != "" || target.Fragment != "" {
		return headers
	}
	if port := target.Port(); port != "" && port != "443" {
		return headers
	}
	path := target.EscapedPath()
	if api == "anthropic-messages" && path == "/inference/go/anthropic/v1/messages" || api == "openai-responses" && path == "/inference/go/openai/v1/responses" {
		headers.Set("x-opencode-session", testID)
	}
	return headers
}
