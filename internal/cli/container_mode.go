package cli

import (
	"errors"
	"net"
	"net/http"
	"os"
	"strconv"
)

// An explicit deployment flag is the only way to relax the TCP loopback
// assumption. Forwarded headers and platform detection do not enable it.
func cliContainerMode() (bool, error) {
	switch os.Getenv("PIWORK_CLI_CONTAINER_MODE") {
	case "1":
		return true, nil
	case "", "0":
		return false, nil
	default:
		return false, errors.New("PIWORK_CLI_CONTAINER_MODE must be 1, 0, or empty")
	}
}

func cliListenHost(container bool) string {
	if container {
		return "0.0.0.0"
	}
	return "127.0.0.1"
}

func listenCLILocal(port int, container bool) (net.Listener, error) {
	return net.Listen("tcp4", net.JoinHostPort(cliListenHost(container), strconv.Itoa(port)))
}

func (p *userProxy) localPeer(remote string) bool {
	return p.containerMode || isLoopbackPeer(remote)
}

func (p *userProxy) localRequest(r *http.Request) bool {
	host := "127.0.0.1:" + strconv.Itoa(p.port)
	localhost := "localhost:" + strconv.Itoa(p.port)
	return p.localPeer(r.RemoteAddr) && (r.Host == host || r.Host == localhost) &&
		(r.Header.Get("Origin") == "" || r.Header.Get("Origin") == "http://"+r.Host) &&
		r.Header.Get("Sec-Fetch-Site") != "cross-site" && r.Header.Get("Upgrade") == ""
}
