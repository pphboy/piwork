package cli

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"

	"piwork/internal/client"
)

const testServiceDomain = "notes.w-a1b2c3d4.work"
const testProxyWorkID = "work-a1b2c3d4-5678"

func testUserProxy(t *testing.T, core http.HandlerFunc) *userProxy {
	t.Helper()
	upstream := nonLoopbackCore(t, core)
	t.Cleanup(upstream.Close)
	api, err := client.New(upstream.URL, "core-secret")
	if err != nil {
		t.Fatal(err)
	}
	return &userProxy{api: api, port: 17890, password: "local-secret", stderr: io.Discard, cancel: func() {}, conns: make(map[net.Conn]struct{})}
}

func TestNativeProxyTargetsAndLocalFileCredential(t *testing.T) {
	if port, err := parseUserProxyPort(nil); err != nil || port != 17890 {
		t.Fatal(port, err)
	}
	for _, args := range [][]string{{"--port"}, {"--port", "0"}, {"--port", "65536"}, {"--port", "a"}} {
		if _, err := parseUserProxyPort(args); err == nil {
			t.Fatal("accepted invalid port", args)
		}
	}
	core := testUserProxy(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/service-access/resolve" {
			if r.Header.Get("X-Piwork-Gateway-Token") != "core-secret" {
				t.Error("Core did not receive gateway credential")
			}
			_, _ = io.WriteString(w, `{"hostname":"notes.w-a1b2c3d4.work","workId":"work-a1b2c3d4-5678","serviceId":"service-test","port":8099}`)
			return
		}
		if r.Header.Get("X-Piwork-Gateway-Token") != "core-secret" || r.Header.Get("Proxy-Authorization") != "" {
			t.Error("gateway header isolation failed")
		}
		w.Header().Add("Set-Cookie", "app=one")
		w.Header().Add("Set-Cookie", "theme=two")
		_, _ = io.WriteString(w, r.URL.RequestURI()+"|"+r.Header.Get("Authorization"))
	})
	request := httptest.NewRequest(http.MethodGet, "http://"+testServiceDomain+"/%2e%2e/raw/%252e?x=%2f", nil)
	request.Header.Set("Authorization", "Bearer application-token")
	response := httptest.NewRecorder()
	core.ServeHTTP(response, request)
	if response.Code != 200 || !strings.Contains(response.Body.String(), "/%2e%2e/raw/%252e?x=%2f|Bearer application-token") || len(response.Result().Cookies()) != 2 {
		t.Fatal(response.Code, response.Body.String(), response.Result().Header)
	}
	request = httptest.NewRequest(http.MethodGet, "http://"+testServiceDomain+"/works/"+testProxyWorkID+"/files/same.txt", nil)
	request.Header.Set("Authorization", "Bearer application-token")
	response = httptest.NewRecorder()
	core.ServeHTTP(response, request)
	if response.Code != 200 || !strings.Contains(response.Body.String(), "/api/v1/service-gateway/"+testServiceDomain+"/80/works/"+testProxyWorkID+"/files/same.txt|Bearer application-token") {
		t.Fatal("application file-shaped path entered platform WebDAV", response.Code, response.Body.String())
	}
	for _, denied := range []string{"http://example.com/", "https://" + testServiceDomain + "/", "/local"} {
		request = httptest.NewRequest(http.MethodGet, denied, nil)
		response = httptest.NewRecorder()
		core.ServeHTTP(response, request)
		if response.Code != 403 {
			t.Fatal("unexpected target accepted", denied, response.Code)
		}
	}
	request = httptest.NewRequest(http.MethodGet, "http://"+testServiceDomain+"/", nil)
	request.Header.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte("piwork:local-secret")))
	response = httptest.NewRecorder()
	core.ServeHTTP(response, request)
	if response.Code != 403 || !strings.Contains(response.Body.String(), "LOCAL_CREDENTIAL_TARGET_DENIED") {
		t.Fatal(response.Code, response.Body.String())
	}
}

