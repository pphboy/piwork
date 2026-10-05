package cli

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/signal"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"piwork/internal/client"
)

const proxyDefaultPort = 17890

var serviceDomainPattern = regexp.MustCompile(`^[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?\.w-[a-f0-9]{8,61}\.work$`)

type userProxy struct {
	api      *client.Client
	port     int
	password string
	stderr   io.Writer
	cancel   context.CancelFunc
	stopOnce sync.Once
	stopCode atomic.Int32
	mu       sync.Mutex
	conns    map[net.Conn]struct{}
}

type proxyTrackingListener struct {
	net.Listener
	proxy *userProxy
}

type proxyTrackedConn struct {
	net.Conn
	proxy *userProxy
	once  sync.Once
}

func (l proxyTrackingListener) Accept() (net.Conn, error) {
	conn, err := l.Listener.Accept()
	if err != nil {
		return nil, err
	}
	tracked := &proxyTrackedConn{Conn: conn, proxy: l.proxy}
	l.proxy.mu.Lock()
	l.proxy.conns[tracked] = struct{}{}
	l.proxy.mu.Unlock()
	return tracked, nil
}

func (c *proxyTrackedConn) Close() error {
	var err error
	c.once.Do(func() {
		err = c.Conn.Close()
		c.proxy.mu.Lock()
		delete(c.proxy.conns, c)
		c.proxy.mu.Unlock()
	})
	return err
}

func parseUserProxyPort(args []string) (int, error) {
	if len(args) == 0 {
		return proxyDefaultPort, nil
	}
	if len(args) != 2 || args[0] != "--port" || args[1] == "" {
		return 0, errors.New("usage: piwork-cli proxy [--port <1..65535>]")
	}
	for _, ch := range args[1] {
		if ch < '0' || ch > '9' {
			return 0, errors.New("proxy port must be 1..65535")
		}
	}
	port, err := strconv.Atoi(args[1])
	if err != nil || port < 1 || port > 65535 {
		return 0, errors.New("proxy port must be 1..65535")
	}
	return port, nil
}

func runUserProxy(api *client.Client, args []string, jsonMode bool, stdout, stderr io.Writer) int {
	port, err := parseUserProxyPort(args)
	if err != nil || jsonMode {
		if jsonMode {
			err = errors.New("proxy is an interactive command; --json is unavailable")
		}
		fmt.Fprintln(stderr, err)
		return 2
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	var capability struct {
		Version   int      `json:"version"`
		Protocols []string `json:"protocols"`
	}
	if err := api.Request(ctx, http.MethodGet, "/api/v1/service-access", nil, &capability); err != nil {
		fmt.Fprintln(stderr, err)
		var apiErr *client.APIError
		if errors.As(err, &apiErr) && apiErr.Status == 401 {
			return 3
		}
		return 5
	}
	if capability.Version != 1 {
		fmt.Fprintln(stderr, "SERVICE_ACCESS_UNSUPPORTED: Core service gateway version is unsupported")
		return 5
	}
	fileStatus := "unsupported"
	var fileCapability proxyFileCapability
	if err := api.Request(ctx, http.MethodGet, "/api/v1/file-access", nil, &fileCapability); err == nil {
		if fileCapability.valid() {
			if fileCapability.Available {
				fileStatus = "available"
			} else {
				fileStatus = "unavailable"
			}
		}
	} else {
		var apiErr *client.APIError
		if errors.As(err, &apiErr) && apiErr.Status == 401 {
			fmt.Fprintln(stderr, err)
			return 3
		}
	}
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		fmt.Fprintln(stderr, "Unable to create local WebDAV credential")
		return 1
	}
	proxyCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	p := &userProxy{api: api, port: port, password: base64.RawURLEncoding.EncodeToString(secret), stderr: stderr, cancel: cancel, conns: make(map[net.Conn]struct{})}
	listener, err := net.Listen("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)))
	if err != nil {
		fmt.Fprintln(stderr, "proxy port is occupied or unavailable")
		return 6
	}
	server := &http.Server{Handler: p, MaxHeaderBytes: 32 << 10, ReadHeaderTimeout: 10 * time.Second}
	// The local password is only emitted once, after the listener has succeeded.
	fmt.Fprintf(stdout, "Proxy: http://127.0.0.1:%d\nPAC: http://127.0.0.1:%d/proxy.pac\nWebDAV: http://127.0.0.1:%d/works/<workId>/files/\nWebDAV user: piwork\nWebDAV password: %s\nWebDAV status: %s\n", port, port, port, p.password, fileStatus)
	done := make(chan error, 1)
	go func() { done <- server.Serve(proxyTrackingListener{Listener: listener, proxy: p}) }()
	select {
	case <-proxyCtx.Done():
	case err := <-done:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			fmt.Fprintln(stderr, "proxy listener failed")
			return 1
		}
	}
	_ = server.Close()
	p.mu.Lock()
	connections := make([]net.Conn, 0, len(p.conns))
	for conn := range p.conns {
		connections = append(connections, conn)
	}
	p.mu.Unlock()
	for _, conn := range connections {
		_ = conn.Close()
	}
	if code := p.stopCode.Load(); code != 0 {
		return int(code)
	}
	return 130
}

