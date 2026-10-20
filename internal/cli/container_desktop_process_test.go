package cli

import (
	"bufio"
	"bytes"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestContainerDesktopOrdinaryAddressAndOptionalOpenUseThisInstance(t *testing.T) {
	t.Setenv("PIWORK_CLI_CONTAINER_MODE", "1")
	t.Setenv("PATH", filepath.Join(t.TempDir(), "no-browser-opener"))
	free, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := free.Addr().(*net.TCPAddr).Port
	free.Close()
	command := nativeTestCommand(t, "-test.run=^TestNativeDesktopHelperProcess$")
	command.Env = []string{"PIWORK_TEST_DESKTOP_CHILD=1", "PIWORK_TEST_DESKTOP_OPEN=1", "PIWORK_TEST_DESKTOP_PORT=" + strconv.Itoa(port), "PIWORK_CLI_CONTAINER_MODE=1", "PATH=" + os.Getenv("PATH")}
	stdout, err := command.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	var stderr bytes.Buffer
	command.Stderr = &stderr
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if command.ProcessState == nil {
			command.Process.Kill()
			command.Wait()
		}
	})
	reader := bufio.NewReader(stdout)
	lines := make(chan string, 1)
	go func() {
		first, _ := reader.ReadString('\n')
		second, _ := reader.ReadString('\n')
		lines <- first + second
	}()
	var mainLog string
	select {
	case mainLog = <-lines:
	case <-time.After(5 * time.Second):
		t.Fatal("container Desktop did not start")
	}
	origin := "http://desktop.localhost:" + strconv.Itoa(port)
	if strings.Contains(mainLog, "#ticket=") || !strings.Contains(mainLog, origin+"/") || strings.Contains(mainLog, "desktop open --no-open") {
		t.Fatal("unsafe or incomplete container startup output", mainLog)
	}
	request := func(method, path, body, host string) int {
		t.Helper()
		r, err := http.NewRequest(method, "http://127.0.0.1:"+strconv.Itoa(port)+path, strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		r.Host = host
		if body != "" {
			r.Header.Set("Content-Type", "application/json")
			r.Header.Set("Origin", origin)
		}
		response, err := (&http.Client{Timeout: time.Second, Transport: &http.Transport{Proxy: nil}}).Do(r)
		if err != nil {
			t.Fatal(err)
		}
		io.Copy(io.Discard, response.Body)
		response.Body.Close()
		return response.StatusCode
	}
	if code := request("GET", "/", "", strings.TrimPrefix(origin, "http://")); code != 200 {
		t.Fatal("static health unavailable", code)
	}
	if code := request("GET", "/", "", "attacker.invalid"); code != 403 {
		t.Fatal("container relaxed Host enforcement", code)
	}
	if code := request("GET", "/_desktop/api/session", "", strings.TrimPrefix(origin, "http://")); code != 200 {
		t.Fatal("ordinary browser could not establish a session", code)
	}
	open := func() string {
		t.Helper()
		var result, diagnostic bytes.Buffer
		if code := runDesktopControl([]string{"open", "--port", strconv.Itoa(port)}, &result, &diagnostic); code != 0 || diagnostic.Len() != 0 {
			t.Fatal("control open launched a container browser or failed", code, diagnostic.String())
		}
		address := strings.TrimSpace(strings.TrimPrefix(result.String(), "Piwork Desktop: "))
		if !validDesktopLaunchURL(address, port) {
			t.Fatal("control returned invalid ordinary URL", address)
		}
		return address
	}
	previous, fresh := open(), open()
	if previous != fresh || fresh != origin+"/" {
		t.Fatal("open changed the ordinary URL")
	}
	if code := request("POST", "/_desktop/api/bootstrap", `{}`, strings.TrimPrefix(origin, "http://")); code != 404 {
		t.Fatal("removed bootstrap route still active", code)
	}

	if err := interruptTestProcess(command); err != nil {
		t.Fatal(err)
	}
	if err := command.Wait(); errorCode(err) != 130 {
		t.Fatal("container Desktop failed to stop", err)
	}
	rest, _ := io.ReadAll(reader)
	mainLog += string(rest)
	if strings.Contains(mainLog, "#ticket=") || stderr.Len() != 0 {
		t.Fatal("container process logged browser secrets or tried to open a browser", mainLog, stderr.String())
	}
}
