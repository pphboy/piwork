package cli

import (
	"bufio"
	"context"
	"crypto/tls"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var connectUpgradeLine = regexp.MustCompile(`^GET (/[^ ]*) HTTP/1\.1$`)

func (p *userProxy) serveConnect(w http.ResponseWriter, r *http.Request) {
	bad := func(code string) { proxyJSONError(w, 403, code) }
	authority := r.RequestURI
	if strings.ContainsAny(authority, "/?#@") || strings.Count(authority, ":") != 1 {
		bad("PROXY_TARGET_DENIED")
		return
	}
	host, portText, err := net.SplitHostPort(authority)
	if err != nil || !serviceDomainPattern.MatchString(host) {
		bad("PROXY_TARGET_DENIED")
		return
	}
	port, err := strconv.Atoi(portText)
	if err != nil || port <= 0 || port > 65535 || port == 443 {
		bad("PROXY_TARGET_DENIED")
		return
	}
	target := serviceTarget{hostname: host, port: port}
	if err := p.resolveService(r.Context(), target); err != nil {
		p.proxyResolutionFailure(w, err)
		return
	}
	hijacker, ok := w.(http.Hijacker)
	if !ok {
		proxyJSONError(w, 502, "CORE_UNAVAILABLE")
		return
	}
	clientConn, buffered, err := hijacker.Hijack()
	if err != nil {
		return
	}
	defer clientConn.Close()
	if _, err := io.WriteString(clientConn, "HTTP/1.1 200 Connection Established\r\n\r\n"); err != nil {
		return
	}
	_ = clientConn.SetReadDeadline(time.Now().Add(10 * time.Second))
	line, headers, err := readConnectUpgrade(buffered.Reader)
	if err != nil || !connectUpgradeLine.MatchString(line) {
		return
	}
	path := connectUpgradeLine.FindStringSubmatch(line)[1]
	expected := host
	if port != 80 {
		expected = net.JoinHostPort(host, portText)
	}
	claimed := strings.TrimSuffix(strings.ToLower(headers.Get("Host")), ".")
	if claimed != expected && claimed != host+":"+portText || !strings.EqualFold(headers.Get("Upgrade"), "websocket") || !headerHasToken(headers.Get("Connection"), "upgrade") ||
		headers.Get("Content-Length") != "" || headers.Get("Transfer-Encoding") != "" || p.sameFileCredential(headers.Get("Authorization")) {
		return
	}
	if _, err := url.ParseRequestURI(path); err != nil {
		return
	}
	_ = clientConn.SetReadDeadline(time.Time{})
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	upstream, err := p.dialCore(ctx)
	if err != nil {
		return
	}
	defer upstream.Close()
	p.mu.Lock()
	p.conns[upstream] = struct{}{}
	p.mu.Unlock()
	defer func() { p.mu.Lock(); delete(p.conns, upstream); p.mu.Unlock() }()
	corePath := "/api/v1/service-gateway/" + host + "/" + portText + path
	if _, err := io.WriteString(upstream, "GET "+corePath+" HTTP/1.1\r\nHost: "+p.api.Base.Host+"\r\n"); err != nil {
		return
	}
	for name, values := range headers {
		lower := strings.ToLower(name)
		if lower == "host" || strings.HasPrefix(lower, "proxy-") || strings.HasPrefix(lower, "x-piwork-gateway-") {
			continue
		}
		for _, value := range values {
			if _, err := io.WriteString(upstream, name+": "+value+"\r\n"); err != nil {
				return
			}
		}
	}
	if _, err := io.WriteString(upstream, "X-Piwork-Gateway-Token: "+p.api.Token+"\r\n\r\n"); err != nil {
		return
	}
	_ = upstream.SetReadDeadline(time.Now().Add(10 * time.Second))
	upstreamReader := bufio.NewReaderSize(upstream, 32<<10)
	responseHead, err := readConnectResponseHead(upstreamReader)
	if err != nil {
		return
	}
	_ = upstream.SetReadDeadline(time.Time{})
	if responseHead.platform401 {
		p.sessionLost()
	}
	if _, err := clientConn.Write(responseHead.raw); err != nil {
		return
	}
	if responseHead.status != 101 {
		_, _ = io.Copy(clientConn, upstreamReader)
		return
	}
	// Buffered client bytes are first WebSocket frames, never a second HTTP
	// request. The tunnel is opened only after Core accepted this upgrade.
	if buffered.Reader.Buffered() > 0 {
		_, _ = io.CopyN(upstream, buffered.Reader, int64(buffered.Reader.Buffered()))
	}
	done := make(chan struct{})
	go func() { _, _ = io.Copy(upstream, clientConn); _ = upstream.Close(); close(done) }()
	_, _ = io.Copy(clientConn, upstreamReader)
	_ = clientConn.Close()
	<-done
}

func (p *userProxy) dialCore(ctx context.Context) (net.Conn, error) {
	address := p.api.Base.Host
	if p.api.Base.Port() == "" {
		if p.api.Base.Scheme == "https" {
			address = net.JoinHostPort(p.api.Base.Hostname(), "443")
		} else {
			address = net.JoinHostPort(p.api.Base.Hostname(), "80")
		}
	}
	conn, err := (&net.Dialer{Timeout: 10 * time.Second}).DialContext(ctx, "tcp", address)
	if err != nil {
		return nil, err
	}
	if p.api.Base.Scheme != "https" {
		return conn, nil
	}
	tlsConn := tls.Client(conn, &tls.Config{ServerName: p.api.Base.Hostname(), MinVersion: tls.VersionTLS12})
	if err := tlsConn.HandshakeContext(ctx); err != nil {
		_ = conn.Close()
		return nil, err
	}
	return tlsConn, nil
}

func readConnectUpgrade(reader *bufio.Reader) (string, http.Header, error) {
	line, count, err := readBoundedLine(reader, 0)
	if err != nil {
		return "", nil, err
	}
	headers := make(http.Header)
	for {
		part, next, err := readBoundedLine(reader, count)
		if err != nil {
			return "", nil, err
		}
		count = next
		if part == "" {
			return line, headers, nil
		}
		colon := strings.IndexByte(part, ':')
		if colon <= 0 || part[0] == ' ' || part[0] == '\t' {
			return "", nil, errors.New("invalid CONNECT header")
		}
		name := http.CanonicalHeaderKey(part[:colon])
		if !validHeaderName(name) || len(headers.Values(name)) != 0 {
			return "", nil, errors.New("duplicate or invalid CONNECT header")
		}
		value := strings.TrimSpace(part[colon+1:])
		if strings.ContainsAny(value, "\r\n\x00") {
			return "", nil, errors.New("invalid CONNECT header")
		}
		headers.Set(name, value)
	}
}

func readBoundedLine(reader *bufio.Reader, count int) (string, int, error) {
	raw, err := reader.ReadSlice('\n')
	count += len(raw)
	if err != nil || count > 32<<10 || len(raw) < 2 || raw[len(raw)-2] != '\r' {
		return "", count, errors.New("HTTP headers too large or malformed")
	}
	return string(raw[:len(raw)-2]), count, nil
}

func validHeaderName(name string) bool {
	if name == "" {
		return false
	}
	for _, ch := range name {
		if ch <= ' ' || ch >= 127 || strings.ContainsRune("():<>@,;\\\"/[]?={}", ch) {
			return false
		}
	}
	return true
}

func headerHasToken(value, expected string) bool {
	for _, part := range strings.Split(value, ",") {
		if strings.EqualFold(strings.TrimSpace(part), expected) {
			return true
		}
	}
	return false
}

type connectResponseHead struct {
	raw         []byte
	status      int
	platform401 bool
}

func readConnectResponseHead(reader *bufio.Reader) (connectResponseHead, error) {
	var head connectResponseHead
	line, count, err := readBoundedLine(reader, 0)
	if err != nil || !strings.HasPrefix(line, "HTTP/1.") {
		return head, errors.New("malformed Core upgrade response")
	}
	fields := strings.Fields(line)
	if len(fields) < 2 {
		return head, errors.New("malformed Core upgrade status")
	}
	head.status, err = strconv.Atoi(fields[1])
	if err != nil {
		return head, err
	}
	head.raw = append(head.raw, []byte(line+"\r\n")...)
	for {
		part, next, err := readBoundedLine(reader, count)
		if err != nil {
			return head, err
		}
		count = next
		if part == "" {
			head.raw = append(head.raw, '\r', '\n')
			break
		}
		if strings.EqualFold(part, "X-Piwork-Gateway-Error: 1") && head.status == 401 {
			head.platform401 = true
		}
		head.raw = append(head.raw, []byte(part+"\r\n")...)
	}
	return head, nil
}
