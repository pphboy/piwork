// Package clinative exercises a candidate client as a separate native process.
package clinative

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"piwork/scripts/clirelease"
)

type Result struct {
	Scenarios []clirelease.Scenario `json:"scenarios"`
}

func Smoke(ctx context.Context, buildDirectory, root string) (Result, error) {
	var result Result
	metadata, binary, err := clirelease.ValidateBuild(buildDirectory)
	if err != nil {
		return result, err
	}
	binary, err = filepath.Abs(binary)
	if err != nil {
		return result, err
	}
	if metadata.Target != runtime.GOOS+"/"+runtime.GOARCH {
		return result, errors.New("acceptance must execute on the candidate native target")
	}
	directory, err := os.MkdirTemp("", "piwork-cli-native-")
	if err != nil {
		return result, err
	}
	defer os.RemoveAll(directory)
	config := filepath.Join(directory, "state", "client.json")
	environment := append(os.Environ(), "PIWORK_CONFIG_PATH="+config, "PIWORK_CORE_URL=", "XDG_CONFIG_HOME=", "PATH="+filepath.Join(directory, "no-development-tools"))
	command := func(args ...string) *exec.Cmd {
		c := exec.CommandContext(ctx, binary, args...)
		c.Dir = directory
		c.Env = environment
		return c
	}
	versionOutput, err := command("--json", "--version").Output()
	if err != nil {
		return result, errors.New("candidate version failed")
	}
	var version struct {
		Program, Version, Commit, GoVersion, OS, Architecture, DesktopUIHash string
		Modified                                                             bool
	}
	if json.Unmarshal(versionOutput, &version) != nil || version.Program != "piwork-cli" || version.Version != metadata.ReleaseVersion || version.Commit != metadata.Commit || version.Modified != metadata.Modified || version.GoVersion != metadata.GoVersion || version.OS+"/"+version.Architecture != metadata.Target || version.DesktopUIHash != metadata.DesktopUIHash {
		return result, errors.New("candidate runtime identity differs from build metadata")
	}
	for _, args := range [][]string{{"--help"}, {"help"}, {"--json"}} {
		if _, err := command(args...).Output(); err != nil {
			return result, errors.New("candidate help failed")
		}
	}
	if _, err := os.Stat(filepath.Dir(config)); !os.IsNotExist(err) {
		return result, errors.New("early command created persistent state")
	}
	free, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return result, err
	}
	port := free.Addr().(*net.TCPAddr).Port
	free.Close()
	desktop := command("--core", "http://127.0.0.1:1", "desktop", "--port", strconv.Itoa(port), "--no-open")
	if err := prepareConsole(desktop); err != nil {
		return result, err
	}
	stdout, err := desktop.StdoutPipe()
	if err != nil {
		return result, err
	}
	desktop.Stderr = io.Discard
	if err := desktop.Start(); err != nil {
		return result, errors.New("candidate Desktop failed to start")
	}
	defer func() { desktop.Process.Kill(); desktop.Wait() }()
	line := make(chan string, 1)
	go func() { value, _ := bufio.NewReader(stdout).ReadString('\n'); line <- value }()
	var launch string
	select {
	case launch = <-line:
	case <-ctx.Done():
		return result, ctx.Err()
	case <-time.After(10 * time.Second):
		return result, errors.New("candidate Desktop launch timed out")
	}
	prefix := "Piwork Desktop: http://desktop.localhost:" + strconv.Itoa(port) + "/#ticket="
	if !strings.HasPrefix(launch, prefix) {
		return result, errors.New("candidate Desktop launch address invalid")
	}
	ticket := strings.TrimSpace(strings.TrimPrefix(launch, prefix))
	base := "http://127.0.0.1:" + strconv.Itoa(port)
	origin := "http://desktop.localhost:" + strconv.Itoa(port)
	httpClient := &http.Client{Timeout: 10 * time.Second, Transport: &http.Transport{Proxy: nil}}
	defer httpClient.CloseIdleConnections()
	cookie, csrf := "", ""
	request := func(method, path string, raw []byte, host string) (int, []byte, http.Header, error) {
		r, err := http.NewRequestWithContext(ctx, method, base+path, bytes.NewReader(raw))
		if err != nil {
			return 0, nil, nil, err
		}
		r.Host = host
		r.Header.Set("Origin", origin)
		if len(raw) > 0 {
			r.Header.Set("Content-Type", "application/json")
		}
		if cookie != "" {
			r.Header.Set("Cookie", cookie)
		}
		if csrf != "" {
			r.Header.Set("X-Piwork-Csrf", csrf)
		}
		response, err := httpClient.Do(r)
		if err != nil {
			return 0, nil, nil, err
		}
		defer response.Body.Close()
		body, err := io.ReadAll(io.LimitReader(response.Body, 4<<20))
		return response.StatusCode, body, response.Header, err
	}
	status, script, _, err := request("GET", "/desktop/browser/app.js", nil, strings.TrimPrefix(origin, "http://"))
	if err != nil || status != 200 {
		return result, errors.New("candidate embedded UI unavailable")
	}
	expected, err := os.ReadFile(filepath.Join(root, "internal/desktopassets/static/browser/app.js"))
	if err != nil || !bytes.Equal(script, expected) {
		return result, errors.New("candidate embedded UI differs from synchronized Desktop")
	}
	status, adapter, _, err := request("GET", "/desktop/browser/adapter.js", nil, strings.TrimPrefix(origin, "http://"))
	if err != nil || status != 200 {
		return result, errors.New("candidate embedded adapter unavailable")
	}
	expectedAdapter, err := os.ReadFile(filepath.Join(root, "internal/desktopassets/static/browser/adapter.js"))
	if err != nil || !bytes.Equal(adapter, expectedAdapter) {
		return result, errors.New("candidate embedded adapter differs from synchronized Desktop")
	}
	status, logo, logoHeaders, err := request("GET", "/desktop/piwork-logo.png", nil, strings.TrimPrefix(origin, "http://"))
	if err != nil || status != 200 || logoHeaders.Get("Content-Type") != "image/png" {
		return result, errors.New("candidate embedded Logo unavailable")
	}
	expectedLogo, err := os.ReadFile(filepath.Join(root, "docs/images/piwork-logo.png"))
	if err != nil || !bytes.Equal(logo, expectedLogo) {
		return result, errors.New("candidate embedded Logo differs from project PNG")
	}
	status, _, _, err = request("GET", "/_desktop/api/preferences", nil, strings.TrimPrefix(origin, "http://"))
	if err != nil || status != 401 {
		return result, errors.New("candidate preferences lack local authorization")
	}
	bootstrap, _ := json.Marshal(map[string]string{"ticket": ticket})
	status, body, headers, err := request("POST", "/_desktop/api/bootstrap", bootstrap, strings.TrimPrefix(origin, "http://"))
	if err != nil || status != 200 {
		return result, errors.New("candidate local bootstrap failed")
	}
	var session struct {
		CSRF string `json:"csrf"`
	}
	if json.Unmarshal(body, &session) != nil || session.CSRF == "" {
		return result, errors.New("candidate local CSRF absent")
	}
	csrf = session.CSRF
	cookie = strings.SplitN(headers.Get("Set-Cookie"), ";", 2)[0]
	status, body, _, err = request("PUT", "/_desktop/api/preferences", []byte(`{"coreUrl":"http://native-default.example"}`), strings.TrimPrefix(origin, "http://"))
	if err != nil || status != 200 || !bytes.Contains(body, []byte("http://native-default.example")) {
		return result, errors.New("candidate offline default save failed")
	}
	status, body, _, err = request("GET", "/_desktop/api/session", nil, strings.TrimPrefix(origin, "http://"))
	if err != nil || status != 200 || !bytes.Contains(body, []byte("http://127.0.0.1:1")) {
		return result, errors.New("saving default switched current Core")
	}
	status, _, _, err = request("PUT", "/_desktop/api/preferences", []byte(`{"coreUrl":"https://wrong-host.example"}`), "service.desktop.localhost:"+strconv.Itoa(port))
	if err != nil || status != 403 {
		return result, errors.New("candidate preferences accepted foreign Host")
	}
	status, _, _, err = request("DELETE", "/_desktop/api/preferences", nil, strings.TrimPrefix(origin, "http://"))
	if err != nil || status != 200 {
		return result, errors.New("candidate default clear failed")
	}
	if _, err := os.Stat(config); !os.IsNotExist(err) {
		return result, errors.New("preferences changed candidate credentials")
	}
	opened, err := command("desktop", "open", "--port", strconv.Itoa(port), "--no-open").Output()
	if err != nil || !strings.HasPrefix(string(opened), "Piwork Desktop: ") {
		return result, errors.New("candidate same-user recovery failed")
	}
	if err := interrupt(desktop); err != nil {
		return result, err
	}
	done := make(chan error, 1)
	go func() { done <- desktop.Wait() }()
	select {
	case err := <-done:
		var exit *exec.ExitError
		if !errors.As(err, &exit) || exit.ExitCode() != 130 {
			return result, errors.New("candidate interrupt exit differs")
		}
	case <-time.After(10 * time.Second):
		return result, errors.New("candidate retained Desktop after interrupt")
	}
	hash := sha256.Sum256(script)
	adapterHash := sha256.Sum256(adapter)
	logoHash := sha256.Sum256(logo)
	result.Scenarios = append(result.Scenarios, clirelease.Scenario{ID: "standalone-runtime", Status: "pass", Commands: []string{"candidate --json --version; candidate --help; candidate --json; candidate desktop --no-open; candidate desktop open; native console interrupt"}, Diagnostic: fmt.Sprintf("native %s/%s, non-source cwd, PATH excludes development tools; embedded app.js sha256=%s; adapter.js sha256=%s; Logo PNG sha256=%s", runtime.GOOS, runtime.GOARCH, hex.EncodeToString(hash[:]), hex.EncodeToString(adapterHash[:]), hex.EncodeToString(logoHash[:]))})
	return result, nil
}
