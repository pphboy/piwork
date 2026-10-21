package cli

import (
	"net/http"
	"net/url"
	"testing"
)

func TestHostedServicePathRejectsAmbiguousTargetsAndEscapes(t *testing.T) {
	for _, path := range []string{
		"/services/work-1/notes/80", "/services/work-1/notes/080/",
		"/services/work-1/notes/0/", "/services/work-1/notes/65536/",
		"/services/work%2fother/notes/80/", "/services/work-1/%6eotes/80/",
		"/services/work-1/notes/80/../_desktop/api/session",
		"/services/work-1/notes/80/%2e%2e/api/v1",
		"/services/work-1/notes/80/%252e%252e/",
		"/services/work-1/notes/80//api", "/services/work-1/notes/80/a%2fb",
		"/services/work-1/notes/80/a%5cb",
	} {
		if _, _, _, _, _, ok := ParseHostedServicePath(path); ok {
			t.Error("accepted ambiguous path", path)
		}
	}
	for _, tail := range []string{"", "api/v1/works", "_desktop/api/session", "works/work-1/files/a", "assets/%E4%B8%AD%20name.js"} {
		work, service, port, base, rest, ok := ParseHostedServicePath("/services/work-1/notes/8080/" + tail)
		if !ok || work != "work-1" || service != "notes" || port != 8080 || base != "/services/work-1/notes/8080/" || rest != "/"+tail {
			t.Error("application path not preserved", tail)
		}
	}
}

func TestHostedServiceRedirectsStayWithinTheirTarget(t *testing.T) {
	base := "/services/work-1/notes/80/"
	request, _ := url.Parse("/deep/page?old=1")
	for location, expected := range map[string]string{
		"/next?q=1#part":                    base + "next?q=1#part",
		"next":                              base + "deep/next",
		"../next":                           base + "next",
		"../../../../admin":                 base + "admin",
		base + "next?q=1":                   base + "next?q=1",
		"http://notes.w-12345678.work/next": base + "next",
		"//notes.w-12345678.work/next":      base + "next",
		"http://server:17891" + base + "go": base + "go",
		"https://external.example/next?q=1": "https://external.example/next?q=1",
		"mailto:hello@example.com":          "mailto:hello@example.com",
		"?fresh=1":                          base + "deep/page?fresh=1",
	} {
		actual, err := hostedServiceLocation(location, request, "http://server:17891", "http://notes.w-12345678.work", base)
		if err != nil || actual != expected {
			t.Errorf("%q: got %q, want %q (%v)", location, actual, expected, err)
		}
	}
}

func TestServiceEmbedPolicyDistinguishesHostedAndIndependentOrigins(t *testing.T) {
	for _, policy := range []http.Header{{"X-Frame-Options": {"SAMEORIGIN"}}, {"Content-Security-Policy": {"frame-ancestors 'self'"}}} {
		if serviceEmbedPolicy(policy, "http://server:17891", true) != "allowed" {
			t.Fatal("same-origin embedding incorrectly rejected")
		}
		if serviceEmbedPolicy(policy, "http://server:17891", false) != "blocked" {
			t.Fatal("independent Desktop must honor application framing restriction")
		}
	}
	for _, policy := range []http.Header{{"X-Frame-Options": {"DENY"}}, {"Content-Security-Policy": {"frame-ancestors 'none'"}}, {"Content-Security-Policy": {"frame-ancestors https://elsewhere.test"}}} {
		if serviceEmbedPolicy(policy, "http://server:17891", true) != "blocked" {
			t.Fatal("application framing policy bypassed")
		}
	}
}
