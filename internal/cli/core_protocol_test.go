package cli

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"io"
	"log"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"piwork/internal/client"
)

// Use a real non-loopback interface so network tests exercise the removed policy.
func nonLoopbackCore(t *testing.T, handler http.Handler) *httptest.Server {
	t.Helper()
	addresses, err := net.InterfaceAddrs()
	if err != nil {
		t.Fatal(err)
	}
	for _, address := range addresses {
		ip, _, err := net.ParseCIDR(address.String())
		if err != nil || ip.To4() == nil || !ip.IsGlobalUnicast() || ip.IsLoopback() {
			continue
		}
		listener, err := net.Listen("tcp", net.JoinHostPort(ip.String(), "0"))
		if err != nil {
			continue
		}
		server := httptest.NewUnstartedServer(handler)
		server.Listener.Close()
		server.Listener = listener
		server.Start()
		t.Cleanup(server.Close)
		return server
	}
	t.Fatal("non-loopback HTTP fixture requires a usable IPv4 interface")
	return nil
}

func TestDesktopHTTPConnectionAndSchemeBoundCredentials(t *testing.T) {
	var requests atomic.Int32
	core := nonLoopbackCore(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		if r.URL.Path != "/api/v1/me" || r.Header.Get("Authorization") != "Bearer fixture-token" {
			t.Error("unexpected identity request", r.URL.Path, r.Header.Get("Authorization"))
		}
		io.WriteString(w, `{"id":"owner","account":"owner","role":"user"}`)
	}))
	d := recoveryDesktop(t)
	d.sessions["fixture"] = desktopSession{id: "fixture", csrf: "csrf", end: time.Now().Add(time.Hour)}
	cookie := d.cookieName() + "=fixture"
	saved := client.Credential{Version: 1, CoreURL: strings.Replace(core.URL, "http:", "https:", 1), Token: "fixture-token", ExpiresAt: "2099-01-01T00:00:00Z", User: client.Identity{ID: "owner", Account: "owner", Role: "user"}}
	if err := d.store.Save(saved); err != nil {
		t.Fatal(err)
	}
	switchTo := func(raw string) *httptest.ResponseRecorder {
		body, _ := json.Marshal(map[string]string{"coreUrl": raw})
		return recoveryHTTP(d, "PUT", "/_desktop/api/connection", string(body), cookie, "csrf")
	}
	response := switchTo(core.URL + "/")
	if response.Code != 200 || d.identity.coreURL != core.URL || d.identity.credential != nil || requests.Load() != 0 {
		t.Fatal("scheme change reused token", response.Code, response.Body.String())
	}
	for _, raw := range []string{"http://remote.example/path", "ftp://remote.example", "http://user:secret@remote.example", "http://remote.example?q=x", "http://remote.example#x"} {
		response = switchTo(raw)
		if response.Code != 400 || !strings.Contains(response.Body.String(), "INVALID_CORE_URL") || d.identity.coreURL != core.URL {
			t.Fatal("invalid connection changed state", response.Code, response.Body.String())
		}
	}
	if response := recoveryHTTP(d, "PUT", "/_desktop/api/connection", `{"coreUrl":"http://remote.example"}`, cookie, "wrong"); response.Code != 403 {
		t.Fatal("HTTP bypassed CSRF", response.Code)
	}
	saved.CoreURL = core.URL + "/"
	if err := d.store.Save(saved); err != nil {
		t.Fatal(err)
	}
	response = switchTo(core.URL)
	if response.Code != 200 || d.identity.credential == nil || !strings.Contains(response.Body.String(), `"state":"authenticated"`) || requests.Load() != 1 {
		t.Fatal("same origin failed to reuse saved token", response.Code, response.Body.String())
	}
	response = switchTo(strings.Replace(core.URL, "http:", "https:", 1))
	if response.Code != 200 || d.identity.credential != nil || requests.Load() != 1 {
		t.Fatal("HTTP token crossed into HTTPS", response.Code, response.Body.String())
	}
}

func TestRemoteHTTPProxyCapabilityFailuresRemainAPIResults(t *testing.T) {
	for _, test := range []struct {
		status int
		body   string
		code   int
	}{
		{401, `{"code":"AUTH_REQUIRED","message":"login required"}`, 3},
		{404, `{"code":"NOT_FOUND","message":"unsupported"}`, 5},
		{200, `{"version":2,"protocols":["http"]}`, 5},
	} {
		core := nonLoopbackCore(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(test.status); io.WriteString(w, test.body) }))
		api, err := client.New(core.URL, "")
		if err != nil {
			t.Fatal(err)
		}
		var out, diagnostic bytes.Buffer
		if code := runUserProxy(api, nil, false, &out, &diagnostic); code != test.code || out.Len() != 0 {
			t.Fatal("HTTP rejected before capability/auth", code, diagnostic.String())
		}
	}
}

