package bootrecovery

import (
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestNativeRecoveryRestoresExactTarget(t *testing.T) {
	for _, address := range []string{"/", "/?", "/works/work-1?view=one%20two&tag=a&tag=b&=empty&bare", "/login?returnTo=%2Fservices%2Fw%2Fs%2F8080%2F%3Fq%3D%2522", "/admin/setup?step=prepare"} {
		t.Run(address, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodGet, "http://localhost"+address, nil)
			encoded := base64.RawURLEncoding.EncodeToString([]byte(address))
			body := string(HTML([]byte(`<form method="get"><!-- PIWORK_BOOT_RECOVERY --><button>Reload</button></form>`), r))
			if !strings.Contains(body, `name="`+field+`" value="`+encoded+`"`) || strings.Contains(body, "<!-- PIWORK_BOOT_RECOVERY -->") {
				t.Fatal("original target missing", body)
			}
			u, _ := url.ParseRequestURI(address)
			retry := httptest.NewRequest(http.MethodGet, "http://localhost"+u.EscapedPath()+"?"+field+"="+encoded, nil)
			// Console's internal URL omits /admin; RequestURI retains the public path.
			if strings.HasPrefix(u.Path, "/admin/") {
				retry.URL.Path = strings.TrimPrefix(u.Path, "/admin")
			}
			w := httptest.NewRecorder()
			if !Redirect(w, retry) || w.Code != http.StatusSeeOther || w.Header().Get("Location") != address || w.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("recovery changed the original target", w.Code, w.Header())
			}
		})
	}
}

func TestRecoveryRejectsOtherTargetsAndNestedRecovery(t *testing.T) {
	for _, address := range []string{"https://example.invalid/login", "//example.invalid/login", "/other", "/login#target", "/login?x=one\r\nInjected: value", "/login?" + field + "=L2xvZ2lu"} {
		r := httptest.NewRequest(http.MethodGet, "http://localhost/login?"+field+"="+base64.RawURLEncoding.EncodeToString([]byte(address)), nil)
		w := httptest.NewRecorder()
		if !Redirect(w, r) || w.Code != http.StatusBadRequest || w.Header().Get("Location") != "" {
			t.Fatal("unsafe recovery target accepted", address, w.Code, w.Header())
		}
	}
}

func TestRecoveryDoesNotInterceptOtherReadsOrWrites(t *testing.T) {
	for _, request := range []struct{ method, query string }{{"GET", "view=one"}, {"GET", field + "=original&view=one"}, {"POST", field + "=L2xvZ2lu"}} {
		w := httptest.NewRecorder()
		if Redirect(w, httptest.NewRequest(request.method, "http://localhost/login?"+request.query, nil)) {
			t.Fatal("ordinary request intercepted", request)
		}
	}
}
