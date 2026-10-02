package cli

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"piwork/internal/client"
)

func TestNativeDesktopPiPackageBrowserUploadUsesWorkScope(t *testing.T) {
	var source, name string
	var uploads int
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer token" {
			w.WriteHeader(401)
			return
		}
		switch r.URL.Path {
		case "/api/v1/me":
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "user-1", "account": "owner", "role": "user"})
		case "/api/v1/works/work-1":
			_ = json.NewEncoder(w).Encode(map[string]string{"id": "work-1", "name": "Demo"})
		case "/api/v1/works/work-1/package-uploads":
			uploads++
			source = r.Header.Get("X-Piwork-Package-Source")
			name = r.Header.Get("X-Piwork-Package-Name")
			if r.Header.Get("Content-Type") != "application/zip" {
				t.Error("Core package media type")
			}
			_, _ = io.Copy(io.Discard, r.Body)
			w.WriteHeader(201)
			_, _ = io.WriteString(w, `{"uploadId":"upload-1","expiresAt":"2099-01-01T00:00:00Z"}`)
		default:
			w.WriteHeader(404)
		}
	}))
	defer core.Close()
	api, _ := client.New(core.URL, "")
	d := &nativeDesktop{api: api, store: client.CredentialStore{Path: filepath.Join(t.TempDir(), "credentials", "client.json")}, port: 17891, origin: "http://desktop.localhost:17891", sessions: map[string]desktopSession{"local": {id: "local", csrf: "csrf", end: time.Now().Add(time.Hour)}}, identity: desktopIdentity{coreURL: core.URL, credential: &client.Credential{CoreURL: core.URL, Token: "token", User: client.Identity{ID: "user-1"}}, checked: true}}
	defer func() {
		if d.transfers != nil {
			d.transfers.clear()
		}
	}()
	send := func(kind, filename string, content []byte) *httptest.ResponseRecorder {
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		_ = writer.WriteField("kind", kind)
		field := "files"
		if kind == "zip" {
			field = "zip"
		}
		part, _ := writer.CreateFormFile(field, filename)
		_, _ = part.Write(content)
		_ = writer.Close()
		r := httptest.NewRequest("POST", "http://desktop.localhost:17891/_desktop/api/works/work-1/package-uploads", &body)
		r.Header.Set("Content-Type", writer.FormDataContentType())
		r.Header.Set("Cookie", d.cookieName()+"=local")
		r.Header.Set("X-Piwork-Csrf", "csrf")
		response := httptest.NewRecorder()
		d.ServeHTTP(response, r)
		return response
	}
	if result := send("local", "demo/package.json", []byte(`{"name":"demo","version":"1.0.0"}`)); result.Code != 201 || !strings.Contains(result.Body.String(), "upload-1") {
		t.Fatal("local upload", result.Code, result.Body.String())
	}
	if source != "local" || name != "demo" {
		t.Fatal("local source", source, name)
	}
	var archive bytes.Buffer
	zipWriter := zip.NewWriter(&archive)
	entry, _ := zipWriter.Create("package.json")
	_, _ = entry.Write([]byte(`{"name":"demo","version":"1.0.0"}`))
	_ = zipWriter.Close()
	if result := send("zip", "demo.zip", archive.Bytes()); result.Code != 201 {
		t.Fatal("ZIP upload", result.Code, result.Body.String())
	}
	if source != "zip" || name != "demo.zip" || uploads != 2 {
		t.Fatal("ZIP source", source, name, uploads)
	}
	if result := send("local", "../escape/package.json", []byte(`{"name":"demo"}`)); result.Code == 201 {
		t.Fatal("unsafe path accepted")
	}
}
