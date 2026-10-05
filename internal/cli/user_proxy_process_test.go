package cli

import (
	"bufio"
	"encoding/base64"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"piwork/internal/client"
)

func TestNativeProxyHelperProcess(t *testing.T) {
	if os.Getenv("PIWORK_TEST_PROXY_CHILD") != "1" {
		return
	}
	api, err := client.New(os.Getenv("PIWORK_TEST_PROXY_CORE"), "core-secret")
	if err != nil {
		os.Exit(91)
	}
	code := runUserProxy(api, []string{"--port", os.Getenv("PIWORK_TEST_PROXY_PORT")}, false, os.Stdout, os.Stderr)
	os.Exit(code)
}

func TestNativeProxyProcessLifecycleAndFixedPort(t *testing.T) {
	var workStops atomic.Int32
	core := nonLoopbackCore(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/stop") {
			workStops.Add(1)
		}
		switch r.URL.Path {
		case "/api/v1/service-access":
			_ = json.NewEncoder(w).Encode(map[string]any{"version": 1, "protocols": []string{"http", "sse", "websocket"}})
		case "/api/v1/file-access":
			w.WriteHeader(404)
			_, _ = io.WriteString(w, `{"code":"NOT_FOUND","message":"unsupported"}`)
		case "/api/v1/service-access/resolve":
			if r.Header.Get("X-Piwork-Gateway-Token") != "core-secret" {
				t.Error("missing Core token")
			}
			_, _ = io.WriteString(w, `{"hostname":"notes.w-a1b2c3d4.work","workId":"work-a1b2c3d4-5678","serviceId":"service-test","port":8099}`)
		case "/api/v1/service-gateway/" + testServiceDomain + "/80/hello":
			_, _ = io.WriteString(w, "service-ready")
		default:
			w.WriteHeader(404)
		}
	}))
	defer core.Close()
	occupied, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	busyPort := occupied.Addr().(*net.TCPAddr).Port
	command := nativeTestCommand(t, "-test.run=^TestNativeProxyHelperProcess$")
	command.Env = append(os.Environ(), "PIWORK_TEST_PROXY_CHILD=1", "PIWORK_TEST_PROXY_CORE="+core.URL, "PIWORK_TEST_PROXY_PORT="+strconv.Itoa(busyPort))
	output, err := command.CombinedOutput()
	if errorCode(err) != 6 || len(output) == 0 || strings.Contains(string(output), "WebDAV password:") {
		t.Fatal("occupied port was not rejected before password output", err, string(output))
	}
	_ = occupied.Close()
	free, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := free.Addr().(*net.TCPAddr).Port
	_ = free.Close()
	command = nativeTestCommand(t, "-test.run=^TestNativeProxyHelperProcess$")
	command.Env = append(os.Environ(), "PIWORK_TEST_PROXY_CHILD=1", "PIWORK_TEST_PROXY_CORE="+core.URL, "PIWORK_TEST_PROXY_PORT="+strconv.Itoa(port))
	stdout, err := command.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	stderr, err := command.StderrPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if command.Process != nil {
			_ = command.Process.Kill()
			_, _ = command.Process.Wait()
		}
	})
	ready := make(chan string, 1)
	go func() {
		reader := bufio.NewReader(stdout)
		var lines strings.Builder
		for {
			line, err := reader.ReadString('\n')
			if err != nil {
				ready <- lines.String()
				return
			}
			lines.WriteString(line)
			if strings.HasPrefix(line, "WebDAV status:") {
				ready <- lines.String()
				return
			}
		}
	}()
	initialPassword := ""
	select {
	case started := <-ready:
		if strings.Count(started, "WebDAV password:") != 1 || !strings.Contains(started, "WebDAV status: unsupported") || strings.Contains(started, "core-secret") {
			t.Fatal(started)
		}
		for _, line := range strings.Split(started, "\n") {
			if strings.HasPrefix(line, "WebDAV password: ") {
				initialPassword = strings.TrimPrefix(line, "WebDAV password: ")
			}
		}
	case <-time.After(5 * time.Second):
		t.Fatal("proxy child did not listen")
	}
	if initialPassword == "" {
		t.Fatal("proxy did not create a local WebDAV password")
	}
	proxyURL, _ := url.Parse("http://127.0.0.1:" + strconv.Itoa(port))
	httpClient := &http.Client{Transport: &http.Transport{Proxy: http.ProxyURL(proxyURL)}}
	response, err := httpClient.Get("http://" + testServiceDomain + "/hello")
	if err != nil {
		t.Fatal(err)
	}
	content, _ := io.ReadAll(response.Body)
	response.Body.Close()
	if response.StatusCode != 200 || string(content) != "service-ready" {
		t.Fatal(response.StatusCode, string(content))
	}
	oversized, err := http.NewRequest(http.MethodGet, proxyURL.String()+"/proxy.pac", nil)
	if err != nil {
		t.Fatal(err)
	}
	oversized.Header.Set("X-Oversized", strings.Repeat("x", 64<<10))
	response, err = (&http.Client{Timeout: 5 * time.Second}).Do(oversized)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusRequestHeaderFieldsTooLarge {
		t.Fatal("proxy accepted oversized headers", response.StatusCode)
	}
	if curlPath, err := exec.LookPath("curl"); err == nil {
		curl := exec.Command(curlPath, "--silent", "--show-error", "--fail", "--proxy", proxyURL.String(), "http://"+testServiceDomain+"/hello")
		curl.Env = append(os.Environ(), "NO_PROXY=", "no_proxy=")
		output, err := curl.CombinedOutput()
		if err != nil || string(output) != "service-ready" {
			t.Fatal("curl through Go CLI proxy failed", err, string(output))
		}
	}
	tailOutput := make(chan []byte, 1)
	tailDiagnostic := make(chan []byte, 1)
	go func() { raw, _ := io.ReadAll(stdout); tailOutput <- raw }()
	go func() { raw, _ := io.ReadAll(stderr); tailDiagnostic <- raw }()
	if err := interruptTestProcess(command); err != nil {
		t.Fatal(err)
	}
	finished := make(chan error, 1)
	go func() { finished <- command.Wait() }()
	select {
	case err := <-finished:
		if errorCode(err) != 130 {
			t.Fatal("unexpected proxy exit", err, string(<-tailDiagnostic))
		}
	case <-time.After(5 * time.Second):
		t.Fatal("proxy did not close on SIGINT")
	}
	remainingOutput, remainingDiagnostic := <-tailOutput, <-tailDiagnostic
	if strings.Contains(string(remainingOutput)+string(remainingDiagnostic), initialPassword) ||
		strings.Contains(string(remainingOutput)+string(remainingDiagnostic), "core-secret") {
		t.Fatal("proxy repeated local password or platform token after startup")
	}
	connection, err := net.DialTimeout("tcp", proxyURL.Host, 150*time.Millisecond)
	if err == nil {
		_ = connection.Close()
		t.Fatal("proxy listener retained after SIGINT")
	}
	second := nativeTestCommand(t, "-test.run=^TestNativeProxyHelperProcess$")
	second.Env = append(os.Environ(), "PIWORK_TEST_PROXY_CHILD=1", "PIWORK_TEST_PROXY_CORE="+core.URL, "PIWORK_TEST_PROXY_PORT="+strconv.Itoa(port))
	secondOut, err := second.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := second.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if second.ProcessState == nil {
			_ = second.Process.Kill()
			_, _ = second.Process.Wait()
		}
	})
	secondReady := make(chan string, 1)
	go func() {
		reader := bufio.NewReader(secondOut)
		var lines strings.Builder
		for {
			line, err := reader.ReadString('\n')
			if err != nil {
				secondReady <- lines.String()
				return
			}
			lines.WriteString(line)
			if strings.HasPrefix(line, "WebDAV status:") {
				secondReady <- lines.String()
				return
			}
		}
	}()
	var restarted string
	select {
	case restarted = <-secondReady:
	case <-time.After(5 * time.Second):
		t.Fatal("restarted proxy did not listen")
	}
	if strings.Contains(restarted, "WebDAV password: "+initialPassword+"\n") {
		t.Fatal("proxy reused an old local password")
	}
	request, err := http.NewRequest(http.MethodGet, proxyURL.String()+"/works/"+testProxyWorkID+"/files/", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte("piwork:"+initialPassword)))
	response, err = (&http.Client{Timeout: 5 * time.Second}).Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 401 {
		t.Fatal("restarted proxy accepted the old local password", response.StatusCode)
	}
	if err := interruptTestProcess(second); err != nil {
		t.Fatal(err)
	}
	if err := second.Wait(); errorCode(err) != 130 {
		t.Fatal("restarted proxy did not stop", err)
	}
	if workStops.Load() != 0 {
		t.Fatal("stopping local proxy also stopped a Work", workStops.Load())
	}
}

func errorCode(err error) int {
	if err == nil {
		return 0
	}
	if failure, ok := err.(*exec.ExitError); ok {
		return failure.ExitCode()
	}
	return -1
}
