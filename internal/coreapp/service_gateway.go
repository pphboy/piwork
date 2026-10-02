package coreapp

import (
	"bufio"
	"context"
	"database/sql"
	"errors"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"piwork/internal/contracts"
	"piwork/internal/corestore"
)

const gatewayCredential = "X-Piwork-Gateway-Token"
const gatewayMarker = "X-Piwork-Gateway-Error"

var gatewayPathPattern = regexp.MustCompile(`^/api/v1/service-gateway/([^/?]+)/([0-9]{1,5})(/[^?]*)?(\?.*)?$`)

type gatewayTarget struct {
	Hostname, WorkID, ServiceID, UserID, Token, Address string
	Port                                                int64
}
type serviceGateway struct {
	app                   *Application
	route                 func(context.Context, string, string) (string, error)
	transport             http.RoundTripper
	mu                    sync.Mutex
	active                int
	byUser                map[string]int
	totalLimit, userLimit int
}

func newServiceGateway(a *Application) *serviceGateway {
	g := &serviceGateway{app: a, byUser: make(map[string]int), totalLimit: 256, userLimit: 64,
		transport: &http.Transport{Proxy: nil, DialContext: (&net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}).DialContext, DisableCompression: true, DisableKeepAlives: true, MaxResponseHeaderBytes: 32 << 10}}
	g.route = func(ctx context.Context, workID, serviceID string) (string, error) {
		view, _, err := a.inspectServiceRuntime(ctx, workID, serviceID)
		if err != nil || view == nil || view.State == nil || !view.State.Running {
			return "", contracts.NewError("SERVICE_UPSTREAM_UNAVAILABLE", "")
		}
		var bridge corestore.ResourceBinding
		if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
			var err error
			bridge, err = corestore.ReadResourceBinding(tx, a.Store.InstallationID(), workID, "network", workID)
			return err
		}); err != nil {
			return "", err
		}
		return a.dockerRuntime.ContainerAddress(ctx, serviceContainerIdentity(workID, serviceID, 0), bridge.RuntimeID)
	}
	return g
}
func (g *serviceGateway) accepting() bool { return g.app.Status().Ready }
func (g *serviceGateway) authorize(ctx context.Context, r *http.Request, hostname string, requested *int64) (gatewayTarget, error) {
	var target gatewayTarget
	if !g.accepting() {
		return target, contracts.NewError("SERVICE_UNAVAILABLE", "")
	}
	size := len(r.Host) + 4
	for key, values := range r.Header {
		for _, value := range values {
			size += len(key) + len(value) + 4
		}
	}
	if size > 32<<10 {
		return target, contracts.NewError("HEADERS_TOO_LARGE", "")
	}
	tokens := r.Header.Values(gatewayCredential)
	if len(tokens) != 1 || tokens[0] == "" {
		return target, contracts.NewError("AUTH_REQUIRED", "")
	}
	session, err := g.app.Identity.Authenticate(ctx, tokens[0])
	if err != nil {
		return target, contracts.NewError("AUTH_REQUIRED", "")
	}
	resolver := g.app.serviceDomains()
	work, service, err := resolver.lookup(ctx, hostname)
	if err != nil || work.OwnerUserID != session.User.ID {
		return target, contracts.NewError("NOT_FOUND", "")
	}
	if !serviceEligible(work, service) {
		return target, contracts.NewError("SERVICE_UNAVAILABLE", "")
	}
	port, err := selectedServicePort(service, requested)
	if err != nil {
		return target, err
	}
	address, err := g.route(ctx, work.ID, service.ServiceID)
	if err != nil || net.ParseIP(address) == nil {
		return target, contracts.NewError("SERVICE_UPSTREAM_UNAVAILABLE", "")
	}
	normalized, _ := normalizeServiceHostname(hostname)
	return gatewayTarget{Hostname: normalized, WorkID: work.ID, ServiceID: service.ServiceID, Port: port, Address: address, Token: tokens[0], UserID: session.User.ID}, nil
}
func (g *serviceGateway) quickCheck(ctx context.Context, target gatewayTarget) bool {
	if !g.accepting() {
		return false
	}
	session, err := g.app.Identity.Authenticate(ctx, target.Token)
	if err != nil || session.User.ID != target.UserID {
		return false
	}
	var valid bool
	err = g.app.Store.Read(ctx, func(tx *sql.Tx) error {
		work, err := corestore.ReadWork(tx, target.WorkID, false)
		if err != nil {
			return err
		}
		service, err := corestore.ReadService(tx, target.WorkID, target.ServiceID, false)
		if err != nil {
			return err
		}
		valid = work.OwnerUserID == target.UserID && serviceEligible(work, service)
		if !valid {
			return nil
		}
		port, err := selectedServicePort(service, &target.Port)
		valid = err == nil && port == target.Port
		return nil
	})
	return err == nil && valid
}
func (g *serviceGateway) review(ctx context.Context, target gatewayTarget, cancel context.CancelFunc) {
	timer := time.NewTicker(200 * time.Millisecond)
	defer timer.Stop()
	elapsed := 0
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
			check, stop := context.WithTimeout(ctx, 750*time.Millisecond)
			valid := g.quickCheck(check, target)
			elapsed++
			if valid && elapsed >= 5 {
				elapsed = 0
				address, err := g.route(check, target.WorkID, target.ServiceID)
				valid = err == nil && address == target.Address
			}
			stop()
			if !valid {
				cancel()
				return
			}
		}
	}
}
func (g *serviceGateway) reserve(user string) (func(), error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.active >= g.totalLimit || g.byUser[user] >= g.userLimit {
		return nil, contracts.NewError("SERVICE_ACCESS_LIMIT", "")
	}
	g.active++
	g.byUser[user]++
	var once sync.Once
	return func() {
		once.Do(func() {
			g.mu.Lock()
			defer g.mu.Unlock()
			g.active--
			g.byUser[user]--
			if g.byUser[user] == 0 {
				delete(g.byUser, user)
			}
		})
	}, nil
}
func gatewayFail(w http.ResponseWriter, err error) {
	status, view := contracts.ProjectError(err)
	// Keep the established gateway distinction between undeclared port and a
	// malformed or unavailable target, without changing control API errors.
	if view.Code == "PORT_NOT_DECLARED" {
		status = 404
	}
	w.Header().Set(gatewayMarker, "1")
	w.Header().Set("Cache-Control", "no-store")
	send(w, status, map[string]string{"code": view.Code, "message": "service access failed"})
}
func stripGatewayHeaders(header http.Header) {
	for key := range header {
		lower := strings.ToLower(key)
		if strings.HasPrefix(lower, "proxy-") || strings.HasPrefix(lower, "x-piwork-gateway-") {
			header.Del(key)
		}
	}
}

