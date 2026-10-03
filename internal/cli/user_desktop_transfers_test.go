package cli

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"piwork/internal/client"
)

func TestNativeDesktopWorkPackageTransferUsesOriginalSnapshotAndSession(t *testing.T) {
	content, err := os.ReadFile(filepath.Join("..", "workpackage", "testdata", "golden-native-pi-package.work"))
	if err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256(content)
	digest := hex.EncodeToString(hash[:])
	var uploads, imports int
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer token" {
			t.Error("Core request lost server-held token")
			w.WriteHeader(401)
			return
		}
		switch r.URL.Path {
		case "/api/v1/me":
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "user-1", "account": "owner", "role": "user"})
		case "/api/v1/work-packages":
			uploads++
			body, _ := io.ReadAll(r.Body)
			if !bytes.Equal(body, content) || r.Header.Get("X-Piwork-Sha256") != digest {
				t.Error("Core received changed package")
			}
			w.WriteHeader(201)
			_ = json.NewEncoder(w).Encode(map[string]any{"packageId": "package-1", "digest": digest, "size": len(content)})
		case "/api/v1/work-imports":
			imports++
			w.WriteHeader(202)
			_ = json.NewEncoder(w).Encode(map[string]string{"workId": "work-1", "operationId": "operation-1", "name": "Imported"})
		case "/api/v1/work-snapshots/snapshot-1":
			_ = json.NewEncoder(w).Encode(map[string]any{"workId": "work-1", "snapshotId": "snapshot-1", "state": "succeeded", "digest": digest, "size": len(content)})
		case "/api/v1/work-snapshots/snapshot-1/content":
			if r.Header.Get("Range") != "" {
				t.Error("Desktop sent Range")
			}
			w.Header().Set("Content-Type", workPackageMIME)
			w.Header().Set("X-Piwork-Sha256", digest)
			w.Header().Set("Content-Length", stringInt(len(content)))
			_, _ = w.Write(content)
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
	request := func(method, path, contentType string, body []byte, csrf string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, "http://desktop.localhost:17891/_desktop/api/"+path, bytes.NewReader(body))
		r.Header.Set("Cookie", d.cookieName()+"=local")
		if csrf != "" {
			r.Header.Set("X-Piwork-Csrf", csrf)
		}
		if contentType != "" {
			r.Header.Set("Content-Type", contentType)
		}
		w := httptest.NewRecorder()
		d.ServeHTTP(w, r)
		return w
	}
	if denied := request("POST", "work-packages", workPackageMIME, content, ""); denied.Code != 403 {
		t.Fatal("missing CSRF allowed", denied.Code)
	}
	inspect := request("POST", "work-packages", workPackageMIME, content, "csrf")
	if inspect.Code != 200 {
		t.Fatal("inspect", inspect.Code, inspect.Body.String())
	}
	var inspected struct {
		TransferID string `json:"transferId"`
		Summary    struct{ IntegrityVerified, InstallationValidated bool }
	}
	if json.Unmarshal(inspect.Body.Bytes(), &inspected) != nil || !inspected.Summary.IntegrityVerified || inspected.Summary.InstallationValidated {
		t.Fatal("inspect summary", inspect.Body.String())
	}
	result := request("POST", "work-imports", "application/json", []byte(`{"transferId":"`+inspected.TransferID+`"}`), "csrf")
	if result.Code != 202 {
		t.Fatal("import", result.Code, result.Body.String())
	}
	if repeated := request("POST", "work-imports", "application/json", []byte(`{"transferId":"`+inspected.TransferID+`"}`), "csrf"); repeated.Code != 202 || uploads != 1 || imports != 1 {
		t.Fatal("import resent", repeated.Code, uploads, imports)
	}
	prepared := request("POST", "work-snapshots/snapshot-1/downloads", "application/json", nil, "csrf")
	if prepared.Code != 200 {
		t.Fatal("prepare", prepared.Code, prepared.Body.String())
	}
	var download struct {
		TransferID string `json:"transferId"`
	}
	_ = json.Unmarshal(prepared.Body.Bytes(), &download)
	response := request("GET", "downloads/"+download.TransferID+"/content", "", nil, "")
	if response.Code != 200 || !bytes.Equal(response.Body.Bytes(), content) {
		t.Fatal("download", response.Code, response.Body.Len())
	}
	d.mu.Lock()
	d.identity.generation++
	d.mu.Unlock()
	if denied := request("GET", "downloads/"+download.TransferID+"/content", "", nil, ""); denied.Code != 401 {
		t.Fatal("cross generation transfer", denied.Code)
	}
	if !strings.Contains(result.Body.String(), "operation-1") {
		t.Fatal("missing original operation", result.Body.String())
	}
}

func stringInt(value int) string { return strconv.Itoa(value) }

