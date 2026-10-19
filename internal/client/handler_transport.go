package client

import (
	"context"
	"errors"
	"net"
	"net/http"
	"sync"
	"time"
)

// HandlerTransport calls the same in-process Core handler through private pipes.
// HTTP framing preserves streaming bodies and WebSocket upgrades without an
// extra TCP listener, self-signed TLS bypass, or buffering an entire download.
type HandlerTransport struct {
	transport *http.Transport
	server    *http.Server
	listener  *handlerListener
}

func NewHandlerTransport(ctx context.Context, handler http.Handler) *HandlerTransport {
	l := &handlerListener{pending: make(chan net.Conn), done: make(chan struct{}), connections: map[*handlerConn]bool{}}
	t := &HandlerTransport{listener: l, server: &http.Server{Handler: handler, ReadHeaderTimeout: 10 * time.Second}}
	t.transport = &http.Transport{DialContext: l.dial, MaxConnsPerHost: 128, MaxIdleConnsPerHost: 16, IdleConnTimeout: 90 * time.Second, MaxResponseHeaderBytes: 32 << 10}
	go func() { _ = t.server.Serve(l) }()
	context.AfterFunc(ctx, t.Close)
	return t
}

func (t *HandlerTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	r := request.Clone(request.Context())
	u := *request.URL
	u.Scheme = "http" // The private pipe is not an external TLS connection.
	r.URL = &u
	return t.transport.RoundTrip(r)
}

func (t *HandlerTransport) Close() {
	t.transport.CloseIdleConnections()
	_ = t.listener.Close()
	_ = t.server.Close()
}

type handlerListener struct {
	mu          sync.Mutex
	pending     chan net.Conn
	done        chan struct{}
	closed      bool
	connections map[*handlerConn]bool
}

func (l *handlerListener) dial(ctx context.Context, _, _ string) (net.Conn, error) {
	client, server := net.Pipe()
	c := &handlerConn{Conn: server, owner: l}
	l.mu.Lock()
	if l.closed {
		l.mu.Unlock()
		_ = client.Close()
		_ = server.Close()
		return nil, net.ErrClosed
	}
	l.connections[c] = true
	l.mu.Unlock()
	select {
	case l.pending <- c:
		return client, nil
	case <-ctx.Done():
		_ = c.Close()
		_ = client.Close()
		return nil, ctx.Err()
	case <-l.done:
		_ = c.Close()
		_ = client.Close()
		return nil, net.ErrClosed
	}
}

func (l *handlerListener) Accept() (net.Conn, error) {
	select {
	case <-l.done:
		return nil, net.ErrClosed
	case conn := <-l.pending:
		return conn, nil
	}
}
func (l *handlerListener) Addr() net.Addr { return handlerAddress{} }
func (l *handlerListener) Close() error {
	l.mu.Lock()
	if l.closed {
		l.mu.Unlock()
		return nil
	}
	l.closed = true
	close(l.done)
	connections := make([]*handlerConn, 0, len(l.connections))
	for conn := range l.connections {
		connections = append(connections, conn)
	}
	l.mu.Unlock()
	for _, conn := range connections {
		_ = conn.Close()
	}
	return nil
}

type handlerAddress struct{}

func (handlerAddress) Network() string { return "in-process" }
func (handlerAddress) String() string  { return "127.0.0.1:0" }

type handlerConn struct {
	net.Conn
	owner *handlerListener
}

func (c *handlerConn) Close() error {
	c.owner.mu.Lock()
	delete(c.owner.connections, c)
	c.owner.mu.Unlock()
	err := c.Conn.Close()
	if errors.Is(err, net.ErrClosed) {
		return nil
	}
	return err
}