func TestNativeProxyFilePathAndMetadata(t *testing.T) {
	path := "/works/" + testProxyWorkID + "/files/folder/%E4%B8%AD%E6%96%87.txt"
	target, err := proxyFileCorePath(path)
	if err != nil || target.path != "/api/v1/works/"+testProxyWorkID+"/files/folder/%E4%B8%AD%E6%96%87.txt" {
		t.Fatal(target, err)
	}
	for _, bad := range []string{
		"/works/" + testProxyWorkID + "/files/a%2Fb",
		"/works/" + testProxyWorkID + "/files/%2e%2e",
		"/works/" + testProxyWorkID + "/files//bad",
		"/works/" + testProxyWorkID + "/files/name?query",
	} {
		if _, err := proxyFileCorePath(bad); err == nil {
			t.Fatal("unsafe file path accepted", bad)
		}
	}
	if _, err := proxyFileDestination("http://127.0.0.1:17890/works/work-00000000-0000/files/x", testProxyWorkID, "http://127.0.0.1:17890"); err == nil {
		t.Fatal("cross-Work destination accepted")
	}
	xmlBody := []byte(`<d:multistatus xmlns:d="DAV:"><d:response><d:href>/api/v1/works/` + testProxyWorkID + `/files/file.txt</d:href></d:response></d:multistatus>`)
	mapped, err := mapProxyDavXML(xmlBody, testProxyWorkID)
	if err != nil || !bytes.Contains(mapped, []byte("/works/"+testProxyWorkID+"/files/file.txt")) {
		t.Fatal(string(mapped), err)
	}
	if _, err := mapProxyDavXML([]byte(`<!DOCTYPE x><d:multistatus xmlns:d="DAV:"/>`), testProxyWorkID); err == nil {
		t.Fatal("DOCTYPE accepted")
	}
}

func TestNativeProxyPACIsScoped(t *testing.T) {
	p := &userProxy{port: 17890, cancel: func() {}, stderr: io.Discard}
	request := httptest.NewRequest(http.MethodGet, "/proxy.pac", nil)
	request.RemoteAddr = "127.0.0.1:30000"
	response := httptest.NewRecorder()
	p.ServeHTTP(response, request)
	if response.Code != 200 || !strings.Contains(response.Body.String(), "PROXY 127.0.0.1:17890") || !strings.Contains(response.Body.String(), "DIRECT") {
		t.Fatal(response.Code, response.Body.String())
	}
}

func TestNativeProxyWebDAVUsesCoreBearerAndMapsHrefs(t *testing.T) {
	core := testUserProxy(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/file-access":
			if r.Header.Get("Authorization") != "Bearer core-secret" {
				t.Error("capability probe was not authenticated")
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"version": 1, "protocol": "webdav", "profile": "workspace-transfer-v1", "rootTemplate": "/api/v1/works/{workId}/files/", "available": true, "reason": nil, "limits": proxyFileExpectedLimits})
		case "/api/v1/works/" + testProxyWorkID + "/files/":
			if r.Header.Get("Authorization") != "Bearer core-secret" || r.Header.Get("Cookie") != "" || r.Header.Get("Proxy-Authorization") != "" || r.Header.Get("Destination") != "" {
				t.Error("local file credentials or browser headers leaked to Core")
			}
			w.Header().Set("Content-Type", "application/xml")
			w.WriteHeader(207)
			_, _ = io.WriteString(w, `<d:multistatus xmlns:d="DAV:"><d:response><d:href>/api/v1/works/`+testProxyWorkID+`/files/</d:href></d:response></d:multistatus>`)
		default:
			t.Error("unexpected Core route", r.URL.Path)
		}
	})
	request := httptest.NewRequest("PROPFIND", "/works/"+testProxyWorkID+"/files/", nil)
	request.Host = "127.0.0.1:17890"
	request.RemoteAddr = "127.0.0.1:30001"
	request.Header.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte("piwork:local-secret")))
	request.Header.Set("Cookie", "local=one")
	response := httptest.NewRecorder()
	core.ServeHTTP(response, request)
	if response.Code != 207 || !strings.Contains(response.Body.String(), "/works/"+testProxyWorkID+"/files/") || strings.Contains(response.Body.String(), "/api/v1/works/") {
		t.Fatal(response.Code, response.Body.String())
	}
	request = httptest.NewRequest("MOVE", "/works/"+testProxyWorkID+"/files/a", nil)
	request.Host = "127.0.0.1:17890"
	request.RemoteAddr = "127.0.0.1:30001"
	request.Header.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte("piwork:local-secret")))
	request.Header.Set("Destination", "http://127.0.0.1:17890/works/work-00000000-0000/files/b")
	response = httptest.NewRecorder()
	core.ServeHTTP(response, request)
	if response.Code != 403 || response.Header().Get("X-Piwork-File-Error") != "FILE_DESTINATION_DENIED" {
		t.Fatal(response.Code, response.Body.String())
	}
}

