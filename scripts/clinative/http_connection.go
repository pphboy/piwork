package clinative

import (
	"bufio"
	"bytes"
	"context"
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

	"piwork/internal/client"
	"piwork/scripts/clirelease"
)

// HTTPConnection exercises a deployed Core through the exact native candidate.
// It creates only its own configuration and processes, leaving user instances alone.
func HTTPConnection(ctx context.Context, buildDirectory, coreURL string) (Result, error) {
	var result Result
	metadata, binary, err := clirelease.ValidateBuild(buildDirectory)
	if err != nil {
		return result, err
	}
	if metadata.Target != runtime.GOOS+"/"+runtime.GOARCH {
		return result, errors.New("HTTP acceptance requires the native candidate target")
	}
	coreURL, err = client.DesktopCoreURL(coreURL)
	if err != nil || !strings.HasPrefix(coreURL, "http://") {
		return result, errors.New("--http-core requires a valid deployed HTTP Core origin")
	}
	binary, err = filepath.Abs(binary)
	if err != nil {
		return result, err
	}
	directory, err := os.MkdirTemp("", "piwork-http-core-")
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
	statusOutput, err := command("--core", coreURL, "--json", "status").Output()
	if err != nil {
		return result, errors.New("native candidate HTTP Core status failed")
	}
	var status struct {
		CoreURL string `json:"coreUrl"`
		Health  struct {
			Status string `json:"status"`
		} `json:"health"`
		Readiness struct {
			Ready bool `json:"ready"`
		} `json:"readiness"`
	}
	if json.Unmarshal(statusOutput, &status) != nil || status.CoreURL != coreURL || status.Health.Status != "healthy" || !status.Readiness.Ready {
		return result, errors.New("native HTTP Core was not healthy and ready")
	}

	// Exercise the empty root command when its fixed default port is available.
	listener, err := net.Listen("tcp", "127.0.0.1:17891")
	rootAvailable := err == nil
	rootFailure := err
	if !rootAvailable {
		listener, err = net.Listen("tcp", "127.0.0.1:0")
	}
	if err != nil {
		return result, err
	}
	port := listener.Addr().(*net.TCPAddr).Port
	listener.Close()
	base := "http://127.0.0.1:" + strconv.Itoa(port)
	origin := "http://desktop.localhost:" + strconv.Itoa(port)
	httpClient := &http.Client{Timeout: 10 * time.Second, Transport: &http.Transport{Proxy: nil}}
	defer httpClient.CloseIdleConnections()
	for launchIndex := 0; launchIndex < 2; launchIndex++ {
		args := []string{"desktop", "--port", strconv.Itoa(port), "--no-open"}
		if rootAvailable {
			args = nil
		}
		if launchIndex == 0 {
			args = append([]string{"--core", coreURL}, args...)
		}
		desktop := command(args...)
		if err := prepareConsole(desktop); err != nil {
			return result, err
		}
		stdout, err := desktop.StdoutPipe()
		if err != nil {
			return result, err
		}
		desktop.Stderr = io.Discard
		if err := desktop.Start(); err != nil {
			return result, err
		}
		defer func() {
			if desktop.ProcessState == nil {
				desktop.Process.Kill()
				desktop.Wait()
			}
		}()
		line := make(chan string, 1)
		go func() {
			value, _ := bufio.NewReader(stdout).ReadString('\n')
			line <- value
			io.Copy(io.Discard, stdout)
		}()
		var launch string
		select {
		case launch = <-line:
		case <-ctx.Done():
			return result, ctx.Err()
		case <-time.After(10 * time.Second):
			return result, errors.New("HTTP Desktop launch timed out")
		}
		prefix := "Piwork Desktop: " + origin + "/#ticket="
		if !strings.HasPrefix(launch, prefix) {
			return result, errors.New("HTTP Desktop failed to launch")
		}
		ticket := strings.TrimSpace(strings.TrimPrefix(launch, prefix))
		cookie, csrf := "", ""
		request := func(method, path string, value any) (int, []byte, http.Header, error) {
			var raw []byte
			if value != nil {
				raw, _ = json.Marshal(value)
			}
			r, err := http.NewRequestWithContext(ctx, method, base+path, bytes.NewReader(raw))
			if err != nil {
				return 0, nil, nil, err
			}
			r.Host = strings.TrimPrefix(origin, "http://")
			r.Header.Set("Origin", origin)
			if value != nil {
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
			body, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
			return response.StatusCode, body, response.Header, err
		}
		code, _, _, err := request("GET", "/_desktop/api/session", nil)
		if err != nil || code != 401 {
			return result, errors.New("HTTP Desktop bypassed local authorization")
		}
		code, body, headers, err := request("POST", "/_desktop/api/bootstrap", map[string]string{"ticket": ticket})
		if err != nil || code != 200 {
			return result, errors.New("HTTP Desktop bootstrap failed")
		}
		var local struct {
			CSRF string `json:"csrf"`
		}
		if json.Unmarshal(body, &local) != nil || local.CSRF == "" {
			return result, errors.New("HTTP Desktop has no CSRF")
		}
		csrf = local.CSRF
		cookie = strings.SplitN(headers.Get("Set-Cookie"), ";", 2)[0]
		code, before, _, err := request("GET", "/_desktop/api/session", nil)
		if err != nil || code != 200 || !bytes.Contains(before, []byte(coreURL)) || !bytes.Contains(before, []byte(`"state":"signed-out"`)) {
			return result, errors.New("HTTP default/explicit origin was not selected")
		}
		code, body, _, err = request("GET", "/_desktop/api/status", nil)
		var availability struct {
			Health struct {
				Available bool `json:"available"`
			} `json:"health"`
			Readiness struct {
				Available bool `json:"available"`
			} `json:"readiness"`
		}
		if err != nil || code != 200 || json.Unmarshal(body, &availability) != nil || !availability.Health.Available || !availability.Readiness.Available {
			return result, errors.New("authorized anonymous HTTP Core status failed")
		}
		code, body, _, err = request("PUT", "/_desktop/api/preferences", map[string]string{"coreUrl": coreURL + "/"})
		if err != nil || code != 200 || !bytes.Contains(body, []byte(coreURL)) {
			return result, errors.New("native HTTP preference save failed")
		}
		code, body, _, err = request("GET", "/_desktop/api/session", nil)
		if err != nil || code != 200 || !bytes.Equal(before, body) {
			return result, errors.New("preference save changed current identity")
		}
		code, body, _, err = request("GET", "/_desktop/api/preferences", nil)
		if err != nil || code != 200 || !bytes.Contains(body, []byte(coreURL)) {
			return result, errors.New("native HTTP preference read failed")
		}
		if _, err := os.Stat(config); !os.IsNotExist(err) {
			return result, errors.New("HTTP preferences wrote credentials")
		}
		opened, err := command("desktop", "open", "--port", strconv.Itoa(port), "--no-open").Output()
		if err != nil || !strings.HasPrefix(string(opened), "Piwork Desktop: "+origin) {
			return result, errors.New("HTTP Desktop open recovery failed")
		}
		if launchIndex == 1 {
			code, _, _, err = request("DELETE", "/_desktop/api/preferences", nil)
			if err != nil || code != 200 {
				return result, errors.New("native HTTP preference clear failed")
			}
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
				return result, errors.New("HTTP Desktop interrupt exit differed")
			}
		case <-time.After(10 * time.Second):
			return result, errors.New("HTTP Desktop failed to exit")
		}
	}
	result.Scenarios = append(result.Scenarios, clirelease.Scenario{ID: "http-core-connection", Status: "pass", Commands: []string{"candidate --core <HTTP origin> --json status", "candidate [--core <HTTP origin>] desktop --port <independent port> --no-open; authorize; status; preferences save/read; desktop open; interrupt; restart without --core; clear"}, Diagnostic: fmt.Sprintf("native %s; sha256=%s; deployed Core=%s; fresh private configuration, non-source cwd, no developer-tool PATH; healthy/ready, anonymous status, origin and identity, persisted HTTP default, recovery and exit 130", metadata.Target, metadata.SHA256, coreURL)})
	rootStatus, diagnostic := "pass", "empty root command exercised before and after restart"
	if !rootAvailable {
		rootStatus = "unverified"
		diagnostic = fmt.Sprintf("default port 17891 unavailable: %v; preserved existing resources, tested the same default Core resolver through desktop on an independent port", rootFailure)
	}
	result.Scenarios = append(result.Scenarios, clirelease.Scenario{ID: "http-default-root", Status: rootStatus, Commands: []string{"candidate --core <HTTP origin>; candidate"}, Diagnostic: diagnostic})
	return result, nil
}
