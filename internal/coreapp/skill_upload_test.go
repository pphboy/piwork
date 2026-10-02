package coreapp

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type countedUploadBody struct{ reads int }

func (body *countedUploadBody) Read([]byte) (int, error) { body.reads++; return 0, io.EOF }
func (body *countedUploadBody) Close() error             { return nil }

func TestAdminSkillUploadAuthenticatesBeforeReadingBody(t *testing.T) {
	a, _, _ := appFixture(t, Options{Initialization: Initialization{Administrator: &struct{ Account, Password string }{"admin", "development-fixture-pass"}}})
	body := &countedUploadBody{}
	request := httptest.NewRequest(http.MethodPost, "/api/v1/admin/skills", body)
	request.Header.Set("Content-Type", "multipart/form-data; boundary=boundary")
	response := httptest.NewRecorder()
	a.route(response, request)
	if response.Code != http.StatusUnauthorized || body.reads != 0 {
		t.Fatal("unauthorized Skill upload read request bytes", response.Code, body.reads)
	}
}

func TestAdminSkillContentUploadAndPathSafety(t *testing.T) {
	a, base, _ := appFixture(t, Options{Initialization: Initialization{Administrator: &struct{ Account, Password string }{"admin", "development-fixture-pass"}}})
	login, err := a.Identity.Login(context.Background(), "admin", "development-fixture-pass", "test")
	if err != nil {
		t.Fatal(err)
	}
	authorization := "Bearer " + login.Token
	upload := func(path, method, directory string, files []struct{ name, content string }) (int, map[string]any) {
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
			part, err := writer.CreateFormFile("files", file.name)
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
		request, err := http.NewRequest(method, base+path, bytes.NewReader(body.Bytes()))
		if err != nil {
			t.Fatal(err)
		}
		request.Header.Set("Authorization", authorization)
		request.Header.Set("Content-Type", writer.FormDataContentType())
		response, err := (&http.Client{}).Do(request)
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
	files := []struct{ name, content string }{{"SKILL.md", "# Uploaded"}, {"references%2Frules.md", "support"}}
	if status, result := upload("/api/v1/admin/skills", "POST", "uploaded-skill", files); status != 201 || result["name"] != "uploaded-skill" || result["fileCount"] != float64(2) {
		t.Fatal("valid directory snapshot was not uploaded", status, result)
	}
	if status, result := upload("/api/v1/admin/skills", "POST", "uploaded-skill", files); status != 409 || result["code"] != "SKILL_ALREADY_EXISTS" {
		t.Fatal("duplicate Skill content add did not report conflict", status, result)
	}
	if status, result := upload("/api/v1/admin/skills/uploaded-skill", "PUT", "wrong-name", files); status != 400 || result["code"] != "SKILL_NAME_MISMATCH" {
		t.Fatal("update accepted a different directoryName", status, result)
	}
	badPaths := [][]struct{ name, content string }{
		{{"SKILL.md", "# Invalid"}, {"..%2Fescape", "outside"}},
		{{"SKILL.md", "# Invalid"}, {"%2Fabsolute", "outside"}},
		{{"SKILL.md", "# Invalid"}, {"folder%5Cchild", "outside"}},
		{{"SKILL.md", "# Invalid"}, {"%FF", "invalid utf-8"}},
		{{"SKILL.md", "# Invalid"}, {"folder%2fchild", "noncanonical encoding"}},
		{{"SKILL.md", "# Invalid"}, {"SKILL.md", "duplicate"}},
		{{"SKILL.md", "# Invalid"}, {"folder", "file"}, {"folder%2Fchild", "conflict"}},
	}
	for _, bad := range badPaths {
		if status, result := upload("/api/v1/admin/skills/uploaded-skill", "PUT", "uploaded-skill", bad); status != 400 || result["code"] != "SKILL_UPLOAD_INVALID" {
			t.Fatal("unsafe upload path was accepted", status, result)
		}
	}
	updated := []struct{ name, content string }{{"SKILL.md", "# Uploaded"}, {"references%2Frules.md", "updated"}}
	if status, result := upload("/api/v1/admin/skills/uploaded-skill", "PUT", "uploaded-skill", updated); status != 200 || result["fileCount"] != float64(2) {
		t.Fatal("valid Skill content update failed", status, result)
	}
	if status, result := upload("/api/v1/admin/skills/absent-skill", "PUT", "absent-skill", files); status != 404 || result["code"] != "SKILL_UNAVAILABLE" {
		t.Fatal("unknown Skill update did not use unavailable error", status, result)
	}
	if status, result := httpCall(t, base, "/api/v1/admin/skills/uploaded-skill/disable", "POST", authorization, map[string]any{}); status != 200 || result["enabled"] != false {
		t.Fatal("could not disable uploaded Skill", status, result)
	}
	if status, result := upload("/api/v1/admin/skills/uploaded-skill", "PUT", "uploaded-skill", files); status != 200 || result["enabled"] != false {
		t.Fatal("upload update changed disabled state", status, result)
	}
	boundary := make([]struct{ name, content string }, 2048)
	boundary[0] = struct{ name, content string }{"SKILL.md", "# boundary"}
	for i := 1; i < len(boundary); i++ {
		boundary[i] = struct{ name, content string }{fmt.Sprintf("file-%04d", i), ""}
	}
	if status, result := upload("/api/v1/admin/skills", "POST", "boundary-skill", boundary); status != 201 || result["fileCount"] != float64(2048) {
		t.Fatal("exact 2048-file limit was rejected", status, result)
	}
	tooMany := append(boundary, struct{ name, content string }{"overflow", ""})
	if status, result := upload("/api/v1/admin/skills", "POST", "overflow-skill", tooMany); status != 413 || result["code"] != "SKILL_UPLOAD_LIMIT_EXCEEDED" {
		t.Fatal("2049 files were accepted", status, result)
	}
	if status, result := upload("/api/v1/admin/skills", "POST", "too-large", []struct{ name, content string }{{"SKILL.md", strings.Repeat("x", (8<<20)+1)}}); status != 413 || result["code"] != "SKILL_UPLOAD_LIMIT_EXCEEDED" {
		t.Fatal("oversized Skill file was accepted", status, result)
	}
	if status, result := httpCall(t, base, "/api/v1/admin/skills", "POST", authorization, map[string]any{"path": "/tmp/host-skill"}); status != 415 || result["code"] != "UNSUPPORTED_MEDIA_TYPE" {
		t.Fatal("admin content endpoint accepted a server path", status, result)
	}
	var before string
	if err := a.Store.Read(context.Background(), func(tx *sql.Tx) error {
		return tx.QueryRow(`SELECT resolved_digest FROM catalog_entries WHERE id='uploaded-skill'`).Scan(&before)
	}); err != nil {
		t.Fatal(err)
	}
	var interrupted bytes.Buffer
	writer := multipart.NewWriter(&interrupted)
	writer.WriteField("directoryName", "uploaded-skill")
	part, _ := writer.CreateFormFile("files", "SKILL.md")
	part.Write([]byte("partial replacement must not publish"))
	writer.Close()
	request, err := http.NewRequest("PUT", base+"/api/v1/admin/skills/uploaded-skill", bytes.NewReader(interrupted.Bytes()[:interrupted.Len()-10]))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", authorization)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	io.Copy(io.Discard, response.Body)
	response.Body.Close()
	if response.StatusCode != 400 {
		t.Fatal("interrupted multipart upload was accepted", response.StatusCode)
	}
	var after string
	if err := a.Store.Read(context.Background(), func(tx *sql.Tx) error {
		return tx.QueryRow(`SELECT resolved_digest FROM catalog_entries WHERE id='uploaded-skill'`).Scan(&after)
	}); err != nil || before != after {
		t.Fatal("interrupted upload replaced the previous Skill", before, after, err)
	}
}