func (p *userProxy) sessionLost() {
	p.stopOnce.Do(func() {
		p.stopCode.Store(3)
		fmt.Fprintln(p.stderr, "AUTH_REQUIRED: Core session expired; restart the proxy after login.")
		p.cancel()
	})
}

func (p *userProxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodConnect {
		p.serveConnect(w, r)
		return
	}
	if r.Method == http.MethodGet && r.RequestURI == "/proxy.pac" {
		if !isLoopbackPeer(r.RemoteAddr) {
			proxyJSONError(w, 403, "PAC_LOCAL_ONLY")
			return
		}
		body := fmt.Sprintf("function FindProxyForURL(url, host) {\n  if (/^(http|ws):\\/\\//i.test(url) && /^[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?\\.w-[a-f0-9]{8,61}\\.work\\.?$/i.test(host)) return \"PROXY 127.0.0.1:%d\";\n  return \"DIRECT\";\n}\n", p.port)
		w.Header().Set("Content-Type", "application/x-ns-proxy-autoconfig")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Length", strconv.Itoa(len(body)))
		_, _ = io.WriteString(w, body)
		return
	}
	if strings.HasPrefix(r.RequestURI, "/works/") {
		p.serveFile(w, r)
		return
	}
	target, err := parseServiceTarget(r)
	if err != nil {
		proxyJSONError(w, 403, "PROXY_TARGET_DENIED")
		return
	}
	if p.sameFileCredential(r.Header.Get("Authorization")) {
		proxyJSONError(w, 403, "LOCAL_CREDENTIAL_TARGET_DENIED")
		return
	}
	if err := p.resolveService(r.Context(), target); err != nil {
		p.proxyResolutionFailure(w, err)
		return
	}
	upstreamPath := "/api/v1/service-gateway/" + target.hostname + "/" + strconv.Itoa(target.port) + target.rawPath
	parsed, err := url.ParseRequestURI(upstreamPath)
	if err != nil {
		proxyJSONError(w, 403, "PROXY_TARGET_DENIED")
		return
	}
	upstream := &httputil.ReverseProxy{
		Transport:     &http.Transport{Proxy: nil, DialContext: (&net.Dialer{Timeout: 10 * time.Second}).DialContext, DisableCompression: true, DisableKeepAlives: true, MaxResponseHeaderBytes: 32 << 10},
		FlushInterval: -1, ErrorLog: log.New(io.Discard, "", 0),
		Rewrite: func(pr *httputil.ProxyRequest) {
			pr.Out.URL = &url.URL{Scheme: p.api.Base.Scheme, Host: p.api.Base.Host, Path: parsed.Path, RawPath: parsed.RawPath, RawQuery: parsed.RawQuery, ForceQuery: parsed.ForceQuery}
			pr.Out.Host = p.api.Base.Host
			for name := range pr.Out.Header {
				lower := strings.ToLower(name)
				if strings.HasPrefix(lower, "proxy-") || strings.HasPrefix(lower, "x-piwork-gateway-") {
					pr.Out.Header.Del(name)
				}
			}
			pr.Out.Header.Set("X-Piwork-Gateway-Token", p.api.Token)
		},
		ModifyResponse: func(response *http.Response) error {
			if response.StatusCode == 401 && response.Header.Get("X-Piwork-Gateway-Error") == "1" {
				p.sessionLost()
			}
			return nil
		},
		ErrorHandler: func(w http.ResponseWriter, _ *http.Request, _ error) { proxyJSONError(w, 502, "CORE_UNAVAILABLE") },
	}
	upstream.ServeHTTP(w, r)
}