func TestNativeDesktopAnonymousInspectionLoginAndExplicitRelease(t *testing.T) {
	content, err := os.ReadFile(filepath.Join("..", "workpackage", "testdata", "golden-native-pi-package.work"))
	if err != nil {
		t.Fatal(err)
	}
	var uploads, imports int
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/login":
			var input struct {
				Account string `json:"account"`
			}
			_ = json.NewDecoder(r.Body).Decode(&input)
			if input.Account == "invalid" {
				w.WriteHeader(401)
				_ = json.NewEncoder(w).Encode(map[string]string{"code": "AUTHENTICATION_FAILED"})
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"token": "test-only-token", "expiresAt": "2099-01-01T00:00:00Z", "user": map[string]string{"id": input.Account, "account": input.Account, "role": "user"}})
		case "/api/v1/me":
			_ = json.NewEncoder(w).Encode(map[string]string{"id": "owner", "account": "owner", "role": "user"})
		case "/api/v1/work-packages":
			uploads++
			_, _ = io.Copy(io.Discard, r.Body)
			w.WriteHeader(201)
			_ = json.NewEncoder(w).Encode(map[string]any{"packageId": "package-original", "digest": func() string { hash := sha256.Sum256(content); return hex.EncodeToString(hash[:]) }(), "size": len(content)})
		case "/api/v1/work-imports":
			imports++
			w.WriteHeader(202)
			_ = json.NewEncoder(w).Encode(map[string]string{"operationId": "operation-original", "workId": "work-imported"})
		case "/api/v1/logout":
			_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
		default:
			w.WriteHeader(404)
		}
	}))
	defer core.Close()
	api, _ := client.New(core.URL, "")
	d := &nativeDesktop{api: api, store: client.CredentialStore{Path: filepath.Join(t.TempDir(), "credentials", "client.json")}, port: 17891, origin: "http://desktop.localhost:17891", sessions: map[string]desktopSession{"local": {id: "local", csrf: "csrf", end: time.Now().Add(time.Hour)}}, identity: desktopIdentity{coreURL: core.URL, checked: true}}
	defer func() {
		if d.transfers != nil {
			d.transfers.clear()
		}
	}()
	request := func(method, path string, body []byte) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, d.origin+"/_desktop/api/"+path, bytes.NewReader(body))
		r.Header.Set("Cookie", d.cookieName()+"=local")
		r.Header.Set("X-Piwork-Csrf", "csrf")
		r.Header.Set("Origin", d.origin)
		if path == "work-packages" {
			r.Header.Set("Content-Type", workPackageMIME)
		} else {
			r.Header.Set("Content-Type", "application/json")
		}
		w := httptest.NewRecorder()
		d.ServeHTTP(w, r)
		return w
	}
	inspect := func() (string, string) {
		w := request("POST", "work-packages", content)
		if w.Code != 200 {
			t.Fatal("inspection", w.Code, w.Body.String())
		}
		var result struct {
			TransferID string `json:"transferId"`
		}
		if json.Unmarshal(w.Body.Bytes(), &result) != nil || result.TransferID == "" {
			t.Fatal("missing transfer")
		}
		d.transfers.mu.Lock()
		path := d.transfers.jobs[result.TransferID].path
		d.transfers.mu.Unlock()
		if _, err := os.Stat(path); err != nil {
			t.Fatal("staged file missing", err)
		}
		return result.TransferID, path
	}
	id, path := inspect()
	if uploads != 0 || imports != 0 {
		t.Fatal("anonymous inspect accessed Core package APIs")
	}
	if w := request("POST", "login", []byte(`{"account":"invalid","password":"test"}`)); w.Code != 401 {
		t.Fatal("failed login", w.Code)
	}
	if w := request("GET", "work-packages/"+id, nil); w.Code != 200 {
		t.Fatal("failed login discarded anonymous inspection", w.Code)
	}
	if w := request("POST", "login", []byte(`{"account":"owner","password":"test"}`)); w.Code != 200 {
		t.Fatal("login", w.Code, w.Body.String())
	}
	if w := request("GET", "work-packages/"+id, nil); w.Code != 200 {
		t.Fatal("login discarded original inspection", w.Code)
	}
	if uploads != 0 || imports != 0 {
		t.Fatal("login submitted import")
	}
	if w := request("POST", "work-imports", []byte(`{"transferId":"`+id+`"}`)); w.Code != 202 {
		t.Fatal("import original", w.Code, w.Body.String())
	}
	if uploads != 1 || imports != 1 {
		t.Fatal("wrong upload/import count", uploads, imports)
	}
	// Ready unsubmitted packages are actually removed, not just hidden by the UI.
	cancelID, cancelPath := inspect()
	if w := request("DELETE", "work-packages/"+cancelID, nil); w.Code != 200 {
		t.Fatal("delete", w.Code)
	}
	if _, err := os.Stat(cancelPath); !os.IsNotExist(err) {
		t.Fatal("DELETE left staged file", err)
	}
	if w := request("DELETE", "work-packages/"+cancelID, nil); w.Code != 404 {
		t.Fatal("repeat cleanup", w.Code)
	}
	if w := request("GET", "work-packages/"+id, nil); w.Code != 200 {
		t.Fatal("cleanup affected accepted import", w.Code)
	}
	if w := request("POST", "logout", []byte(`{}`)); w.Code != 200 {
		t.Fatal("logout", w.Code)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("logout retained private transfer", err)
	}
}
