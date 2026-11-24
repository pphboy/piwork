package coreapp

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"piwork/internal/contracts"
	"piwork/internal/identity"
	"piwork/internal/skillartifact"
)

type contentFile struct {
	name, content string
}

func contentUpload(t *testing.T, base, authorization, method, directory string, files []contentFile) (int, map[string]any) {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	field, err := writer.CreateFormField("directoryName")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := field.Write([]byte(directory)); err != nil {
		t.Fatal(err)
	}
	for _, file := range files {
		part, err := writer.CreateFormFile("files", url.PathEscape(file.name))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := part.Write([]byte(file.content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	request, err := http.NewRequest(method, base+"/api/v1/admin/skills"+map[string]string{"POST": "", "PUT": "/" + directory}[method], bytes.NewReader(body.Bytes()))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", authorization)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	response, err := (&http.Client{Timeout: 30 * time.Second}).Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var result map[string]any
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	return response.StatusCode, result
}

func contentCall(t *testing.T, base, path, method, authorization string, body any) (int, map[string]any, http.Header) {
	t.Helper()
	var data io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		data = bytes.NewReader(raw)
	}
	request, err := http.NewRequest(method, base+path, data)
	if err != nil {
		t.Fatal(err)
	}
	if authorization != "" {
		request.Header.Set("Authorization", authorization)
	}
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := (&http.Client{Timeout: 30 * time.Second}).Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var result map[string]any
	if response.StatusCode != 204 {
		if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
			t.Fatal(err)
		}
	}
	return response.StatusCode, result, response.Header
}

func contentFixture(t *testing.T) (*Application, string, string, string) {
	t.Helper()
	a, base, _ := appFixture(t, Options{Initialization: Initialization{Administrator: &struct{ Account, Password string }{"admin", "development-fixture-pass"}}})
	login, err := a.Identity.Login(context.Background(), "admin", "development-fixture-pass", "fixture")
	if err != nil {
		t.Fatal(err)
	}
	authorization := "Bearer " + login.Token
	status, result := contentUpload(t, base, authorization, "POST", "content-skill", []contentFile{
		{name: "SKILL.md", content: "# Content Skill"},
		{name: "references/rules.md", content: "old rules"},
		{name: "assets/raw.bin", content: "\xff\xfe\x00"},
	})
	if status != 201 {
		t.Fatal(status, result)
	}
	return a, base, authorization, "content-skill"
}

func TestAdminSkillFileListAndReadBoundary(t *testing.T) {
	a, base, authorization, name := contentFixture(t)
	login, err := a.Identity.Login(context.Background(), "admin", "development-fixture-pass", "second")
	if err != nil {
		t.Fatal(err)
	}
	user, err := a.Identity.CreateUser(context.Background(), func() identity.Principal {
		s, err := a.Identity.Authenticate(context.Background(), login.Token)
		if err != nil {
			t.Fatal(err)
		}
		return s.Principal()
	}(), "content-user", "development-fixture-pass", "user")
	if err != nil {
		t.Fatal(err)
	}
	userLogin, err := a.Identity.Login(context.Background(), string(user.Account), "development-fixture-pass", "fixture")
	if err != nil {
		t.Fatal(err)
	}
	status, list, _ := contentCall(t, base, "/api/v1/admin/skills/"+name+"/files", "GET", authorization, nil)
	if status != 200 || len(list["files"].([]any)) != 3 {
		t.Fatal(status, list)
	}
	files := list["files"].([]any)
	paths := []string{"SKILL.md", "assets/raw.bin", "references/rules.md"}
	for i, entry := range files {
		item := entry.(map[string]any)
		if item["path"] != paths[i] || item["size"] == nil || len(item) != 2 {
			t.Fatal("file entry exposed more than path and size", item)
		}
	}
	if status, _, _ := contentCall(t, base, "/api/v1/admin/skills/"+name+"/files", "GET", "Bearer "+userLogin.Token, nil); status != 403 {
		t.Fatal("ordinary user read Skill files", status)
	}
	if status, _, _ := contentCall(t, base, "/api/v1/admin/skills/"+name+"/files", "GET", "", nil); status != 401 {
		t.Fatal("anonymous read Skill files", status)
	}
	if status, body, _ := contentCall(t, base, "/api/v1/admin/skills/missing-skill/files", "GET", authorization, nil); status != 404 || body["code"] != "SKILL_UNAVAILABLE" {
		t.Fatal(status, body)
	}
	if status, body, header := contentCall(t, base, "/api/v1/admin/skills/"+name+"/file?path=SKILL.md", "GET", authorization, nil); status != 200 || body["content"] != "# Content Skill" || header.Get("Cache-Control") != "no-store" {
		t.Fatal(status, body, header)
	}
	if status, body, _ := contentCall(t, base, "/api/v1/admin/skills/"+name+"/file?path=assets%2Fraw.bin", "GET", authorization, nil); status != 415 || body["code"] != "SKILL_FILE_NOT_TEXT" {
		t.Fatal(status, body)
	}
	if status, body, _ := contentCall(t, base, "/api/v1/admin/skills/"+name+"/file?path=missing.md", "GET", authorization, nil); status != 404 || body["code"] != "SKILL_FILE_NOT_FOUND" {
		t.Fatal(status, body)
	}
	for _, query := range []string{
		"path=..%2FSKILL.md", "path=%2FSKILL.md", "path=a%5Cb.md", "path=a%2F%2Fb.md",
		"path=", "path=a%00b", "path=" + strings.Repeat("a%2F", 65) + "file",
		"path=SKILL.md&path=other.md", "path=SKILL.md&other=1", "path=%zz",
	} {
		if status, body, _ := contentCall(t, base, "/api/v1/admin/skills/"+name+"/file?"+query, "GET", authorization, nil); status != 400 || body["code"] != "SKILL_FILE_INVALID" {
			t.Fatalf("path %q was not rejected: %d %v", query, status, body)
		}
	}
	// A second decode would turn %252e%252e into a parent segment; one decode
	// leaves a literal filename, which cannot escape and is simply absent.
	if status, body, _ := contentCall(t, base, "/api/v1/admin/skills/"+name+"/file?path=%252e%252e%252FSKILL.md", "GET", authorization, nil); status != 404 || body["code"] != "SKILL_FILE_NOT_FOUND" {
		t.Fatal(status, body)
	}
	if status, body, _ := contentCall(t, base, "/api/v1/admin/skills/"+name+"/disable", "POST", authorization, map[string]any{}); status != 200 || body["enabled"] != false {
		t.Fatal(status, body)
	}
	if status, body, _ := contentCall(t, base, "/api/v1/admin/skills/"+name+"/file?path=SKILL.md", "GET", authorization, nil); status != 200 || body["content"] != "# Content Skill" {
		t.Fatal("disabled Skill content was unavailable", status, body)
	}
	if status, body, _ := contentCall(t, base, "/api/v1/admin/skills", "GET", authorization, nil); status != 200 {
		t.Fatal(status, body)
	} else {
		for _, entry := range body["skills"].([]any) {
			item := entry.(map[string]any)
			for _, key := range []string{"content", "version", "resolvedDigest", "identity"} {
				if _, leaked := item[key]; leaked {
					t.Fatal("catalog projection leaked content or internal identity", item)
				}
			}
		}
	}
}

func TestAdminSkillFileSavePublishesCompleteSnapshot(t *testing.T) {
	_, base, authorization, name := contentFixture(t)
	read := func(path string) (string, string, int, map[string]any) {
		t.Helper()
		status, body, _ := contentCall(t, base, "/api/v1/admin/skills/"+name+"/file?path="+url.QueryEscape(path), "GET", authorization, nil)
		if status != 200 {
			return "", "", status, body
		}
		return body["content"].(string), body["version"].(string), status, body
	}
	_, version, _, _ := read("references/rules.md")
	status, saved, _ := contentCall(t, base, "/api/v1/admin/skills/"+name+"/file", "PUT", authorization, map[string]any{
		"path": "references/rules.md", "content": "new rules\n", "expectedVersion": version,
	})
	if status != 200 || saved["path"] != "references/rules.md" || saved["version"] != skillartifact.FileVersion([]byte("new rules\n")) {
		t.Fatal(status, saved)
	}
	if content, current, _, _ := read("references/rules.md"); content != "new rules\n" || current != saved["version"] {
		t.Fatal("saved content was not durable", content, current)
	}
	if content, _, _, _ := read("SKILL.md"); content != "# Content Skill" {
		t.Fatal("unrelated file changed")
	}
	if status, body, _ := contentCall(t, base, "/api/v1/admin/skills/"+name+"/file", "PUT", authorization, map[string]any{
		"path": "references/rules.md", "content": "stale", "expectedVersion": version,
	}); status != 409 || body["code"] != "SKILL_FILE_CONFLICT" {
		t.Fatal("stale version was not rejected", status, body)
	}
	if content, _, _, _ := read("references/rules.md"); content != "new rules\n" {
		t.Fatal("conflict overwrote confirmed content")
	}
	_, manifestVersion, _, _ := read("SKILL.md")
	if status, body, _ := contentCall(t, base, "/api/v1/admin/skills/"+name+"/file", "PUT", authorization, map[string]any{
		"path": "SKILL.md", "content": "# Updated manifest", "expectedVersion": manifestVersion,
	}); status != 200 {
		t.Fatal(status, body)
	}
	if content, _, _, _ := read("references/rules.md"); content != "new rules\n" {
		t.Fatal("saving another file dropped the earlier update")
	}
	for _, test := range []struct {
		name string
		body map[string]any
		code string
	}{
		{"missing file", map[string]any{"path": "missing.md", "content": "x", "expectedVersion": version}, "SKILL_FILE_NOT_FOUND"},
		{"binary target", map[string]any{"path": "assets/raw.bin", "content": "x", "expectedVersion": skillartifact.FileVersion([]byte("\xff\xfe\x00"))}, "SKILL_FILE_NOT_TEXT"},
		{"invalid path", map[string]any{"path": "../SKILL.md", "content": "x", "expectedVersion": version}, "SKILL_FILE_INVALID"},
		{"missing version", map[string]any{"path": "SKILL.md", "content": "x"}, "SKILL_FILE_INVALID"},
	} {
		t.Run(test.name, func(t *testing.T) {
			status, body, _ := contentCall(t, base, "/api/v1/admin/skills/"+name+"/file", "PUT", authorization, test.body)
			if status != map[string]int{"SKILL_FILE_NOT_FOUND": 404, "SKILL_FILE_NOT_TEXT": 415, "SKILL_FILE_INVALID": 400}[test.code] || body["code"] != test.code {
				t.Fatal(status, body)
			}
		})
	}
	_, version, _, _ = read("SKILL.md")
	if status, body, _ := contentCall(t, base, "/api/v1/admin/skills/"+name+"/file", "PUT", authorization, map[string]any{
		"path": "SKILL.md", "content": strings.Repeat("x", (8<<20)+1), "expectedVersion": version,
	}); status != 413 || body["code"] != "SKILL_UPLOAD_LIMIT_EXCEEDED" {
		t.Fatal(status, body)
	}
	if content, _, _, _ := read("SKILL.md"); content != "# Updated manifest" {
		t.Fatal("failed save changed the artifact")
	}
	// A rejected save must release its upload slot and leave the next save usable.
	_, version, _, _ = read("SKILL.md")
	if status, body, _ := contentCall(t, base, "/api/v1/admin/skills/"+name+"/file", "PUT", authorization, map[string]any{
		"path": "SKILL.md", "content": "# After failure", "expectedVersion": version,
	}); status != 200 {
		t.Fatal("upload slot was not released after a rejected save", status, body)
	}
	if content, _, _, _ := read("SKILL.md"); content != "# After failure" {
		t.Fatal("save after a rejected save was not durable")
	}
	wrongType, _ := json.Marshal(map[string]any{"path": "SKILL.md", "content": "# Wrong type", "expectedVersion": version})
	request, _ := http.NewRequest("PUT", base+"/api/v1/admin/skills/"+name+"/file", bytes.NewReader(wrongType))
	request.Header.Set("Authorization", authorization)
	request.Header.Set("Content-Type", "text/plain")
	response, err := (&http.Client{Timeout: 30 * time.Second}).Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var body map[string]any
	_ = json.NewDecoder(response.Body).Decode(&body)
	if response.StatusCode != 415 || body["code"] != "UNSUPPORTED_MEDIA_TYPE" {
		t.Fatal(response.StatusCode, body)
	}
}

func TestAdminSkillFileSavePersistsAcrossCoreRestart(t *testing.T) {
	directory := t.TempDir()
	start := func(initialization Initialization) (*Application, string) {
		t.Helper()
		a, err := New(context.Background(), Options{DataDirectory: directory, Initialization: initialization})
		if err != nil {
			t.Fatal(err)
		}
		address, err := a.Listen(ListenAddress{"127.0.0.1", 0})
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
			defer cancel()
			if err := a.Close(ctx); err != nil {
				t.Error(err)
			}
		})
		return a, address.URL()
	}
	a, base := start(Initialization{Administrator: &struct{ Account, Password string }{"admin", "development-fixture-pass"}})
	login, err := a.Identity.Login(context.Background(), "admin", "development-fixture-pass", "fixture")
	if err != nil {
		t.Fatal(err)
	}
	authorization := "Bearer " + login.Token
	if status, result := contentUpload(t, base, authorization, "POST", "restart-skill", []contentFile{{name: "SKILL.md", content: "# Before"}}); status != 201 {
		t.Fatal(status, result)
	}
	_, body, _ := contentCall(t, base, "/api/v1/admin/skills/restart-skill/file?path=SKILL.md", "GET", authorization, nil)
	status, saved, _ := contentCall(t, base, "/api/v1/admin/skills/restart-skill/file", "PUT", authorization, map[string]any{
		"path": "SKILL.md", "content": "# After restart", "expectedVersion": body["version"],
	})
	if status != 200 {
		t.Fatal(status, saved)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	if err := a.Close(ctx); err != nil {
		cancel()
		t.Fatal(err)
	}
	cancel()
	a2, base2 := start(Initialization{})
	login2, err := a2.Identity.Login(context.Background(), "admin", "development-fixture-pass", "fixture")
	if err != nil {
		t.Fatal(err)
	}
	status, persisted, _ := contentCall(t, base2, "/api/v1/admin/skills/restart-skill/file?path=SKILL.md", "GET", "Bearer "+login2.Token, nil)
	if status != 200 || persisted["content"] != "# After restart" || persisted["version"] != saved["version"] {
		t.Fatal("saved file did not survive Core restart", status, persisted, saved)
	}
}

