//go:build integration

package coreapp

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

func TestNativePackagePeerFaultsPreserveFrozenCoreHead(t *testing.T) {
	a, base, auth, _, ctx := nativeApplyFixture(t)
	upload := func(label, manifest string, wantFailure string) string {
		t.Helper()
		source := packageZip(t, map[string]string{"package.json": manifest})
		sum := sha256.Sum256(source)
		request, err := http.NewRequestWithContext(ctx, "POST", base+"/api/v1/admin/package-uploads", bytes.NewReader(source))
		if err != nil {
			t.Fatal(err)
		}
		request.Header.Set("Authorization", auth)
		request.Header.Set("Content-Type", "application/zip")
		request.Header.Set("X-Piwork-Sha256", hex.EncodeToString(sum[:]))
		request.Header.Set("X-Piwork-Package-Source", "zip")
		request.Header.Set("X-Piwork-Package-Name", label+".zip")
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		var result map[string]any
		if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
			t.Fatal(err)
		}
		if response.StatusCode != 201 {
			if wantFailure != "" && result["code"] == wantFailure {
				return ""
			}
			t.Fatal("source upload classification", response.StatusCode, result)
		}
		return result["uploadId"].(string)
	}
	install := func(uploadID, key string, update bool) string {
		t.Helper()
		path := "/api/v1/admin/packages"
		if update {
			path += "/peer-proof/update"
		}
		status, result := packageHTTPCall(t, base, path, "POST", auth, map[string]any{"source": map[string]string{"kind": "upload", "uploadId": uploadID}, "idempotencyKey": key})
		if status != 202 {
			t.Fatal(status, result)
		}
		return result["operationId"].(string)
	}
	original := upload("valid", `{"name":"peer-proof","version":"1.0.0","peerDependencies":{"@earendil-works/pi-coding-agent":"^0.86.1"}}`, "")
	waitWorkOperation(t, ctx, a, install(original, "valid-peer", false))
	for _, fixture := range []struct{ key, manifest, code string }{
		{"future-peer", `{"name":"peer-proof","version":"2.0.0","peerDependencies":{"@earendil-works/pi-coding-agent":">=0.99.0"}}`, "PI_PACKAGE_SDK_VERSION_UNSUPPORTED"},
		{"invalid-peer", `{"name":"peer-proof","version":"2.0.0","peerDependencies":{"@earendil-works/pi-coding-agent":"not a semver range"}}`, "PI_PACKAGE_INVALID_MANIFEST"},
		{"host-dependency", `{"name":"peer-proof","version":"2.0.0","dependencies":{"@earendil-works/pi-ai":"0.86.1"}}`, "PI_PACKAGE_INVALID_MANIFEST"},
	} {
		t.Run(fixture.key, func(t *testing.T) {
			source := upload(fixture.key, fixture.manifest, fixture.code)
			if source != "" {
				id := install(source, fixture.key, true)
				op := waitApplyFailure(t, ctx, a, id)
				if op.ErrorJSON == nil {
					t.Fatal("missing fault classification")
				}
				var diagnostic map[string]any
				if json.Unmarshal([]byte(*op.ErrorJSON), &diagnostic) != nil || diagnostic["code"] != fixture.code {
					t.Fatal("incorrect package error", diagnostic)
				}
				if strings.Contains(*op.ErrorJSON, "stderr") || strings.Contains(*op.ErrorJSON, a.options.DataDirectory) {
					t.Fatal("raw diagnostic escaped")
				}
			}
			status, head := packageHTTPCall(t, base, "/api/v1/admin/packages/peer-proof", "GET", auth, nil)
			if status != 200 || head["version"] != "1.0.0" {
				t.Fatal("failed peer replacement changed frozen head", status, head)
			}
		})
	}
}