// ReverseProxy closes the backend on cancellation. Track its hijacked frontend
// too, so an idle WebSocket cannot keep the second copy goroutine alive.
type gatewayWriter struct {
	http.ResponseWriter
	ctx  context.Context
	stop func() bool
}

type gatewayBufferedConn struct {
	net.Conn
	reader *bufio.Reader
}

func (conn *gatewayBufferedConn) Read(buffer []byte) (int, error) { return conn.reader.Read(buffer) }

func (w *gatewayWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }
func (w *gatewayWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	conn, buffer, err := http.NewResponseController(w.ResponseWriter).Hijack()
	if err == nil {
		frontend := conn
		w.stop = context.AfterFunc(w.ctx, func() { frontend.Close() })
		// net/http may have already read the first WebSocket frames with the
		// upgrade headers. ReverseProxy copies from Conn, so preserve that head.
		conn = &gatewayBufferedConn{Conn: conn, reader: buffer.Reader}
	}
	return conn, buffer, err
}
func (g *serviceGateway) serve(w http.ResponseWriter, r *http.Request) {
	resolve := r.URL.Path == "/api/v1/service-access/resolve"
	var hostname, rawPath string
	var port *int64
	requestedPort := int64(0)
	if resolve {
		query := r.URL.Query()
		if len(query["hostname"]) != 1 || len(query["port"]) > 1 {
			gatewayFail(w, contracts.NewError("INVALID_REQUEST", ""))
			return
		}
		hostname = query.Get("hostname")
		if value := query.Get("port"); value != "" {
			parsed, err := strconv.ParseInt(value, 10, 64)
			if err != nil {
				gatewayFail(w, contracts.NewError("PORT_NOT_DECLARED", ""))
				return
			}
			requestedPort = parsed
			port = &requestedPort
		}
	} else {
		match := gatewayPathPattern.FindStringSubmatch(r.URL.RequestURI())
		if match == nil {
			gatewayFail(w, contracts.NewError("NOT_FOUND", ""))
			return
		}
		hostname = match[1]
		requestedPort, _ = strconv.ParseInt(match[2], 10, 64)
		port = &requestedPort
		rawPath = match[3]
		if rawPath == "" {
			rawPath = "/"
		}
		rawPath += match[4]
	}
	authCtx, stop := context.WithTimeout(r.Context(), 10*time.Second)
	target, err := g.authorize(authCtx, r, hostname, port)
	stop()
	if err != nil {
		gatewayFail(w, err)
		return
	}
	if resolve {
		send(w, 200, map[string]any{"hostname": target.Hostname, "workId": target.WorkID, "serviceId": target.ServiceID, "port": target.Port})
		return
	}
	if r.Method == http.MethodConnect || r.Header.Get("Upgrade") != "" && !strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
		gatewayFail(w, contracts.NewError("INVALID_REQUEST", ""))
		return
	}
	release, err := g.reserve(target.UserID)
	if err != nil {
		gatewayFail(w, err)
		return
	}
	defer release()
	path, err := url.ParseRequestURI(rawPath)
	if err != nil || path.IsAbs() || path.Host != "" {
		gatewayFail(w, contracts.NewError("INVALID_REQUEST", ""))
		return
	}
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	writer := &gatewayWriter{ResponseWriter: w, ctx: ctx}
	defer func() {
		if writer.stop != nil {
			writer.stop()
		}
	}()
	go g.review(ctx, target, cancel)
	deadlines := context.AfterFunc(ctx, func() {
		controller := http.NewResponseController(w)
		_ = controller.SetWriteDeadline(time.Now())
		_ = controller.SetReadDeadline(time.Now())
	})
	defer deadlines()
	proxy := &httputil.ReverseProxy{
		Transport: g.transport, FlushInterval: -1, ErrorLog: log.New(io.Discard, "", 0),
		Rewrite: func(pr *httputil.ProxyRequest) {
			pr.Out.URL = &url.URL{Scheme: "http", Host: net.JoinHostPort(target.Address, strconv.FormatInt(target.Port, 10)), Path: path.Path, RawPath: path.RawPath, RawQuery: path.RawQuery, ForceQuery: path.ForceQuery}
			pr.Out.Host = target.Hostname
			if requestedPort != 80 {
				pr.Out.Host = net.JoinHostPort(target.Hostname, strconv.FormatInt(requestedPort, 10))
			}
			stripGatewayHeaders(pr.Out.Header)
		},
		ModifyResponse: func(response *http.Response) error { stripGatewayHeaders(response.Header); return nil },
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			if !errors.Is(err, context.Canceled) {
				gatewayFail(w, contracts.NewError("SERVICE_UPSTREAM_UNAVAILABLE", ""))
			}
		},
	}
	proxy.ServeHTTP(writer, r.WithContext(ctx))
}
