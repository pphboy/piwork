package cli

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"piwork/internal/client"
	"piwork/internal/pipackage"
)

func TestNativeConsolePackageInputsStageValidateAndUpload(t *testing.T) {
	var uploads atomic.Int32
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/me" {
			_, _ = io.WriteString(w, `{"id":"user-1","account":"owner","role":"admin"}`)
			return
		}
		if r.URL.Path != "/api/v1/admin/package-uploads" || r.Header.Get("Authorization") != "Bearer core-token" {
			t.Error("unexpected Console package Core request", r.URL.Path)
			w.WriteHeader(404)
			return
		}
		content, _ := io.ReadAll(r.Body)
		sum := sha256.Sum256(content)
		if hex.EncodeToString(sum[:]) != r.Header.Get("X-Piwork-Sha256") ||
			r.Header.Get("X-Piwork-Package-Name") != "tools.zip" ||
			!strings.Contains("|zip|local|", "|"+r.Header.Get("X-Piwork-Package-Source")+"|") {
			t.Error("Console package upload metadata changed")
		}
		uploads.Add(1)
		w.WriteHeader(201)
		_, _ = io.WriteString(w, `{"uploadId":"upload-1","expiresAt":"2099-01-01T00:00:00Z"}`)
	}))
	defer core.Close()
	root := t.TempDir()
	c := &nativeConsole{options: consoleOptions{coreURL: core.URL, publicOrigin: "https://console.example:7173", dataDir: root},
		sessions: map[string]consoleSession{"local": {token: "core-token", csrf: "csrf", user: client.Identity{ID: "user-1", Account: "owner", Role: "admin"}, expiresAt: time.Now().Add(time.Hour)}}}
	call := func(kind, contentType, filename string, content []byte) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest("POST", c.options.publicOrigin+"/console/api/package-inputs/"+kind, bytes.NewReader(content))
		r.Header.Set("Cookie", consoleSessionCookie+"=local")
		r.Header.Set("Origin", c.options.publicOrigin)
		r.Header.Set("X-Csrf-Token", "csrf")
		r.Header.Set("Content-Type", contentType)
		if filename != "" {
			r.Header.Set("X-Piwork-Package-Name", filename)
		}
		w := httptest.NewRecorder()
		c.ServeHTTP(w, r)
		return w
	}
	treeRoot := filepath.Join(root, "source")
	if err := os.Mkdir(treeRoot, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(treeRoot, "package.json"), []byte(`{"name":"tools","version":"1.0.0"}`), 0600); err != nil {
		t.Fatal(err)
	}
	tree, err := pipackage.OpenTree(context.Background(), treeRoot)
	if err != nil {
		t.Fatal(err)
	}
	packedName := filepath.Join(root, "input.zip")
	if _, err := pipackage.PackArchive(context.Background(), tree, packedName); err != nil {
		t.Fatal(err)
	}
	tree.Close()
	packed, err := os.ReadFile(packedName)
	if err != nil {
		t.Fatal(err)
	}
	response := call("zip", "application/zip", "tools.zip", packed)
	if response.Code != 201 || !strings.Contains(response.Body.String(), `"uploadId":"upload-1"`) || uploads.Load() != 1 {
		t.Fatal("Console ZIP package upload failed", response.Code, response.Body.String())
	}
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	if err := writer.WriteField("directoryName", "tools.zip"); err != nil {
		t.Fatal(err)
	}
	file, err := writer.CreateFormFile("files", "package.json")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = file.Write([]byte(`{"name":"tools","version":"1.0.0"}`))
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	response = call("directory", writer.FormDataContentType(), "", body.Bytes())
	if response.Code != 201 || uploads.Load() != 2 {
		t.Fatal("Console directory package upload failed", response.Code, response.Body.String())
	}
	response = call("zip", "application/zip", "tools.zip", []byte("invalid archive"))
	if response.Code != 400 || uploads.Load() != 2 {
		t.Fatal("invalid ZIP reached Core", response.Code, response.Body.String())
	}
	response = call("zip", "text/plain", "tools.zip", packed)
	if response.Code != 415 || uploads.Load() != 2 {
		t.Fatal("wrong upload media type reached Core", response.Code, response.Body.String())
	}
	entries, err := os.ReadDir(filepath.Join(root, "staging"))
	if err != nil || len(entries) != 0 {
		t.Fatal("Console package staging was not cleaned", entries, err)
	}
}
