//go:build integration

package coreapp

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	usercli "piwork/internal/cli"
	userclient "piwork/internal/client"
)

func TestNativeCLIProxyServiceAndWebDAVShareRealWorkspace(t *testing.T) {
	a, base, authorization, workID, ctx := nativeApplyFixture(t)
	script := `const fs=require('node:fs'),http=require('node:http');const root='/var/data/workspace';http.createServer((req,res)=>{if(req.url==='/health'){res.end('ok');return;}if(req.url==='/file'){res.end(fs.readFileSync(root+'/cli-file.txt'));return;}res.end('service-ready');}).listen(8099,'0.0.0.0')`
	definition := map[string]any{"name": "cli-proxy", "image": map[string]string{"reference": a.options.Initialization.Runtime.AgentImage},
		"command": "node", "args": []string{"-e", script}, "workingDirectory": "/var/data/workspace",
		"mounts":    []any{map[string]any{"source": "workspace", "target": "/var/data/workspace", "readOnly": false}},
		"ports":     []any{map[string]any{"name": "web", "protocol": "tcp", "containerPort": 8099}},
		"readiness": map[string]any{"kind": "http", "portName": "web", "path": "/health", "deadlineMs": 10000}}
	path := "/api/v1/works/" + workID
	status, accepted := packageHTTPCall(t, base, path+"/services", "POST", authorization, map[string]any{"definition": definition, "idempotencyKey": "cli-proxy-service"})
	if status != 202 {
		t.Fatal("service acceptance", status, accepted)
	}
	waitWorkOperation(t, ctx, a, accepted["operationId"].(string))
	status, service := packageHTTPCall(t, base, path+"/services/"+accepted["serviceId"].(string), "GET", authorization, nil)
	if status != 200 {
		t.Fatal("service detail", status, service)
	}
	hostname := service["access"].(map[string]any)["hostname"].(string)
	credentialPath := filepath.Join(t.TempDir(), "credentials", "client.json")
	if err := (userclient.CredentialStore{Path: credentialPath}).Save(userclient.Credential{Version: 1, CoreURL: base,
		Token: strings.TrimPrefix(authorization, "Bearer "), ExpiresAt: "2099-01-01T00:00:00Z",
		User: userclient.Identity{ID: "cli-test-user", Account: "admin", Role: "admin"}}); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PIWORK_CONFIG_PATH", credentialPath)
	_, source, _, _ := runtime.Caller(0)
	binary := filepath.Join(filepath.Dir(source), "..", "..", "dist", "go", "piwork-cli")
	if _, err := os.Stat(binary); err != nil {
		t.Fatal("make build-go is required", err)
	}
	free, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := free.Addr().(*net.TCPAddr).Port
	_ = free.Close()
	process := exec.Command(binary, "--core", base, "proxy", "--port", strconv.Itoa(port))
	process.Env = append(os.Environ(), "PIWORK_CONFIG_PATH="+credentialPath, "PATH=/nonexistent")
	stdout, err := process.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	var stderr bytes.Buffer
	process.Stderr = &stderr
	if err := process.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if process.ProcessState == nil {
			_ = process.Process.Kill()
			_, _ = process.Process.Wait()
		}
	})
	ready := make(chan string, 1)
	go func() {
		scanner := bufio.NewScanner(stdout)
		var lines strings.Builder
		for scanner.Scan() {
			lines.WriteString(scanner.Text())
			lines.WriteByte('\n')
			if strings.HasPrefix(scanner.Text(), "WebDAV status:") {
				break
			}
		}
		ready <- lines.String()
	}()
	var introduction string
	select {
	case introduction = <-ready:
	case <-time.After(10 * time.Second):
		t.Fatal("Go CLI proxy did not listen", stderr.String())
	}
	if !strings.Contains(introduction, "WebDAV status: available") {
		t.Fatal("real Core file capability unavailable", introduction, stderr.String())
	}
	password := ""
	for _, line := range strings.Split(introduction, "\n") {
		if strings.HasPrefix(line, "WebDAV password: ") {
			password = strings.TrimPrefix(line, "WebDAV password: ")
		}
	}
	if password == "" {
		t.Fatal("proxy did not print local credential", introduction)
	}
	invokeService := func(action string, wait bool) string {
		t.Helper()
		args := []string{"--core", base, "--json", "work", "service", action, workID}
		if action != "list" {
			args = append(args, accepted["serviceId"].(string))
		}
		if wait {
			args = append(args, "--wait")
		}
		var output, diagnostic bytes.Buffer
		if code := usercli.Entry("piwork-cli", args, &output, &diagnostic); code != 0 {
			t.Fatalf("Go CLI service %s failed (%d): %s %s", action, code, output.String(), diagnostic.String())
		}
		return output.String()
	}
	if !strings.Contains(invokeService("list", false), accepted["serviceId"].(string)) ||
		!strings.Contains(invokeService("show", false), hostname) ||
		!strings.Contains(invokeService("logs", false), accepted["serviceId"].(string)) {
		t.Fatal("Go CLI Service discovery or logs failed")
	}
	proxyURL, _ := url.Parse("http://127.0.0.1:" + strconv.Itoa(port))
	client := &http.Client{Timeout: 20 * time.Second, Transport: &http.Transport{Proxy: http.ProxyURL(proxyURL)}}
	localClient := &http.Client{Timeout: 20 * time.Second, Transport: &http.Transport{Proxy: nil}}
	response, err := client.Get("http://" + hostname + "/")
	if err != nil {
		t.Fatal("Service through Go CLI proxy", err)
	}
	content, _ := io.ReadAll(response.Body)
	response.Body.Close()
	if response.StatusCode != 200 || string(content) != "service-ready" {
		t.Fatal("Service response", response.StatusCode, string(content))
	}
	fileURL := proxyURL.String() + "/works/" + workID + "/files/cli-file.txt"
	fileRequestAt := func(method, target string, body io.Reader) *http.Response {
		t.Helper()
		request, err := http.NewRequestWithContext(ctx, method, target, body)
		if err != nil {
			t.Fatal(err)
		}
		request.Header.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte("piwork:"+password)))
		response, err := localClient.Do(request)
		if err != nil {
			t.Fatal("WebDAV through Go CLI proxy", err)
		}
		return response
	}
	fileRequest := func(method string, body io.Reader) *http.Response {
		return fileRequestAt(method, fileURL, body)
	}
	response = fileRequest(http.MethodPut, strings.NewReader("shared-from-cli"))
	response.Body.Close()
	if response.StatusCode != 201 && response.StatusCode != 204 {
		t.Fatal("WebDAV PUT", response.StatusCode)
	}
	response = fileRequest(http.MethodGet, nil)
	content, _ = io.ReadAll(response.Body)
	response.Body.Close()
	if response.StatusCode != 200 || string(content) != "shared-from-cli" {
		t.Fatal("WebDAV GET", response.StatusCode, string(content))
	}
	status, second := packageHTTPCall(t, base, "/api/v1/works", "POST", authorization,
		map[string]string{"name": "Second CLI proxy Work", "idempotencyKey": "cli-proxy-second-work"})
	if status != 202 {
		t.Fatal("second Work acceptance", status, second)
	}
	secondWorkID := second["workId"].(string)
	waitWorkOperation(t, ctx, a, second["operationId"].(string))
	secondURL := proxyURL.String() + "/works/" + secondWorkID + "/files/cli-file.txt"
	response = fileRequestAt(http.MethodPut, secondURL, strings.NewReader("other-work"))
	response.Body.Close()
	if response.StatusCode != 201 && response.StatusCode != 204 {
		t.Fatal("second Work WebDAV PUT", response.StatusCode)
	}
	response = fileRequestAt(http.MethodGet, secondURL, nil)
	secondContent, _ := io.ReadAll(response.Body)
	response.Body.Close()
	if response.StatusCode != 200 || string(secondContent) != "other-work" {
		t.Fatal("second Work WebDAV GET", response.StatusCode, string(secondContent))
	}
	response = fileRequest(http.MethodGet, nil)
	content, _ = io.ReadAll(response.Body)
	response.Body.Close()
	if response.StatusCode != 200 || string(content) != "shared-from-cli" {
		t.Fatal("WebDAV Work isolation failed", response.StatusCode, string(content))
	}
	response, err = client.Get("http://" + hostname + "/file")
	if err != nil {
		t.Fatal(err)
	}
	content, _ = io.ReadAll(response.Body)
	response.Body.Close()
	if response.StatusCode != 200 || string(content) != "shared-from-cli" {
		t.Fatal("Service did not see WebDAV write", response.StatusCode, string(content))
	}
	if rclone := os.Getenv("PIWORK_TEST_RCLONE_BIN"); rclone != "" {
		t.Run("rclone", func(t *testing.T) {
			obscure := exec.Command(rclone, "obscure", password)
			secret, err := obscure.Output()
			if err != nil {
				t.Fatal("rclone credential preparation", err)
			}
			config := filepath.Join(t.TempDir(), "rclone.conf")
			configuration := "[work]\ntype = webdav\nurl = " + proxyURL.String() + "/works/" + workID + "/files/\nvendor = other\nuser = piwork\npass = " + strings.TrimSpace(string(secret)) + "\n"
			if err := os.WriteFile(config, []byte(configuration), 0o600); err != nil {
				t.Fatal(err)
			}
			invoke := func(args ...string) string {
				t.Helper()
				command := exec.CommandContext(ctx, rclone, append([]string{"--config", config}, args...)...)
				output, err := command.CombinedOutput()
				if err != nil {
					t.Fatalf("rclone %v: %v: %s", args, err, output)
				}
				return string(output)
			}
			local := filepath.Join(t.TempDir(), "rclone.txt")
			if err := os.WriteFile(local, []byte("rclone-workspace-data"), 0o600); err != nil {
				t.Fatal(err)
			}
			invoke("copyto", local, "work:rclone.txt")
			if listing := invoke("lsf", "work:"); !strings.Contains(listing, "rclone.txt") {
				t.Fatal("rclone list omitted upload", listing)
			}
			if downloaded := invoke("cat", "work:rclone.txt"); downloaded != "rclone-workspace-data" {
				t.Fatal("rclone download changed bytes", downloaded)
			}
			invoke("moveto", "work:rclone.txt", "work:rclone-moved.txt")
			if moved := invoke("cat", "work:rclone-moved.txt"); moved != "rclone-workspace-data" {
				t.Fatal("rclone move changed bytes", moved)
			}
			invoke("deletefile", "work:rclone-moved.txt")
			if listing := invoke("lsf", "work:"); strings.Contains(listing, "rclone-moved.txt") {
				t.Fatal("rclone delete left file", listing)
			}
		})
	}
	if err := process.Process.Signal(syscall.SIGINT); err != nil {
		t.Fatal(err)
	}
	completed := make(chan error, 1)
	go func() { completed <- process.Wait() }()
	select {
	case err := <-completed:
		if exit, ok := err.(*exec.ExitError); !ok || exit.ExitCode() != 130 {
			t.Fatal("proxy did not exit on SIGINT", err, stderr.String())
		}
	case <-time.After(5 * time.Second):
		t.Fatal("proxy retained connections after SIGINT")
	}
	if _, err := a.Store.Work(context.Background(), workID, false); err != nil {
		t.Fatal("closing CLI proxy changed Work lifecycle", err)
	}
	for _, action := range []string{"stop", "start", "restart", "retry", "remove"} {
		if output := invokeService(action, true); !strings.Contains(output, `"state":"succeeded"`) {
			t.Fatal("Go CLI Service action did not complete", action, output)
		}
	}
}
