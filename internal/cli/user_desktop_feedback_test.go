package cli

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"testing"
	"time"

	"piwork/internal/client"
)

func TestDesktopDownloadProgressBeforePreparationCompletes(t *testing.T) {
	content, err := os.ReadFile(filepath.Join("..", "workpackage", "testdata", "golden-native-pi-package.work"))
	if err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256(content)
	digest := hex.EncodeToString(hash[:])
	resume, started := make(chan struct{}), make(chan struct{})
	var release sync.Once
	finish := func() { release.Do(func() { close(resume) }) }
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/me":
			_ = json.NewEncoder(w).Encode(map[string]string{"id": "user-1", "account": "owner", "role": "user"})
		case "/api/v1/work-snapshots/snapshot-1":
			_ = json.NewEncoder(w).Encode(map[string]any{"workId": "work-1", "state": "succeeded", "digest": digest, "size": len(content)})
		case "/api/v1/work-snapshots/snapshot-1/content":
			w.Header().Set("Content-Type", workPackageMIME)
			w.Header().Set("X-Piwork-Sha256", digest)
			w.Header().Set("Content-Length", strconv.Itoa(len(content)))
			split := len(content) / 2
			_, _ = w.Write(content[:split])
			w.(http.Flusher).Flush()
			close(started)
			select {
			case <-resume:
				_, _ = w.Write(content[split:])
			case <-r.Context().Done():
			}
		default:
			w.WriteHeader(404)
		}
	}))
	defer core.Close()
	defer finish()
	api, _ := client.New(core.URL, "")
	d := &nativeDesktop{api: api, store: client.CredentialStore{Path: filepath.Join(t.TempDir(), "credentials", "client.json")}, port: 17891, origin: "http://desktop.localhost:17891",
		sessions: map[string]desktopSession{"local": {id: "local", csrf: "csrf", end: time.Now().Add(time.Hour)}},
		identity: desktopIdentity{coreURL: core.URL, credential: &client.Credential{CoreURL: core.URL, Token: "test-token", User: client.Identity{ID: "user-1"}}, checked: true}}
	defer func() {
		if d.transfers != nil {
			d.transfers.clear()
		}
	}()
	id := "11111111-1111-4111-8111-111111111111"
	request := func(method, path string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, d.origin+"/_desktop/api/"+path, nil)
		r.Header.Set("Cookie", d.cookieName()+"=local")
		if method != "GET" {
			r.Header.Set("X-Piwork-Csrf", "csrf")
			r.Header.Set("Content-Type", "application/json")
			r.Header.Set("X-Piwork-Transfer-Id", id)
		}
		w := httptest.NewRecorder()
		d.ServeHTTP(w, r)
		return w
	}
	done := make(chan *httptest.ResponseRecorder, 1)
	go func() { done <- request("POST", "work-snapshots/snapshot-1/downloads") }()
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("snapshot content was not requested")
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		status := request("GET", "downloads/"+id)
		var progress struct {
			Phase       string
			Transferred int64
			Ready       bool
		}
		if status.Code != 200 || json.Unmarshal(status.Body.Bytes(), &progress) != nil {
			t.Fatalf("original transfer unavailable: %d %s", status.Code, status.Body.String())
		}
		if progress.Transferred > 0 {
			if progress.Ready || progress.Phase != "downloading" || progress.Transferred >= int64(len(content)) {
				t.Fatalf("premature completion: %+v", progress)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("no progress before POST completes")
		}
		time.Sleep(10 * time.Millisecond)
	}
	select {
	case response := <-done:
		t.Fatalf("POST returned before completion: %d", response.Code)
	default:
	}
	if response := request("GET", "downloads/"+id+"/content"); response.Code == 200 {
		t.Fatal("unverified partial content exposed")
	}
	finish()
	select {
	case response := <-done:
		if response.Code != 200 {
			t.Fatalf("prepare: %d %s", response.Code, response.Body.String())
		}
		var result struct {
			TransferID string `json:"transferId"`
			Ready      bool
		}
		if json.Unmarshal(response.Body.Bytes(), &result) != nil || !result.Ready || result.TransferID != id {
			t.Fatal("original ID lost", response.Body.String())
		}
	case <-time.After(5 * time.Second):
		t.Fatal("preparation did not finish")
	}
	if response := request("GET", "downloads/"+id+"/content"); response.Code != 200 || !bytes.Equal(response.Body.Bytes(), content) {
		t.Fatal("original verified content changed", response.Code)
	}
}
