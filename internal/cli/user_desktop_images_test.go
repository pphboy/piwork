package cli

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"hash/crc32"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"piwork/internal/chatimages"
	"piwork/internal/client"
	"strconv"
	"strings"
	"testing"
	"time"
)

func paddedChatPNG(t *testing.T, n int) []byte {
	t.Helper()
	b, err := os.ReadFile("../../fixtures/chat-images/png.png")
	if err != nil {
		t.Fatal(err)
	}
	chunk := bytes.Repeat([]byte{'x'}, n-len(b))
	binary.BigEndian.PutUint32(chunk, uint32(len(chunk)-12))
	copy(chunk[4:], "tEXt")
	chunk[8] = 'k'
	chunk[9] = 0
	binary.BigEndian.PutUint32(chunk[len(chunk)-4:], crc32.ChecksumIEEE(chunk[4:len(chunk)-4]))
	return append(append(append([]byte{}, b[:len(b)-12]...), chunk...), b[len(b)-12:]...)
}
func TestDesktopImageSubmitHasOwnLimitAndPreservesEmptyText(t *testing.T) {
	png := paddedChatPNG(t, chatimages.MaxImageBytes)
	images := []chatimages.Input{{MimeType: "image/png", Data: base64.StdEncoding.EncodeToString(png)}, {MimeType: "image/png", Data: base64.StdEncoding.EncodeToString(png)}}
	input := map[string]any{"sessionId": "session-1", "submissionKey": "image-key", "prompt": "", "inputMode": "text", "images": images}
	raw, _ := json.Marshal(input)
	if len(raw) <= 4<<20 {
		t.Fatal("fixture does not cross the old RPC limit")
	}
	r := httptest.NewRequest("POST", "http://desktop.localhost:17891/_desktop/api/works/work-1/runs", bytes.NewReader(raw))
	r.Header.Set("Content-Type", "application/json")
	plan, handled, err := planDesktopControl(r)
	if err != nil || !handled || plan.path != "/api/v1/works/work-1/runs" {
		t.Fatal("bounded image body rejected", err)
	}
	input["images"] = append(images, images[0])
	raw, _ = json.Marshal(input)
	r = httptest.NewRequest("POST", r.URL.String(), bytes.NewReader(raw))
	r.Header.Set("Content-Type", "application/json")
	if _, _, err := planDesktopControl(r); err == nil {
		t.Fatal("oversized image request accepted")
	}
	delete(input, "images")
	input["prompt"] = ""
	raw, _ = json.Marshal(input)
	r = httptest.NewRequest("POST", r.URL.String(), bytes.NewReader(raw))
	r.Header.Set("Content-Type", "application/json")
	if _, _, err := planDesktopControl(r); err == nil {
		t.Fatal("empty text-only request accepted")
	}
}
func TestDesktopOriginalImageProxyKeepsAuthorizationAndBinaryHeaders(t *testing.T) {
	png, err := os.ReadFile("../../fixtures/chat-images/png.png")
	if err != nil {
		t.Fatal(err)
	}
	reads := 0
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/me" {
			io.WriteString(w, `{"id":"owner","account":"owner","role":"user"}`)
			return
		}
		if r.Header.Get("Authorization") != "Bearer private-fixture-token" {
			t.Error("wrong Core authorization")
		}
		if r.URL.Path != "/api/v1/works/work-1/sessions/session-1/runs/run-1/images/0" {
			w.WriteHeader(404)
			return
		}
		reads++
		w.Header().Set("Content-Type", "image/png")
		w.Header().Set("Content-Length", strconv.Itoa(len(png)))
		w.Write(png)
	}))
	defer core.Close()
	api, _ := client.New(core.URL, "")
	d := &nativeDesktop{api: api, port: 17891, origin: "http://desktop.localhost:17891", store: client.CredentialStore{Path: filepath.Join(t.TempDir(), "credentials", "client.json")}, sessions: map[string]desktopSession{"local": {csrf: "csrf", end: time.Now().Add(time.Hour)}}, identity: desktopIdentity{coreURL: core.URL, checked: true, credential: &client.Credential{Version: 1, CoreURL: core.URL, Token: "private-fixture-token", ExpiresAt: "2099-01-01T00:00:00Z", User: client.Identity{ID: "owner", Account: "owner", Role: "user"}}}}
	path := "/_desktop/api/works/work-1/sessions/session-1/runs/run-1/images/0"
	for _, cookie := range []string{"", d.cookieName() + "=local"} {
		r := httptest.NewRequest("GET", d.origin+path, nil)
		r.Header.Set("Cookie", cookie)
		r.Header.Set("Authorization", "Bearer browser-must-not-control-this")
		w := httptest.NewRecorder()
		d.ServeHTTP(w, r)
		if cookie == "" {
			if w.Code != 401 {
				t.Fatal(w.Code)
			}
		} else if w.Code != 200 || !bytes.Equal(w.Body.Bytes(), png) || w.Header().Get("Cache-Control") != "no-store" || strings.Contains(w.Body.String(), "private-fixture-token") {
			t.Fatal("invalid image proxy response", w.Code)
		}
	}
	if reads != 1 {
		t.Fatal("unauthorized image read reached Core", reads)
	}
}
