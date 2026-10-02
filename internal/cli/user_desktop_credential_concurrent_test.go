package cli

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"piwork/internal/client"
)

func TestNativeDesktopConditionalCleanupPreservesNewCredential(t *testing.T) {
	for _, kind := range []string{"logout", "offline-logout", "verify", "revoke"} {
		for _, otherCore := range []bool{false, true} {
			name := kind + "-same-core"
			if otherCore {
				name = kind + "-different-core"
			}
			t.Run(name, func(t *testing.T) {
				store := client.CredentialStore{Path: filepath.Join(t.TempDir(), "credentials", "client.json")}
				var newer client.Credential
				core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if err := store.Save(newer); err != nil {
						t.Error(err)
					}
					if kind == "verify" {
						w.WriteHeader(401)
					} else if kind == "offline-logout" {
						w.WriteHeader(503)
					} else {
						w.WriteHeader(204)
					}
				}))
				defer core.Close()
				old := client.Credential{Version: 1, CoreURL: core.URL, Token: "old-token", ExpiresAt: "2099-01-01T00:00:00Z", User: client.Identity{ID: "owner", Account: "owner", Role: "user"}}
				newer = old
				newer.Token = "new-token"
				if otherCore {
					newer.CoreURL = "http://127.0.0.1:7172/"
				}
				if err := store.Save(old); err != nil {
					t.Fatal(err)
				}
				d := &nativeDesktop{store: store, identity: desktopIdentity{coreURL: core.URL, credential: &old, checked: true}}
				switch kind {
				case "revoke":
					if err := store.Save(newer); err != nil {
						t.Fatal(err)
					}
					d.revokeToken(old.CoreURL, old.Token)
				case "verify":
					d.mu.Lock()
					d.verifyLocked(context.Background())
					d.mu.Unlock()
				default:
					w := httptest.NewRecorder()
					r := httptest.NewRequest(http.MethodPost, "http://desktop.localhost/_desktop/api/logout", nil)
					d.logout(w, r, "csrf")
					var result struct {
						Remote bool `json:"remoteRevocationConfirmed"`
						View   struct {
							State string `json:"state"`
						} `json:"view"`
					}
					if json.Unmarshal(w.Body.Bytes(), &result) != nil || w.Code != 200 || result.Remote != (kind == "logout") || result.View.State != "signed-out" {
						t.Fatal("Desktop local/remote logout semantics changed", w.Code, w.Body.String())
					}
				}
				if d.identity.credential != nil || d.identity.checked {
					t.Fatal("old Desktop identity retained")
				}
				if saved, err := store.Load(); err != nil || saved == nil || *saved != newer {
					t.Fatal("Desktop deleted new shared credential", err)
				}
			})
		}
	}
}
