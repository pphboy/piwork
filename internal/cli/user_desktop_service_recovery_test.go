package cli

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"piwork/internal/client"
)

func TestDesktopServiceRevocationInterruptsBlockedResolution(t *testing.T) {
	for _, protocol := range []string{"sse", "websocket"} {
		for _, cause := range []string{"reset", "expiry"} {
			t.Run(protocol+"/"+cause, func(t *testing.T) {
				polling, pollEnded, upstreamEnded := make(chan struct{}), make(chan struct{}), make(chan struct{})
				var resolves, mutations atomic.Int32
				core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if r.Method != http.MethodGet {
						mutations.Add(1)
					}
					switch {
					case r.URL.Path == "/api/v1/me":
						_, _ = io.WriteString(w, `{"id":"owner","account":"owner","role":"user"}`)
					case r.URL.Path == "/api/v1/service-access/resolve":
						if resolves.Add(1) == 2 {
							close(polling)
							<-r.Context().Done()
							close(pollEnded)
							return
						}
						_, _ = io.WriteString(w, `{"hostname":"notes.w-12345678.work","port":80,"workId":"work-1","serviceId":"service-1"}`)
					case r.URL.Path == "/api/v1/works/work-1/services/service-1":
						_, _ = io.WriteString(w, `{"access":{"hostname":"notes.w-12345678.work","defaultUrl":"http://notes.w-12345678.work","ports":[{"port":80}]}}`)
					case r.URL.Path == "/api/v1/works/work-1":
						_, _ = io.WriteString(w, `{"observedState":"ready"}`)
					case strings.HasSuffix(r.URL.Path, "/restored"):
						_, _ = io.WriteString(w, "restored")
					case strings.HasPrefix(r.URL.Path, "/api/v1/service-gateway/"):
						if protocol == "websocket" {
							conn, buffered, err := w.(http.Hijacker).Hijack()
							if err != nil {
								t.Error(err)
								return
							}
							defer conn.Close()
							_, _ = io.WriteString(buffered, "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\nready")
							_ = buffered.Flush()
							_, _ = io.Copy(io.Discard, conn)
						} else {
							w.Header().Set("Content-Type", "text/event-stream")
							_, _ = io.WriteString(w, "data: ready\n\n")
							w.(http.Flusher).Flush()
							<-r.Context().Done()
						}
						close(upstreamEnded)
					default:
						w.WriteHeader(404)
					}
				}))
				defer core.Close()
				d := recoveryDesktop(t)
				record := client.Credential{Version: 1, CoreURL: core.URL, Token: "test-only-service-token", ExpiresAt: "2099-01-01T00:00:00Z", User: client.Identity{ID: "owner", Account: "owner", Role: "user"}}
				d.identity.coreURL, d.identity.credential, d.identity.checked = core.URL, &record, true
				if err := d.store.Save(record); err != nil {
					t.Fatal(err)
				}
				d.sessions["local"] = desktopSession{csrf: "csrf", end: time.Now().Add(time.Hour)}
				entry := &desktopServiceEntry{id: strings.Repeat("a", 36), workID: "work-1", serviceID: "service-1", hostname: "notes.w-12345678.work", port: 80, sessionID: "local", grant: "grant"}
				d.serviceEntries = map[string]*desktopServiceEntry{entry.id: entry}
				d.serviceGrants = map[string]string{"grant": entry.id}
				local := httptest.NewServer(d)
				defer local.Close()
				appOrigin := d.serviceOrigin(*entry)
				browserEnded := make(chan struct{})
				if protocol == "websocket" {
					conn, err := net.Dial("tcp", strings.TrimPrefix(local.URL, "http://"))
					if err != nil {
						t.Fatal(err)
					}
					defer conn.Close()
					_ = conn.SetDeadline(time.Now().Add(6 * time.Second))
					_, _ = fmt.Fprintf(conn, "GET /stream HTTP/1.1\r\nHost: %s\r\nOrigin: %s\r\nCookie: __Host-piwork-route=grant\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n", strings.TrimPrefix(appOrigin, "http://"), appOrigin)
					reader := bufio.NewReader(conn)
					response, err := http.ReadResponse(reader, nil)
					if err != nil || response.StatusCode != 101 {
						t.Fatal("upgrade", err)
					}
					ready := make([]byte, 5)
					if _, err := io.ReadFull(reader, ready); err != nil || string(ready) != "ready" {
						t.Fatal("upgrade stream", err)
					}
					go func() { _, _ = io.Copy(io.Discard, reader); close(browserEnded) }()
				} else {
					request, _ := http.NewRequest("GET", local.URL+"/stream", nil)
					request.Host = strings.TrimPrefix(appOrigin, "http://")
					request.Header.Set("Cookie", "__Host-piwork-route=grant")
					response, err := http.DefaultClient.Do(request)
					if err != nil {
						t.Fatal(err)
					}
					defer response.Body.Close()
					if response.StatusCode != 200 {
						t.Fatal("stream status", response.StatusCode)
					}
					initial := make([]byte, 1)
					if _, err := response.Body.Read(initial); err != nil {
						t.Fatal(err)
					}
					go func() { _, _ = io.Copy(io.Discard, response.Body); close(browserEnded) }()
				}
				select {
				case <-polling:
				case <-time.After(2 * time.Second):
					t.Fatal("background resolution did not start")
				}
				start := time.Now()
				if cause == "reset" {
					if reset := recoveryHTTP(d, "POST", "/_desktop/api/browser-access/reset", "{}", d.cookieName()+"=local", "csrf"); reset.Code != 200 {
						t.Fatal("reset", reset.Code)
					}
				} else {
					d.mu.Lock()
					session := d.sessions["local"]
					session.end = start
					d.sessions["local"] = session
					d.mu.Unlock()
				}
				for name, done := range map[string]<-chan struct{}{"resolver": pollEnded, "upstream": upstreamEnded, "browser": browserEnded} {
					select {
					case <-done:
					case <-time.After(time.Until(start.Add(2 * time.Second))):
						t.Fatal(name + " exceeded the two-second revocation bound")
					}
				}
				t.Logf("%s/%s: blocked resolver and both stream ends closed in %s", protocol, cause, time.Since(start))
				old := httptest.NewRequest("GET", appOrigin+"/restored", nil)
				old.Header.Set("Cookie", "__Host-piwork-route=grant")
				denied := httptest.NewRecorder()
				d.ServeHTTP(denied, old)
				if denied.Code == 200 {
					t.Fatal("old Service grant remained usable")
				}
				saved, err := d.store.Load()
				if err != nil || saved == nil || saved.Token != record.Token || d.identity.credential != &record {
					t.Fatal("revocation changed Core login", err)
				}
				launch, _ := d.issueTicket()
				bootstrap := recoveryBootstrap(d, recoveryTicket(launch))
				cookie := strings.Split(bootstrap.Header().Get("Set-Cookie"), ";")[0]
				var access struct{ CSRF string }
				_ = json.Unmarshal(bootstrap.Body.Bytes(), &access)
				created := recoveryHTTP(d, "POST", "/_desktop/api/service-entries", `{"workId":"work-1","serviceId":"service-1"}`, cookie, access.CSRF)
				var fresh struct{ EntryURL string }
				if created.Code != 200 || json.Unmarshal(created.Body.Bytes(), &fresh) != nil {
					t.Fatal("new entry", created.Code, created.Body.String())
				}
				address, _ := url.Parse(fresh.EntryURL)
				redeem := httptest.NewRequest("POST", "http://"+address.Host+desktopServiceReserved+"redeem", strings.NewReader(`{"ticket":"`+strings.TrimPrefix(address.Fragment, "ticket=")+`"}`))
				redeem.Header.Set("Origin", "http://"+address.Host)
				redeem.Header.Set("Content-Type", "application/json")
				redeemed := httptest.NewRecorder()
				d.ServeHTTP(redeemed, redeem)
				if redeemed.Code != 200 {
					t.Fatal("new grant", redeemed.Code)
				}
				request := httptest.NewRequest("GET", "http://"+address.Host+"/restored", nil)
				request.Header.Set("Cookie", strings.Split(redeemed.Header().Get("Set-Cookie"), ";")[0])
				restored := httptest.NewRecorder()
				d.ServeHTTP(restored, request)
				if restored.Code != 200 || restored.Body.String() != "restored" || mutations.Load() != 0 {
					t.Fatal("new authorization did not restore access without business writes", restored.Code)
				}
			})
		}
	}
}
