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
