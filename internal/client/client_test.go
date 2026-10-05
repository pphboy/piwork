package client

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func fixtureCredential(url string) Credential {
	return Credential{Version: 1, CoreURL: url, Token: "token-1", ExpiresAt: "2099-01-01T00:00:00Z",
		User: Identity{ID: "user-1", Account: "owner", Role: "user"}}
}

func TestCredentialStoreRejectsLinksAndPreservesRecord(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config", "client.json")
	store := CredentialStore{Path: path}
	first := fixtureCredential("http://127.0.0.1:7171/")
	if err := store.Save(first); err != nil {
		t.Fatal(err)
	}
	assertCredentialPrivate(t, path)
	loaded, err := store.Load()
	if err != nil || *loaded != first {
		t.Fatal("credential round trip", err)
	}
	link := filepath.Join(t.TempDir(), "linked.json")
	makeCredentialLink(t, path, link)
	if _, err := (CredentialStore{Path: link}).Load(); err == nil {
		t.Fatal("linked credential was read")
	}
	if err := (CredentialStore{Path: link}).Save(first); err == nil {
		t.Fatal("linked credential was overwritten")
	}
	if err := os.Remove(link); err != nil {
		t.Fatal(err)
	}
	loaded, err = store.Load()
	if err != nil || *loaded != first {
		t.Fatal("failed save changed existing credential", err)
	}
}

func TestClientLoginFailureAndRedirectNeverLeakBearer(t *testing.T) {
	var leaked string
	foreign := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		leaked = r.Header.Get("Authorization")
		w.WriteHeader(200)
	}))
	defer foreign.Close()
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/login":
			w.WriteHeader(401)
			json.NewEncoder(w).Encode(map[string]string{"code": "INVALID_LOGIN", "message": "invalid login"})
		case "/api/v1/me":
			http.Redirect(w, r, foreign.URL, http.StatusFound)
		}
	}))
	defer core.Close()
	store := CredentialStore{Path: filepath.Join(t.TempDir(), "credentials", "client.json")}
	first := fixtureCredential(core.URL + "/")
	if err := store.Save(first); err != nil {
		t.Fatal(err)
	}
	client, err := New(core.URL, first.Token)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.Login(context.Background(), "owner", "wrong"); err == nil {
		t.Fatal("bad login accepted")
	}
	loaded, err := store.Load()
	if err != nil || *loaded != first {
		t.Fatal("failed login changed old credential", err)
	}
	if err := client.Request(context.Background(), "GET", "/api/v1/me", nil, nil); err == nil {
		t.Fatal("redirect accepted")
	}
	if leaked != "" {
		t.Fatal("bearer leaked to redirected origin")
	}
}