func TestAdminSkillFileSaveRejectsDirectoryUpdateCompetition(t *testing.T) {
	_, base, authorization, name := contentFixture(t)
	_, readBody, _ := contentCall(t, base, "/api/v1/admin/skills/"+name+"/file?path=references%2Frules.md", "GET", authorization, nil)
	version := readBody["version"].(string)
	status, result := contentUpload(t, base, authorization, "PUT", name, []contentFile{
		{name: "SKILL.md", content: "# Content Skill"},
		{name: "references/rules.md", content: "directory update"},
		{name: "assets/raw.bin", content: "\xff\xfe\x00"},
	})
	if status != 200 {
		t.Fatal(status, result)
	}
	if status, body, _ := contentCall(t, base, "/api/v1/admin/skills/"+name+"/file", "PUT", authorization, map[string]any{
		"path": "references/rules.md", "content": "edit", "expectedVersion": version,
	}); status != 409 || body["code"] != "SKILL_FILE_CONFLICT" {
		t.Fatal(status, body)
	}
	status, result = contentUpload(t, base, authorization, "PUT", name, []contentFile{
		{name: "SKILL.md", content: "# Content Skill"},
	})
	if status != 200 {
		t.Fatal(status, result)
	}
	if status, body, _ := contentCall(t, base, "/api/v1/admin/skills/"+name+"/file", "PUT", authorization, map[string]any{
		"path": "references/rules.md", "content": "edit", "expectedVersion": version,
	}); status != 404 || body["code"] != "SKILL_FILE_NOT_FOUND" {
		t.Fatal(status, body)
	}
}

