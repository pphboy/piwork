package bootcsp_test

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"io/fs"
	"strings"
	"testing"
	"testing/fstest"

	"piwork/internal/bootcsp"
	"piwork/internal/consoleassets"
	"piwork/internal/desktopassets"
)

func TestEmbeddedPoliciesMatchEachWatchdog(t *testing.T) {
	for _, test := range []struct {
		name string
		fs   fs.FS
		path string
	}{
		{"desktop", desktopassets.FS, "static/public/index.html"},
		{"console", consoleassets.FS, "static/public/index.html"},
		{"setup", consoleassets.FS, "static/public/setup.html"},
	} {
		t.Run(test.name, func(t *testing.T) {
			html, err := fs.ReadFile(test.fs, test.path)
			if err != nil {
				t.Fatal(err)
			}
			start := bytes.Index(html, []byte("<script data-boot-watchdog "))
			if start < 0 {
				t.Fatal("watchdog missing")
			}
			start += bytes.IndexByte(html[start:], '>') + 1
			end := bytes.Index(html[start:], []byte("</script>"))
			if end < 0 {
				t.Fatal("watchdog not closed")
			}
			digest := sha256.Sum256(html[start : start+end])
			expected := "'sha256-" + base64.StdEncoding.EncodeToString(digest[:]) + "'"
			policy := bootcsp.Policy("default-src 'none'; script-src 'self'; style-src 'self'", test.fs)
			if !strings.Contains(policy, expected) || strings.Contains(policy, "unsafe-inline") {
				t.Fatalf("unexpected policy %q", policy)
			}
		})
	}
}

func TestMissingOrInvalidHashDoesNotBroadenPolicy(t *testing.T) {
	const policy = "default-src 'none'; script-src 'self'"
	for _, assets := range []fs.FS{fstest.MapFS{}, fstest.MapFS{"static/public/boot-csp.txt": &fstest.MapFile{Data: []byte("not-a-hash")}}} {
		if got := bootcsp.Policy(policy, assets); got != policy {
			t.Fatalf("unexpected policy %q", got)
		}
	}
}
