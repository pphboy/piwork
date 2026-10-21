package webapp

import (
	"io"
	"mime"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"strings"
	"testing"
)

// These patterns cover the static resource syntax emitted by the WebUI build,
// including image tags inside JavaScript templates. They deliberately do not
// treat navigation links, API calls or runtime-generated URLs as static assets.
var (
	moduleAssetReference = regexp.MustCompile(`(?m)^\s*(?:import\s+(?:[^;]*?\s+from\s+)?|export\s+[^;]*?\s+from\s+)["']([^"']+)["']`)
	markupAssetReference = regexp.MustCompile(`(?i)<(?:script|link|img|source)\b[^>]*?\s(?:src|href)\s*=\s*["']([^"']+)["']`)
	cssAssetReference    = regexp.MustCompile(`(?:url\(\s*["']?|@import\s+["'])([^"'()\s;]+)`)
)

func TestBrowserAssetReferenceSyntax(t *testing.T) {
	for _, test := range []struct {
		name    string
		pattern *regexp.Regexp
		source  string
		want    string
	}{
		{"modules", moduleAssetReference, `import { first,
 second } from './components.js';
import './side-effect.js';
export { pendingDots } from './pending.js';
export * from './shared.js';`, "./components.js,./side-effect.js,./pending.js,./shared.js"},
		{"markup", markupAssetReference, `<link rel="stylesheet" href="/setup/style.css"><script type="module" src="/setup/browser/onboarding.js"></script><img src="/setup/piwork-logo.png"><a href="/login">Sign in</a>`, "/setup/style.css,/setup/browser/onboarding.js,/setup/piwork-logo.png"},
		{"css", cssAssetReference, `@import './theme.css'; @import url("./nested.css"); .logo { background: url("../logo.png"); }`, "./theme.css,./nested.css,../logo.png"},
	} {
		t.Run(test.name, func(t *testing.T) {
			var references []string
			for _, match := range test.pattern.FindAllStringSubmatch(test.source, -1) {
				references = append(references, match[1])
			}
			if got := strings.Join(references, ","); got != test.want {
				t.Fatalf("asset references = %q, want %q", got, test.want)
			}
		})
	}
}

func assertBrowserAssetGraph(t *testing.T, client *http.Client, entry string) {
	t.Helper()
	root, err := url.Parse(entry)
	if err != nil {
		t.Fatal(err)
	}
	seen, types := map[string]bool{}, map[string]int{}
	var visit func(*url.URL, string)
	visit = func(asset *url.URL, parent string) {
		t.Helper()
		asset.Fragment = ""
		if seen[asset.String()] {
			return
		}
		seen[asset.String()] = true
		response, err := client.Get(asset.String())
		if err != nil {
			t.Fatalf("asset %s referenced by %s: %v", asset.Path, parent, err)
		}
		body, err := io.ReadAll(response.Body)
		response.Body.Close()
		if err != nil || response.StatusCode != http.StatusOK || len(body) == 0 {
			t.Fatalf("asset %s referenced by %s: status=%d, bytes=%d, read error=%v", asset.Path, parent, response.StatusCode, len(body), err)
		}
		want := mime.TypeByExtension(path.Ext(asset.Path))
		if asset.String() == root.String() {
			want = "text/html"
		} else if path.Ext(asset.Path) == ".js" {
			want = "text/javascript"
		}
		want, _, _ = mime.ParseMediaType(want)
		got, _, err := mime.ParseMediaType(response.Header.Get("Content-Type"))
		if err != nil || want == "" || got != want {
			t.Fatalf("asset %s referenced by %s: Content-Type=%q, want %q", asset.Path, parent, response.Header.Get("Content-Type"), want)
		}
		types[got]++
		var patterns []*regexp.Regexp
		switch got {
		case "text/html":
			patterns = []*regexp.Regexp{markupAssetReference}
		case "text/javascript":
			patterns = []*regexp.Regexp{moduleAssetReference, markupAssetReference}
		case "text/css":
			patterns = []*regexp.Regexp{cssAssetReference}
		}
		for _, pattern := range patterns {
			for _, match := range pattern.FindAllSubmatch(body, -1) {
				reference := string(match[1])
				if strings.HasPrefix(reference, "data:") || strings.HasPrefix(reference, "#") || strings.Contains(reference, "${") {
					continue
				}
				target, err := url.Parse(reference)
				if err != nil {
					t.Fatalf("invalid asset reference %q in %s: %v", reference, asset.Path, err)
				}
				base := asset
				if got == "text/javascript" && pattern == markupAssetReference {
					base = root // Rendered template URLs resolve against the document.
				}
				target = base.ResolveReference(target)
				if target.Scheme != root.Scheme || target.Host != root.Host {
					t.Fatalf("asset %s references non-local resource %s", asset.Path, target)
				}
				visit(target, asset.Path)
			}
		}
	}
	visit(root, "entry page")
	for _, required := range []string{"text/javascript", "text/css", "image/png"} {
		if types[required] == 0 {
			t.Errorf("entry %s did not exercise any %s assets", root.Path, required)
		}
	}
	t.Logf("verified %d resources reachable from %s", len(seen), root.Path)
}