func TestAdminSkillFileSaveRevokedDuringBodyReadDoesNotPublish(t *testing.T) {
	a, base, _ := appFixture(t, Options{Initialization: Initialization{Administrator: &struct{ Account, Password string }{"admin", "development-fixture-pass"}}})
	login, err := a.Identity.Login(context.Background(), "admin", "development-fixture-pass", "fixture")
	if err != nil {
		t.Fatal(err)
	}
	token := login.Token
	authorization := "Bearer " + token
	reader, err := a.Identity.CreateUser(context.Background(), func() identity.Principal {
		s, err := a.Identity.Authenticate(context.Background(), login.Token)
		if err != nil {
			t.Fatal(err)
		}
		return s.Principal()
	}(), "content-reader", "development-fixture-pass", "admin")
	if err != nil {
		t.Fatal(err)
	}
	readerLogin, err := a.Identity.Login(context.Background(), string(reader.Account), "development-fixture-pass", "fixture")
	if err != nil {
		t.Fatal(err)
	}
	readerAuthorization := "Bearer " + readerLogin.Token
	if status, result := contentUpload(t, base, authorization, "POST", "revoked-skill", []contentFile{{name: "SKILL.md", content: "# Before"}}); status != 201 {
		t.Fatal(status, result)
	}
	_, readBody, _ := contentCall(t, base, "/api/v1/admin/skills/revoked-skill/file?path=SKILL.md", "GET", authorization, nil)
	raw := `{"path":"SKILL.md","content":"# After","expectedVersion":"` + readBody["version"].(string) + `"}`
	body := &gatedBody{source: strings.NewReader(raw), started: make(chan struct{}), proceed: make(chan struct{})}
	request := httptest.NewRequest("PUT", "/api/v1/admin/skills/revoked-skill/file", body)
	request.Header.Set("Authorization", authorization)
	request.Header.Set("Content-Type", "application/json")
	finished := make(chan error, 1)
	go func() { finished <- a.handle(httptest.NewRecorder(), request) }()
	select {
	case <-body.started:
	case <-time.After(time.Second):
		t.Fatal("request was not authorized before reading body")
	}
	if err := a.Identity.Logout(context.Background(), token); err != nil {
		t.Fatal(err)
	}
	close(body.proceed)
	var result error
	select {
	case result = <-finished:
	case <-time.After(5 * time.Second):
		t.Fatal("revoked save stalled")
	}
	status, public := contracts.ProjectError(result)
	if status != 401 || public.Code != "AUTHENTICATION_FAILED" {
		t.Fatal("revoked administrator published a file", result, public)
	}
	if status, body, _ := contentCall(t, base, "/api/v1/admin/skills/revoked-skill/file?path=SKILL.md", "GET", readerAuthorization, nil); status != 200 || body["content"] != "# Before" {
		t.Fatal("revoked save changed content", status, body)
	}
	// The published artifact must not leave an orphaned stage or identity.
	entries, err := os.ReadDir(filepath.Join(a.options.DataDirectory, "skills", "revoked-skill", "artifacts"))
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Fatal("revoked save left extra artifacts", entries)
	}
}
