package cli

import (
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

type skillImportDesktop struct {
	*nativeDesktop
	receivedPath string
	receivedType string
	receivedBody string
}

func newSkillImportDesktop(t *testing.T, handler http.HandlerFunc) (*skillImportDesktop, func()) {
	t.Helper()
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/me" {
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "user-1", "account": "owner", "role": "user"})
			return
		}
		handler(w, r)
	}))
	api, _ := client.New(core.URL, "")
	d := &nativeDesktop{api: api, store: client.CredentialStore{Path: filepath.Join(t.TempDir(), "credentials", "client.json")}, port: 17891, origin: "http://desktop.localhost:17891", sessions: map[string]desktopSession{"local": {id: "local", csrf: "csrf", end: time.Now().Add(time.Hour)}}, identity: desktopIdentity{coreURL: core.URL, credential: &client.Credential{CoreURL: core.URL, Token: "token", User: client.Identity{ID: "user-1"}}, checked: true}}
	wrapper := &skillImportDesktop{nativeDesktop: d}
	return wrapper, func() {
		if d.transfers != nil {
			d.transfers.clear()
		}
		core.Close()
	}
}

func (d *skillImportDesktop) send(t *testing.T, body io.Reader, contentType string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest("POST", "http://desktop.localhost:17891/_desktop/api/works/work-1/configuration/skills/import", body)
	request.Header.Set("Content-Type", contentType)
	request.Header.Set("Cookie", d.cookieName()+"=local")
	request.Header.Set("X-Piwork-Csrf", "csrf")
	response := httptest.NewRecorder()
	d.ServeHTTP(response, request)
	return response
}

func skillImportMultipart(t *testing.T) (*bytes.Buffer, string) {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	_ = writer.WriteField("directoryName", "code-review")
	part, _ := writer.CreateFormFile("files", "SKILL%2Emd")
	_, _ = part.Write([]byte("# Review"))
	_ = writer.Close()
	return &body, writer.FormDataContentType()
}

func TestDesktopWorkSkillImportForwardsExactMultipartRoute(t *testing.T) {
	var d *skillImportDesktop
	handler := func(w http.ResponseWriter, r *http.Request) {
		d.receivedPath = r.URL.Path
		d.receivedType = r.Header.Get("Content-Type")
		raw, _ := io.ReadAll(r.Body)
		d.receivedBody = string(raw)
		_ = json.NewEncoder(w).Encode(map[string]any{"workId": "work-1", "desired": map[string]any{"skills": []string{"code-review"}}, "active": nil, "pendingApply": true})
	}
	d, done := newSkillImportDesktop(t, handler)
	defer done()
	body, contentType := skillImportMultipart(t)
	response := d.send(t, body, contentType)
	if response.Code != 200 || !strings.Contains(response.Body.String(), `"code-review"`) {
		t.Fatal("confirmed settings state was not forwarded", response.Code, response.Body.String())
	}
	if d.receivedPath != "/api/v1/works/work-1/configuration/skills/import" || !strings.HasPrefix(d.receivedType, "multipart/form-data; boundary=") {
		t.Fatal("Core route or media type changed", d.receivedPath, d.receivedType)
	}
	if !strings.Contains(d.receivedBody, `name="directoryName"`) || !strings.Contains(d.receivedBody, "code-review") {
		t.Fatal("multipart body was not forwarded", d.receivedBody)
	}
}

func TestDesktopWorkSkillImportRejectsUnauthorizedMediaAndOversize(t *testing.T) {
	d, done := newSkillImportDesktop(t, func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) })
	defer done()
	body, contentType := skillImportMultipart(t)
	request := httptest.NewRequest("POST", "http://desktop.localhost:17891/_desktop/api/works/work-1/configuration/skills/import", body)
	request.Header.Set("Content-Type", contentType)
	request.Header.Set("Cookie", d.cookieName()+"=local")
	request.Header.Set("X-Piwork-Csrf", "csrf")
	response := httptest.NewRecorder()
	d.identity.credential = nil
	d.ServeHTTP(response, request)
	if response.Code != 401 {
		t.Fatal("unauthenticated import was forwarded", response.Code)
	}
	d.identity.credential = &client.Credential{CoreURL: d.identity.coreURL, Token: "token", User: client.Identity{ID: "user-1"}}
	body, _ = skillImportMultipart(t)
	if response := d.send(t, body, "application/json"); response.Code != 415 || !strings.Contains(response.Body.String(), "MULTIPART_REQUIRED") {
		t.Fatal("non-multipart import was accepted", response.Code, response.Body.String())
	}
	request = httptest.NewRequest("POST", "http://desktop.localhost:17891/_desktop/api/works/work-1/configuration/skills/import", strings.NewReader("x"))
	request.Header.Set("Content-Type", "multipart/form-data; boundary=b")
	request.Header.Set("Cookie", d.cookieName()+"=local")
	request.Header.Set("X-Piwork-Csrf", "csrf")
	request.ContentLength = desktopSkillImportLimit + 1
	response = httptest.NewRecorder()
	d.ServeHTTP(response, request)
	if response.Code != 413 || !strings.Contains(response.Body.String(), "SKILL_UPLOAD_LIMIT_EXCEEDED") {
		t.Fatal("oversized import was accepted", response.Code, response.Body.String())
	}
}

type switchingImportBody struct {
	d      *nativeDesktop
	source *bytes.Buffer
}

func (body *switchingImportBody) Read(p []byte) (int, error) {
	body.d.mu.Lock()
	if body.d.identity.generation == 0 {
		body.d.identity.generation++
	}
	body.d.mu.Unlock()
	return body.source.Read(p)
}

func TestDesktopWorkSkillImportRejectsIdentitySwitchBeforeForward(t *testing.T) {
	var forwarded bool
	d, done := newSkillImportDesktop(t, func(w http.ResponseWriter, r *http.Request) {
		forwarded = true
		w.WriteHeader(200)
	})
	defer done()
	body, contentType := skillImportMultipart(t)
	request := httptest.NewRequest("POST", "http://desktop.localhost:17891/_desktop/api/works/work-1/configuration/skills/import", &switchingImportBody{d: d.nativeDesktop, source: body})
	request.Header.Set("Content-Type", contentType)
	request.Header.Set("Cookie", d.cookieName()+"=local")
	request.Header.Set("X-Piwork-Csrf", "csrf")
	response := httptest.NewRecorder()
	d.ServeHTTP(response, request)
	if response.Code != 401 || !strings.Contains(response.Body.String(), "AUTH_REQUIRED") || forwarded {
		t.Fatal("identity switch was not rejected before forwarding", response.Code, response.Body.String(), forwarded)
	}
}
