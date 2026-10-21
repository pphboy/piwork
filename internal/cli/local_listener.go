package cli

import (
	"net"
	"net/http"
	"strconv"
)

func listenCLILocal(port int) (net.Listener, error) {
	return net.Listen("tcp4", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)))
}

func (p *userProxy) localPeer(remote string) bool {
	return isLoopbackPeer(remote)
}

func (p *userProxy) localRequest(r *http.Request) bool {
	host := "127.0.0.1:" + strconv.Itoa(p.port)
	localhost := "localhost:" + strconv.Itoa(p.port)
	return p.localPeer(r.RemoteAddr) && (r.Host == host || r.Host == localhost) &&
		(r.Header.Get("Origin") == "" || r.Header.Get("Origin") == "http://"+r.Host) &&
		r.Header.Get("Sec-Fetch-Site") != "cross-site" && r.Header.Get("Upgrade") == ""
}
