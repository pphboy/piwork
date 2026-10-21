package cli

import (
	"net"
	"net/http"
	"testing"
)

func TestRetiredContainerEnvironmentCannotExposeNativeClient(t *testing.T) {
	for _, value := range []string{"1", "invalid"} {
		t.Run(value, func(t *testing.T) {
			t.Setenv("PIWORK_CLI_CONTAINER_MODE", value)
			l, err := listenCLILocal(0)
			if err != nil {
				t.Fatal(err)
			}
			defer l.Close()
			if !l.Addr().(*net.TCPAddr).IP.IsLoopback() {
				t.Fatal("client exposed externally")
			}
			p := &userProxy{port: 17890}
			if p.localRequest(&http.Request{Host: "localhost:17890", RemoteAddr: "192.0.2.1:12345", Header: http.Header{}}) {
				t.Fatal("external peer accepted")
			}
		})
	}
}