func TestNativeProxyFileFailuresDoNotRevokeApplicationAccess(t *testing.T) {
	fileStatus := 207
	cancelled := false
	proxy := testUserProxy(t, func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/api/v1/service-access/resolve":
			_, _ = io.WriteString(w, `{"hostname":"notes.w-a1b2c3d4.work","workId":"work-a1b2c3d4-5678","serviceId":"service-test","port":8099}`)
		case strings.HasPrefix(r.URL.Path, "/api/v1/service-gateway/"):
			w.WriteHeader(401) // This is the application's own login response.
		case r.URL.Path == "/api/v1/file-access":
			_ = json.NewEncoder(w).Encode(map[string]any{"version": 1, "protocol": "webdav", "profile": "workspace-transfer-v1", "rootTemplate": "/api/v1/works/{workId}/files/", "available": true, "reason": nil, "limits": proxyFileExpectedLimits})
		case strings.HasPrefix(r.URL.Path, "/api/v1/works/"):
			w.Header().Set("Content-Type", "application/xml")
			w.WriteHeader(fileStatus)
			if fileStatus == 207 {
				_, _ = io.WriteString(w, `<d:multistatus xmlns:d="DAV:"><d:response><d:href>/api/v1/works/`+testProxyWorkID+`/files/</d:href></d:response></d:multistatus>`)
			}
		default:
			t.Errorf("unexpected Core route: %s", r.URL.Path)
		}
	})
	proxy.cancel = func() { cancelled = true }
	serviceRequest := httptest.NewRequest(http.MethodGet, "http://"+testServiceDomain+"/private", nil)
	serviceResponse := httptest.NewRecorder()
	proxy.ServeHTTP(serviceResponse, serviceRequest)
	if serviceResponse.Code != 401 || cancelled || proxy.stopCode.Load() != 0 {
		t.Fatal("application login response revoked the platform session")
	}
	for _, status := range []int{207, 404, 503} {
		fileStatus = status
		request := httptest.NewRequest("PROPFIND", "/works/"+testProxyWorkID+"/files/", nil)
		request.Host = "127.0.0.1:17890"
		request.RemoteAddr = "127.0.0.1:30001"
		request.Header.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte("piwork:local-secret")))
		response := httptest.NewRecorder()
		proxy.ServeHTTP(response, request)
		if response.Code != status || cancelled || proxy.stopCode.Load() != 0 {
			t.Fatal("file status revoked a still-valid platform session", status, response.Code)
		}
	}
	fileStatus = 401
	request := httptest.NewRequest("PROPFIND", "/works/"+testProxyWorkID+"/files/", nil)
	request.Host = "127.0.0.1:17890"
	request.RemoteAddr = "127.0.0.1:30001"
	request.Header.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte("piwork:local-secret")))
	response := httptest.NewRecorder()
	proxy.ServeHTTP(response, request)
	if response.Code != 401 || !cancelled || proxy.stopCode.Load() != 3 {
		t.Fatal("Core 401 did not end the platform proxy session", response.Code)
	}
}

func TestNativeProxyLostFileWriteResponseDoesNotReplay(t *testing.T) {
	attempts := 0
	proxy := testUserProxy(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/file-access" {
			_ = json.NewEncoder(w).Encode(map[string]any{"version": 1, "protocol": "webdav", "profile": "workspace-transfer-v1", "rootTemplate": "/api/v1/works/{workId}/files/", "available": true, "reason": nil, "limits": proxyFileExpectedLimits})
			return
		}
		if r.Method != http.MethodPut || !strings.HasPrefix(r.URL.Path, "/api/v1/works/") {
			t.Errorf("unexpected Core request: %s %s", r.Method, r.URL.Path)
			return
		}
		attempts++
		_, _ = io.Copy(io.Discard, r.Body)
		conn, _, err := w.(http.Hijacker).Hijack()
		if err != nil {
			t.Error(err)
			return
		}
		_ = conn.Close() // The Core may have committed, but its reply was lost.
	})
	request := httptest.NewRequest(http.MethodPut, "/works/"+testProxyWorkID+"/files/data.txt", strings.NewReader("one write"))
	request.Host = "127.0.0.1:17890"
	request.RemoteAddr = "127.0.0.1:30001"
	request.Header.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte("piwork:local-secret")))
	response := httptest.NewRecorder()
	proxy.ServeHTTP(response, request)
	if attempts != 1 || response.Code != 502 || proxy.stopCode.Load() != 0 {
		t.Fatal("unknown file write result was replayed or revoked the session", attempts, response.Code)
	}
}

