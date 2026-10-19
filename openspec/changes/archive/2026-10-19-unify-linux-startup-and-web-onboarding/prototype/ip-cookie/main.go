// This synthetic browser fixture tests design D6, not Core authorization.
// It owns only temporary listeners and does not access an installation or Docker.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"net"
	"net/http"
	"net/http/cookiejar"
	"net/http/httputil"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"golang.org/x/net/websocket"
)

const appScript = `
window.fixture = {
  cookie(name) {
    return document.cookie.split('; ').find(value => value.startsWith(name + '='))?.slice(name.length + 1) ?? '';
  },
  async request(path, options = {}) {
    const response = await fetch(path, options);
    return { status: response.status, body: await response.json() };
  },
  async csrf() {
    return this.request('/api/csrf', { method: 'POST', headers: { 'x-csrf-token': this.cookie('csrftoken') } });
  },
  async websocket() {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(location.origin.replace('http:', 'ws:') + '/ws');
      socket.onmessage = event => { resolve(event.data); socket.close(); };
      socket.onerror = () => reject(new Error('WebSocket failed'));
    });
  },
  async event() {
    return new Promise((resolve, reject) => {
      const events = new EventSource('/events');
      events.onmessage = event => { resolve(event.data); events.close(); };
      events.onerror = () => { events.close(); reject(new Error('SSE failed')); };
    });
  }
};
document.querySelector('[data-state]').textContent = 'Application loaded';
`

func result(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func cookieValue(r *http.Request, name string) string {
	cookie, err := r.Cookie(name)
	if err != nil {
		return ""
	}
	return cookie.Value
}

func application(id string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; connect-src 'self'; frame-src http:; object-src 'none'; base-uri 'none'")
		loggedIn := cookieValue(r, "session") == id+"-synthetic-session"
		switch r.URL.Path {
		case "/":
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			fmt.Fprintf(w, `<!doctype html><html lang="en"><meta charset="utf-8"><title>Service %s</title><p data-state>Loading</p><script src="/assets/app.js"></script></html>`, id)
		case "/assets/app.js":
			w.Header().Set("Content-Type", "text/javascript")
			_, _ = w.Write([]byte(appScript))
		case "/login":
			if r.Method != http.MethodPost {
				result(w, 405, nil)
				return
			}
			for _, cookie := range []*http.Cookie{
				{Name: "session", Value: id + "-synthetic-session", Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode},
				{Name: "csrftoken", Value: id + "-synthetic-csrf", Path: "/", SameSite: http.SameSiteStrictMode},
				{Name: "domain_session", Value: id + "-synthetic-domain", Domain: id + ".work", Path: "/", HttpOnly: true},
			} {
				http.SetCookie(w, cookie)
			}
			result(w, 200, map[string]string{"application": id})
		case "/api/protected":
			status := http.StatusUnauthorized
			if loggedIn {
				status = http.StatusOK
			}
			result(w, status, map[string]any{"authenticated": loggedIn, "domainCookie": cookieValue(r, "domain_session") == id+"-synthetic-domain"})
		case "/api/csrf":
			valid := loggedIn && cookieValue(r, "csrftoken") == id+"-synthetic-csrf" && r.Header.Get("X-Csrf-Token") == id+"-synthetic-csrf"
			status := http.StatusForbidden
			if valid {
				status = http.StatusOK
			}
			result(w, status, map[string]bool{"accepted": valid})
		case "/api/echo", "/scoped/echo":
			names := []string{}
			for _, cookie := range r.Cookies() {
				names = append(names, cookie.Name)
			}
			result(w, 200, map[string]any{"path": r.URL.Path, "query": r.URL.RawQuery, "cookies": names, "scoped": cookieValue(r, "scoped")})
		case "/scope":
			http.SetCookie(w, &http.Cookie{Name: "scoped", Value: id + "-scope", Path: "/scoped/"})
			result(w, 200, nil)
		case "/expire":
			http.SetCookie(w, &http.Cookie{Name: "short", Value: id + "-short", Path: "/", MaxAge: 1})
			result(w, 200, nil)
		case "/delete":
			for _, name := range []string{"session", "csrftoken", "domain_session"} {
				cookie := &http.Cookie{Name: name, Path: "/", MaxAge: -1}
				if name == "domain_session" {
					cookie.Domain = id + ".work"
				}
				http.SetCookie(w, cookie)
			}
			result(w, 200, nil)
		case "/redirect":
			http.Redirect(w, r, "http://"+id+".work/api/echo?redirect=kept", http.StatusFound)
		case "/events":
			if !loggedIn {
				result(w, 401, nil)
				return
			}
			w.Header().Set("Content-Type", "text/event-stream")
			fmt.Fprintf(w, "data: authenticated:%s\n\n", id)
			w.(http.Flusher).Flush()
			<-r.Context().Done()
		case "/ws":
			if !loggedIn {
				result(w, 401, nil)
				return
			}
			websocket.Handler(func(conn *websocket.Conn) {
				defer conn.Close()
				_ = websocket.Message.Send(conn, "authenticated:"+id)
			}).ServeHTTP(w, r)
		default:
			result(w, 404, nil)
		}
	})
}