type serviceTarget struct {
	hostname string
	port     int
	rawPath  string
}

func parseServiceTarget(r *http.Request) (serviceTarget, error) {
	bad := errors.New("target denied")
	websocket := strings.EqualFold(r.Header.Get("Upgrade"), "websocket") && headerHasToken(r.Header.Get("Connection"), "upgrade")
	validScheme := r.URL.Scheme == "http" && strings.HasPrefix(strings.ToLower(r.RequestURI), "http://") ||
		websocket && r.URL.Scheme == "ws" && strings.HasPrefix(strings.ToLower(r.RequestURI), "ws://")
	if !validScheme || !r.URL.IsAbs() || r.URL.User != nil || r.URL.Fragment != "" {
		return serviceTarget{}, bad
	}
	host := strings.TrimSuffix(strings.ToLower(r.URL.Hostname()), ".")
	if !serviceDomainPattern.MatchString(host) {
		return serviceTarget{}, bad
	}
	port := 80
	if value := r.URL.Port(); value != "" {
		var err error
		port, err = strconv.Atoi(value)
		if err != nil || port < 1 || port > 65535 {
			return serviceTarget{}, bad
		}
	}
	path := r.URL.EscapedPath()
	if path == "" {
		path = "/"
	}
	if r.URL.ForceQuery || r.URL.RawQuery != "" {
		path += "?" + r.URL.RawQuery
	}
	return serviceTarget{hostname: host, port: port, rawPath: path}, nil
}

func (p *userProxy) resolveService(ctx context.Context, target serviceTarget) error {
	path := "/api/v1/service-access/resolve?hostname=" + url.QueryEscape(target.hostname) + "&port=" + strconv.Itoa(target.port)
	response, err := p.api.Binary(ctx, http.MethodGet, path, http.Header{"X-Piwork-Gateway-Token": {p.api.Token}}, nil, 0)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, 32769))
	if err != nil || len(raw) > 32768 {
		return &client.APIError{Code: "MALFORMED_RESPONSE", Text: "Core returned malformed service resolution"}
	}
	var view struct {
		Code      string `json:"code"`
		Message   string `json:"message"`
		Hostname  string `json:"hostname"`
		WorkID    string `json:"workId"`
		ServiceID string `json:"serviceId"`
		Port      int    `json:"port"`
	}
	if json.Unmarshal(raw, &view) != nil {
		return &client.APIError{Code: "MALFORMED_RESPONSE", Text: "Core returned malformed service resolution"}
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		if view.Code == "" {
			view.Code = "REQUEST_FAILED"
		}
		return &client.APIError{Status: response.StatusCode, Code: view.Code, Text: view.Message}
	}
	// Port 80 is the Core-defined default Web alias. Resolve returns its
	// declared container port, which can differ from 80.
	if view.Hostname != target.hostname || view.WorkID == "" || view.ServiceID == "" || view.Port < 1 || view.Port > 65535 || target.port != 80 && view.Port != target.port {
		return &client.APIError{Code: "MALFORMED_RESPONSE", Text: "Core returned mismatched service resolution"}
	}
	return nil
}

func (p *userProxy) proxyResolutionFailure(w http.ResponseWriter, err error) {
	var apiErr *client.APIError
	if errors.As(err, &apiErr) {
		if apiErr.Status == 401 {
			p.sessionLost()
		}
		status := apiErr.Status
		if status < 400 || status > 599 {
			status = 502
		}
		proxyJSONError(w, status, apiErr.Code)
		return
	}
	proxyJSONError(w, 502, "CORE_UNAVAILABLE")
}

func isLoopbackPeer(remote string) bool {
	host, _, err := net.SplitHostPort(remote)
	if err != nil {
		return false
	}
	address := net.ParseIP(host)
	return address != nil && address.IsLoopback()
}

func proxyJSONError(w http.ResponseWriter, status int, code string) {
	if code == "" {
		code = "CORE_UNAVAILABLE"
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"code": code})
}