func TestNativeProxyInterruptedFileDownloadNeverAppendsErrorDocument(t *testing.T) {
	payload := []byte{0, 255, 13, 10, 7}
	proxy := testUserProxy(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/file-access" {
			json.NewEncoder(w).Encode(map[string]any{"version": 1, "protocol": "webdav", "profile": "workspace-transfer-v1", "rootTemplate": "/api/v1/works/{workId}/files/", "available": true, "reason": nil, "limits": proxyFileExpectedLimits})
			return
		}
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("Content-Length", "4096")
		w.Write(payload)
	})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { r.Host = "127.0.0.1:17890"; proxy.ServeHTTP(w, r) }))
	defer server.Close()
	req, _ := http.NewRequest("GET", server.URL+"/works/"+testProxyWorkID+"/files/data.bin", nil)
	req.SetBasicAuth("piwork", "local-secret")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal("download failed before its body", err)
	}
	defer res.Body.Close()
	data, err := io.ReadAll(res.Body)
	if err == nil || !bytes.Equal(data, payload) || res.StatusCode != 200 || res.Header.Get("Content-Type") != "application/octet-stream" {
		t.Fatal("interrupted binary body got a synthetic tail or false success", len(data), err, res.StatusCode)
	}
}

func TestNativeProxyWebSocketAndRestrictedConnect(t *testing.T) {
	core := testUserProxy(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/service-access/resolve" {
			_, _ = io.WriteString(w, `{"hostname":"notes.w-a1b2c3d4.work","workId":"work-a1b2c3d4-5678","serviceId":"service-test","port":8099}`)
			return
		}
		if r.URL.Path != "/api/v1/service-gateway/"+testServiceDomain+"/80/echo" || r.Header.Get("X-Piwork-Gateway-Token") != "core-secret" {
			t.Error("unexpected gateway request", r.URL.Path, r.Header)
			w.WriteHeader(400)
			return
		}
		conn, buffered, err := w.(http.Hijacker).Hijack()
		if err != nil {
			t.Error(err)
			return
		}
		defer conn.Close()
		_, _ = io.WriteString(conn, "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n")
		_, _ = io.Copy(conn, buffered)
	})
	proxy := httptest.NewServer(core)
	defer proxy.Close()
	proxyURL, _ := url.Parse(proxy.URL)
	connect := func(first string) (net.Conn, *bufio.Reader) {
		conn, err := net.Dial("tcp", proxyURL.Host)
		if err != nil {
			t.Fatal(err)
		}
		_ = conn.SetDeadline(time.Now().Add(3 * time.Second))
		reader := bufio.NewReader(conn)
		if _, err := io.WriteString(conn, first); err != nil {
			t.Fatal(err)
		}
		return conn, reader
	}
	readHead := func(reader *bufio.Reader) string {
		var head strings.Builder
		for {
			line, err := reader.ReadString('\n')
			if err != nil {
				t.Fatal(err)
			}
			head.WriteString(line)
			if line == "\r\n" {
				return head.String()
			}
		}
	}
	conn, reader := connect("GET http://" + testServiceDomain + "/echo HTTP/1.1\r\nHost: " + testServiceDomain + "\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n")
	if head := readHead(reader); !strings.Contains(head, "101 Switching Protocols") {
		t.Fatal(head)
	}
	_, _ = io.WriteString(conn, "first")
	buffer := make([]byte, 5)
	if _, err := io.ReadFull(reader, buffer); err != nil || string(buffer) != "first" {
		t.Fatal(string(buffer), err)
	}
	_ = conn.Close()
	conn, reader = connect("GET ws://" + testServiceDomain + "/echo HTTP/1.1\r\nHost: " + testServiceDomain + "\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n")
	if head := readHead(reader); !strings.Contains(head, "101 Switching Protocols") {
		t.Fatal(head)
	}
	_ = conn.Close()
	conn, reader = connect("CONNECT " + testServiceDomain + ":80 HTTP/1.1\r\nHost: " + testServiceDomain + ":80\r\n\r\n")
	if head := readHead(reader); !strings.Contains(head, "200 Connection Established") {
		t.Fatal(head)
	}
	_, _ = io.WriteString(conn, "GET /echo HTTP/1.1\r\nHost: "+testServiceDomain+"\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n")
	if head := readHead(reader); !strings.Contains(head, "101 Switching Protocols") {
		t.Fatal(head)
	}
	_, _ = io.WriteString(conn, "second")
	buffer = make([]byte, 6)
	if _, err := io.ReadFull(reader, buffer); err != nil || string(buffer) != "second" {
		t.Fatal(string(buffer), err)
	}
	_ = conn.Close()
	conn, reader = connect("CONNECT example.com:80 HTTP/1.1\r\nHost: example.com:80\r\n\r\n")
	if head := readHead(reader); !strings.Contains(head, "403 Forbidden") {
		t.Fatal(head)
	}
	_ = conn.Close()
}