func main() {
	serverIP := flag.String("server-ip", "", "numeric server address to bind; not a DNS name")
	flag.Parse()
	if net.ParseIP(*serverIP) == nil {
		fmt.Fprintln(os.Stderr, "--server-ip must be a numeric server address")
		os.Exit(2)
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	servers := []*http.Server{}
	listen := func(host string, handler http.Handler) string {
		listener, err := net.Listen("tcp", net.JoinHostPort(host, "0"))
		if err != nil {
			panic(err)
		}
		server := &http.Server{Handler: handler, ReadHeaderTimeout: 5 * time.Second}
		servers = append(servers, server)
		go func() { _ = server.Serve(listener) }()
		return "http://" + listener.Addr().String()
	}
	entries := map[string]map[string]string{"raw": {}, "jar": {}}
	for _, id := range []string{"a", "b"} {
		target, _ := url.Parse(listen("127.0.0.1", application(id)))
		logical, _ := url.Parse("http://" + id + ".work")
		for _, mode := range []string{"raw", "jar"} {
			jar, _ := cookiejar.New(nil)
			grantName, grantValue := "piwork-route-fixture-"+mode+"-"+id, "synthetic-grant-"+mode+"-"+id
			origin := ""
			proxy := &httputil.ReverseProxy{
				Rewrite: func(pr *httputil.ProxyRequest) {
					pr.SetURL(target)
					pr.Out.Host = logical.Host
					if pr.In.Header.Get("Origin") == origin {
						pr.Out.Header.Set("Origin", logical.String())
					}
					pr.Out.Header.Del("Cookie")
					if mode == "jar" {
						cookieURL := *logical
						cookieURL.Path = pr.In.URL.Path
						for _, cookie := range jar.Cookies(&cookieURL) {
							pr.Out.AddCookie(cookie)
						}
					} else {
						for _, cookie := range pr.In.Cookies() {
							if !strings.HasPrefix(cookie.Name, "piwork-") {
								pr.Out.AddCookie(cookie)
							}
						}
					}
				},
				ModifyResponse: func(response *http.Response) error {
					cookies := response.Cookies()
					response.Header.Del("Set-Cookie")
					if mode == "jar" {
						cookieURL := *logical
						cookieURL.Path = response.Request.URL.Path
						jar.SetCookies(&cookieURL, cookies)
					} else {
						for _, cookie := range cookies {
							cookie.Domain = ""
							response.Header.Add("Set-Cookie", cookie.String())
						}
					}
					if location := response.Header.Get("Location"); strings.HasPrefix(location, logical.String()+"/") {
						response.Header.Set("Location", strings.TrimPrefix(location, logical.String()))
					}
					return nil
				},
			}
			origin = listen(*serverIP, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				// This public fixture-only bootstrap is deliberately not a setup/grant implementation.
				if r.URL.Path == "/__fixture/authorize" {
					http.SetCookie(w, &http.Cookie{Name: grantName, Value: grantValue, Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode})
					http.Redirect(w, r, "/", http.StatusSeeOther)
					return
				}
				if cookieValue(r, grantName) != grantValue {
					result(w, 401, map[string]string{"error": "FIXTURE_AUTH_REQUIRED"})
					return
				}
				proxy.ServeHTTP(w, r)
			}))
			entries[mode][id] = origin
		}
	}
	_ = json.NewEncoder(os.Stdout).Encode(entries)
	<-ctx.Done()
	for _, server := range servers {
		_ = server.Close()
	}
}
