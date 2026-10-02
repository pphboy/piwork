// Package packagehelper owns the image-only Pi package preparation program.
// Its static capture/init/measure paths never launch a child process.
package packagehelper

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"os/exec"
	"piwork/internal/pipackage"
	"strings"
	"sync"
	"syscall"
	"time"
)

var ErrFetch = &pipackage.InputError{Code: "PI_PACKAGE_SOURCE_FETCH_FAILED"}
var ErrInstall = &pipackage.InputError{Code: "PI_PACKAGE_DEPENDENCY_INSTALL_FAILED"}
var npmFetchOptions = []string{"--fetch-retries=8", "--fetch-retry-mintimeout=1000", "--fetch-retry-maxtimeout=30000", "--fetch-timeout=600000"}

type commandOutput struct {
	mu       sync.Mutex
	data     bytes.Buffer
	overflow bool
	cancel   context.CancelFunc
}

func (w *commandOutput) Write(data []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if len(data) > 4096-w.data.Len() {
		w.overflow = true
		w.cancel()
		return 0, errors.New("command output exceeded limit")
	}
	return w.data.Write(data)
}

// argv and a small environment whitelist are intentional: source specs never
// reach a shell, and Core credentials never reach npm/Git/install scripts.
func runCommand(ctx context.Context, executable string, args []string, cwd string, failure error, output bool, timeout time.Duration) (string, error) {
	if executable != "npm" && executable != "git" {
		return "", failure
	}
	if timeout <= 0 || timeout > 30*time.Minute {
		timeout = 30 * time.Minute
	}
	commandCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	environment := []string{"PATH=" + envOr("PATH", "/usr/local/bin:/usr/bin:/bin"), "HOME=" + envOr("HOME", "/package/work/home"), "NPM_CONFIG_CACHE=" + envOr("NPM_CONFIG_CACHE", "/package/work/npm-cache"), "npm_config_userconfig=/dev/null", "GIT_TERMINAL_PROMPT=0", "GIT_CONFIG_NOSYSTEM=1", "CI=true"}
	for _, key := range []string{"NPM_CONFIG_REGISTRY", "GIT_CONFIG_GLOBAL"} {
		if value := os.Getenv(key); value != "" {
			environment = append(environment, key+"="+value)
		}
	}
	command := exec.CommandContext(commandCtx, executable, args...)
	command.Dir, command.Env = cwd, environment
	command.Stdin = nil
	command.Stdout, command.Stderr = io.Discard, io.Discard
	result := &commandOutput{cancel: cancel}
	if output {
		command.Stdout = result
	}
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	command.Cancel = func() error {
		if command.Process == nil {
			return os.ErrProcessDone
		}
		err := syscall.Kill(-command.Process.Pid, syscall.SIGKILL)
		if err == syscall.ESRCH {
			return os.ErrProcessDone
		}
		return err
	}
	command.WaitDelay = time.Second
	err := command.Run()
	// Kill any orphaned installation children, including when npm itself exits
	// early. A successful helper cannot leave a writer running in its volume.
	if command.Process != nil {
		_ = syscall.Kill(-command.Process.Pid, syscall.SIGKILL)
	}
	if err != nil || commandCtx.Err() != nil || result.overflow {
		return "", failure
	}
	return strings.TrimSpace(result.data.String()), nil
}
func envOr(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