func TestNativeProxyConcurrentStreamsCancelUpstreamAndKeepLargeFileBytes(t *testing.T) {
	sseCancelled := make(chan struct{}, 1)
	fileCancelled := make(chan struct{}, 1)
	content := bytes.Repeat([]byte("piwork-stream-data-"), 1<<18)
	proxy := testUserProxy(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/service-access/resolve":
			_, _ = io.WriteString(w, `{"hostname":"notes.w-a1b2c3d4.work","workId":"work-a1b2c3d4-5678","serviceId":"service-test","port":8099}`)
		case "/api/v1/service-gateway/" + testServiceDomain + "/80/events":
			w.Header().Set("Content-Type", "text/event-stream")
			_, _ = io.WriteString(w, "data: first\n\n")
			w.(http.Flusher).Flush()
			<-r.Context().Done()
			sseCancelled <- struct{}{}
		case "/api/v1/file-access":
			_ = json.NewEncoder(w).Encode(proxyFileCapability{Version: 1, Protocol: "webdav",
				Profile: "workspace-transfer-v1", RootTemplate: "/api/v1/works/{workId}/files/",
				Limits: proxyFileExpectedLimits, Available: true})
		case "/api/v1/works/" + testProxyWorkID + "/files/big":
			w.Header().Set("Content-Length", strconv.Itoa(len(content)))
			_, _ = w.Write(content)
		case "/api/v1/works/" + testProxyWorkID + "/files/slow":
			_, _ = w.Write([]byte("first-chunk"))
			w.(http.Flusher).Flush()
			<-r.Context().Done()
			fileCancelled <- struct{}{}
		default:
			http.NotFound(w, r)
		}
	})
	server := httptest.NewServer(proxy)
	defer server.Close()
	proxyURL, _ := url.Parse(server.URL)
	proxy.port, _ = strconv.Atoi(proxyURL.Port())
	serviceClient := &http.Client{Transport: &http.Transport{Proxy: http.ProxyURL(proxyURL)}}
	sseContext, cancelSSE := context.WithCancel(context.Background())
	defer cancelSSE()
	sseRequest, _ := http.NewRequestWithContext(sseContext, http.MethodGet, "http://"+testServiceDomain+"/events", nil)
	sseResponse, err := serviceClient.Do(sseRequest)
	if err != nil || sseResponse.StatusCode != 200 {
		t.Fatal("SSE did not start through proxy", err)
	}
	first := make([]byte, len("data: first\n\n"))
	if _, err := io.ReadFull(sseResponse.Body, first); err != nil || string(first) != "data: first\n\n" {
		t.Fatal("SSE stream changed", string(first), err)
	}
	fileRequest := func(ctx context.Context, name string) *http.Request {
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, server.URL+"/works/"+testProxyWorkID+"/files/"+name, nil)
		if err != nil {
			t.Fatal(err)
		}
		request.Header.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte("piwork:local-secret")))
		return request
	}
	fileClient := &http.Client{Timeout: 10 * time.Second}
	large, err := fileClient.Do(fileRequest(context.Background(), "big"))
	if err != nil || large.StatusCode != 200 {
		t.Fatal("large WebDAV download failed", err)
	}
	got, err := io.ReadAll(large.Body)
	large.Body.Close()
	if err != nil || !bytes.Equal(got, content) {
		t.Fatal("large WebDAV bytes changed", len(got), err)
	}
	fileContext, cancelFile := context.WithCancel(context.Background())
	slow, err := fileClient.Do(fileRequest(fileContext, "slow"))
	if err != nil || slow.StatusCode != 200 {
		t.Fatal("slow WebDAV download failed", err)
	}
	first = make([]byte, len("first-chunk"))
	if _, err := io.ReadFull(slow.Body, first); err != nil || string(first) != "first-chunk" {
		t.Fatal("slow WebDAV first bytes changed", string(first), err)
	}
	cancelFile()
	slow.Body.Close()
	cancelSSE()
	sseResponse.Body.Close()
	for name, cancelled := range map[string]chan struct{}{"SSE": sseCancelled, "WebDAV": fileCancelled} {
		select {
		case <-cancelled:
		case <-time.After(3 * time.Second):
			t.Fatal(name, "upstream retained after client cancellation")
		}
	}
}