// The child has process-only trust roots. No system trust store or product option is changed.
func TestCoreTransportTLSHelperProcess(t *testing.T) {
	if os.Getenv("PIWORK_TEST_TLS_CHILD") != "1" {
		return
	}
	raw, err := os.ReadFile(os.Getenv("PIWORK_TEST_TLS_ROOT"))
	if err != nil {
		t.Fatal(err)
	}
	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM(raw) {
		t.Fatal("invalid fixture CA")
	}
	x509.SetFallbackRoots(roots)
	api, err := client.New(os.Getenv("PIWORK_TEST_TLS_CORE"), "fixture-token")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	wantFailure := os.Getenv("PIWORK_TEST_TLS_FAILURE") == "1"
	var response map[string]bool
	err = api.Request(ctx, "GET", "/probe", nil, &response)
	if (err != nil) != wantFailure || !wantFailure && !response["ok"] {
		t.Fatal("client transport result", err, response)
	}
	proxy := &userProxy{api: api}
	conn, err := proxy.dialCore(ctx)
	if (err != nil) != wantFailure {
		if conn != nil {
			conn.Close()
		}
		t.Fatal("proxy transport result", err)
	}
	if wantFailure {
		return
	}
	defer conn.Close()
	conn.SetDeadline(time.Now().Add(5 * time.Second))
	io.WriteString(conn, "GET /probe HTTP/1.1\r\nHost: "+api.Base.Host+"\r\nAuthorization: Bearer fixture-token\r\nConnection: close\r\n\r\n")
	data, err := io.ReadAll(conn)
	if err != nil || !bytes.Contains(data, []byte(`{"ok":true}`)) {
		t.Fatal("proxy stream failed", err, string(data))
	}
}

func TestCoreHTTPAndTLSValidationWithoutFallback(t *testing.T) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	ca := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "Test Core CA"}, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour), IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign}
	caDER, err := x509.CreateCertificate(rand.Reader, ca, ca, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	ca, err = x509.ParseCertificate(caDER)
	if err != nil {
		t.Fatal(err)
	}
	rootFile := filepath.Join(t.TempDir(), "root.pem")
	if err := os.WriteFile(rootFile, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: caDER}), 0600); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"http", "trusted", "untrusted", "expired", "wrong-name"} {
		t.Run(name, func(t *testing.T) {
			var calls atomic.Int32
			server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				if r.Header.Get("Authorization") != "Bearer fixture-token" {
					t.Error("missing transport credential")
				}
				io.WriteString(w, `{"ok":true}`)
			}))
			server.Config.ErrorLog = log.New(io.Discard, "", 0)
			if name == "http" {
				server.Start()
			} else {
				leaf := &x509.Certificate{SerialNumber: big.NewInt(2), NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour), IPAddresses: []net.IP{net.ParseIP("127.0.0.1")}, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}, KeyUsage: x509.KeyUsageDigitalSignature}
				if name == "expired" {
					leaf.NotBefore = time.Now().Add(-2 * time.Hour)
					leaf.NotAfter = time.Now().Add(-time.Hour)
				}
				if name == "wrong-name" {
					leaf.IPAddresses = nil
					leaf.DNSNames = []string{"other.example"}
				}
				parent := ca
				if name == "untrusted" {
					parent = leaf
				}
				der, err := x509.CreateCertificate(rand.Reader, leaf, parent, &key.PublicKey, key)
				if err != nil {
					t.Fatal(err)
				}
				server.TLS = &tls.Config{Certificates: []tls.Certificate{{Certificate: [][]byte{der}, PrivateKey: key}}}
				server.StartTLS()
			}
			defer server.Close()
			command := nativeTestCommand(t, "-test.run=^TestCoreTransportTLSHelperProcess$")
			failure := name != "http" && name != "trusted"
			failureValue := "0"
			if failure {
				failureValue = "1"
			}
			command.Env = append(os.Environ(), "PIWORK_TEST_TLS_CHILD=1", "PIWORK_TEST_TLS_ROOT="+rootFile, "PIWORK_TEST_TLS_CORE="+server.URL, "PIWORK_TEST_TLS_FAILURE="+failureValue, "GODEBUG=x509usefallbackroots=1")
			if output, err := command.CombinedOutput(); err != nil {
				t.Fatal(err, string(output))
			}
			want := int32(2)
			if failure {
				want = 0
			}
			if calls.Load() != want {
				t.Fatal("unexpected plaintext fallback or missing transport", calls.Load(), want)
			}
		})
	}
}
