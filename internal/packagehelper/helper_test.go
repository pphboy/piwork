package packagehelper

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"piwork/internal/pipackage"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

// The command tests use a native fixture executable, never host npm/Git.
func TestMain(m *testing.M) {
	if len(os.Args) > 1 && os.Getenv("CI") == "true" && (filepath.Base(os.Args[0]) == "npm" || os.Args[1] == "descendant") {
		switch os.Args[1] {
		case "install", "ci":
			var root string
			for i, arg := range os.Args {
				if arg == "--prefix" && i+1 < len(os.Args) {
					root = os.Args[i+1]
				}
			}
			raw, err := os.ReadFile(filepath.Join(root, "package.json"))
			if err != nil {
				os.Exit(7)
			}
			if os.WriteFile(filepath.Join(root, "observed-manifest.json"), raw, 0600) != nil {
				os.Exit(7)
			}
			if os.WriteFile(filepath.Join(root, "observed-action"), []byte(os.Args[1]), 0600) != nil {
				os.Exit(7)
			}
			if os.Getenv("NPM_CONFIG_REGISTRY") == "fixture-fail" {
				os.Exit(7)
			}
			os.Exit(0)
		case "arguments":
			data, _ := json.Marshal(map[string]any{"args": os.Args[2:], "secret": os.Getenv("PIWORK_TEST_SECRET"), "config": os.Getenv("npm_config_userconfig")})
			fmt.Println(string(data))
			os.Exit(0)
		case "overflow":
			fmt.Print(strings.Repeat("private diagnostics", 4096))
			os.Exit(0)
		case "failure":
			fmt.Fprint(os.Stderr, "credential-private /host/private/root")
			os.Exit(7)
		case "descendant":
			for {
				time.Sleep(time.Hour)
			}
		case "blocked":
			exe, _ := os.Executable()
			child := exec.Command(exe, "descendant")
			child.Stdout = os.Stdout
			child.Stderr = os.Stderr
			child.Env = os.Environ()
			if child.Start() != nil {
				os.Exit(7)
			}
			os.WriteFile(filepath.Join(os.Getenv("HOME"), "child.pid"), []byte(strconv.Itoa(child.Process.Pid)), 0600)
			child.Wait()
			os.Exit(0)
		}
		os.Exit(7)
	}
	os.Exit(m.Run())
}

func TestInstallOriginalManifestRestoredAndLockSelectsCI(t *testing.T) {
	for _, item := range []struct {
		name       string
		lock, fail bool
	}{{"unlocked", false, false}, {"failed", false, true}, {"locked", true, false}} {
		t.Run(item.name, func(t *testing.T) {
			bin, root, hosts := t.TempDir(), t.TempDir(), t.TempDir()
			exe, _ := os.Executable()
			if err := os.Symlink(exe, filepath.Join(bin, "npm")); err != nil {
				t.Fatal(err)
			}
			t.Setenv("PATH", bin)
			if item.fail {
				t.Setenv("NPM_CONFIG_REGISTRY", "fixture-fail")
			} else {
				t.Setenv("NPM_CONFIG_REGISTRY", "")
			}
			for _, name := range pipackage.HostModules {
				directory := filepath.Join(hosts, name)
				if err := os.MkdirAll(directory, 0755); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(filepath.Join(directory, "package.json"), []byte(`{"version":"0.86.1"}`), 0644); err != nil {
					t.Fatal(err)
				}
			}
			original := []byte(" {\"name\":\"tools\",\"version\":\"1.0.0\",\"devDependencies\":{\"unavailable-dev\":\"99.0.0\"},\"peerDependencies\":{\"@earendil-works/pi-ai\":\"^0.86.0\"}}\n")
			if err := os.WriteFile(filepath.Join(root, "package.json"), original, 0755); err != nil {
				t.Fatal(err)
			}
			if item.lock {
				if err := os.WriteFile(filepath.Join(root, "package-lock.json"), []byte(`{"name":"tools","version":"1.0.0","lockfileVersion":3,"packages":{"":{}}}`), 0644); err != nil {
					t.Fatal(err)
				}
			}
			err := (Helper{Paths: Paths{HostModuleRoot: hosts}}).install(context.Background(), root)
			if item.fail && !errors.Is(err, ErrInstall) || !item.fail && err != nil {
				t.Fatal("install result differs", err)
			}
			after, err := os.ReadFile(filepath.Join(root, "package.json"))
			if err != nil || !bytes.Equal(after, original) {
				t.Fatal("original manifest was not restored", err)
			}
			info, err := os.Stat(filepath.Join(root, "package.json"))
			if err != nil || info.Mode().Perm() != 0755 {
				t.Fatal("manifest execute mode changed", err)
			}
			observed, err := os.ReadFile(filepath.Join(root, "observed-manifest.json"))
			if err != nil {
				t.Fatal(err)
			}
			if strings.Contains(string(observed), "devDependencies") != item.lock {
				t.Fatal("dev trimming/lock semantics differ")
			}
			action, err := os.ReadFile(filepath.Join(root, "observed-action"))
			expected := "install"
			if item.lock {
				expected = "ci"
			}
			if err != nil || string(action) != expected {
				t.Fatal("incorrect npm action", err)
			}
		})
	}
}

func TestInstallRejectsPiHostDependencyBeforeInvokingNPM(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "package.json"), []byte(`{"name":"tools","version":"1.0.0","dependencies":{"@earendil-works/pi-ai":"0.86.1"}}`), 0644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", t.TempDir())
	err := (Helper{Paths: Paths{HostModuleRoot: t.TempDir()}}).install(context.Background(), root)
	if !errors.Is(err, pipackage.ErrManifest) {
		t.Fatalf("Pi host runtime dependency should be invalid manifest: %v", err)
	}
}

func TestCommandArgumentsEnvironmentOutputAndFailure(t *testing.T) {
	bin := t.TempDir()
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	if err = os.Symlink(exe, filepath.Join(bin, "npm")); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin)
	t.Setenv("PIWORK_TEST_SECRET", "must not reach installation")
	t.Setenv("HOME", t.TempDir())
	output, err := runCommand(context.Background(), "npm", []string{"arguments", "literal $(private)", "semi;colon", "with space"}, t.TempDir(), ErrFetch, true, time.Second)
	var result struct {
		Args           []string
		Secret, Config string
	}
	if err != nil || json.Unmarshal([]byte(output), &result) != nil || len(result.Args) != 3 || result.Args[0] != "literal $(private)" || result.Secret != "" || result.Config != "/dev/null" {
		t.Fatal("argv/environment isolation failed", err, result)
	}
	for _, action := range []string{"failure", "overflow"} {
		output, err := runCommand(context.Background(), "npm", []string{action}, t.TempDir(), ErrFetch, true, time.Second)
		if output != "" || !errors.Is(err, ErrFetch) {
			t.Fatal("unsafe failure projection", err)
		}
	}
}
func TestCommandTimeoutAndCancelKillEntireProcessGroup(t *testing.T) {
	for _, mode := range []string{"timeout", "cancel"} {
		t.Run(mode, func(t *testing.T) {
			bin, home := t.TempDir(), t.TempDir()
			exe, _ := os.Executable()
			if err := os.Symlink(exe, filepath.Join(bin, "npm")); err != nil {
				t.Fatal(err)
			}
			t.Setenv("PATH", bin)
			t.Setenv("HOME", home)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			timeout := time.Second
			if mode == "timeout" {
				timeout = 400 * time.Millisecond
			}
			done := make(chan error, 1)
			go func() {
				_, err := runCommand(ctx, "npm", []string{"blocked"}, home, ErrInstall, false, timeout)
				done <- err
			}()
			var pid int
			deadline := time.Now().Add(3 * time.Second)
			for time.Now().Before(deadline) {
				raw, err := os.ReadFile(filepath.Join(home, "child.pid"))
				if err == nil {
					pid, _ = strconv.Atoi(string(raw))
					break
				}
				time.Sleep(10 * time.Millisecond)
			}
			if pid == 0 {
				t.Fatal("fixture child did not start")
			}
			if mode == "cancel" {
				cancel()
			}
			select {
			case err := <-done:
				if !errors.Is(err, ErrInstall) {
					t.Fatal(err)
				}
			case <-time.After(3 * time.Second):
				t.Fatal("command cancellation hung")
			}
			// A killed child may briefly be a zombie until init reaps it.
			stat, err := os.ReadFile(fmt.Sprintf("/proc/%d/stat", pid))
			if err == nil && !strings.Contains(string(stat), ") Z ") {
				t.Fatal("installation descendant still running", syscall.Kill(pid, 0))
			}
		})
	}
}

func TestStaticHelperEntriesCaptureAndMeasureNeverExecuteScripts(t *testing.T) {
	work, spool := t.TempDir(), t.TempDir()
	root := filepath.Join(work, "result")
	if err := os.Mkdir(root, 0755); err != nil {
		t.Fatal(err)
	}
	original := []byte(" {\"name\":\"fixture-tools\",\"version\":\"1.0.0\",\"scripts\":{\"postinstall\":\"this-must-never-run\"}}\n")
	if err := os.WriteFile(filepath.Join(root, "package.json"), original, 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "danger.js"), []byte("throw Error('must never run');"), 0644); err != nil {
		t.Fatal(err)
	}
	request := []byte(`{"sourceKind":"local","resolvedSource":"fixture-tools","preparedEnvironment":{"os":"linux","architecture":"amd64","variant":null,"nodeAbi":"137","piSdkVersion":"0.86.0"}}`)
	if err := os.WriteFile(filepath.Join(spool, "request.json"), request, 0644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", "/no-platform-tools")
	helper := Helper{Paths: Paths{WorkRoot: work, SpoolRoot: spool}}
	capture, err := helper.Run(context.Background(), "capture")
	if err != nil {
		t.Fatal(err)
	}
	result := capture.(Captured)
	if result.Metadata.Name != "fixture-tools" || result.EntryCount != 2 || result.ZipBytes == 0 {
		t.Fatal(result)
	}
	raw, err := os.ReadFile(filepath.Join(spool, "result.json"))
	if err != nil {
		t.Fatal(err)
	}
	var published Captured
	if json.Unmarshal(raw, &published) != nil || published.Metadata.ContentDigest != result.Metadata.ContentDigest {
		t.Fatal("published result mismatch")
	}
	for _, name := range []string{"artifact.zip", "result.json"} {
		info, err := os.Stat(filepath.Join(spool, name))
		if err != nil || info.Mode().Perm() != 0644 {
			t.Fatal("capture projection permission", name, err)
		}
	}
	restored := filepath.Join(t.TempDir(), "result")
	if _, err := pipackage.ExtractArchive(context.Background(), filepath.Join(spool, "artifact.zip"), restored); err != nil {
		t.Fatal(err)
	}
	after, err := os.ReadFile(filepath.Join(restored, "package.json"))
	if err != nil || !bytes.Equal(after, original) {
		t.Fatal("original manifest changed", err)
	}
	if _, err := helper.Run(context.Background(), "measure"); err != nil {
		t.Fatal(err)
	}
	if _, err := helper.Run(context.Background(), "init"); err != nil {
		t.Fatal(err)
	}
	if _, err := helper.Run(context.Background(), "capture"); !errors.Is(err, pipackage.ErrUnsafe) {
		t.Fatal("repeat capture overwrote result", err)
	}
	if _, err := helper.Run(context.Background(), "other"); err == nil {
		t.Fatal("invalid action accepted")
	}
}

func TestCaptureCannotRedirectRootOutsideItsWorkVolume(t *testing.T) {
	work, spool, outside := t.TempDir(), t.TempDir(), t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "package.json"), []byte(`{"name":"unrelated-private"}`), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(work, "result")); err != nil {
		t.Fatal(err)
	}
	request := []byte(`{"sourceKind":"local","resolvedSource":"tools","preparedEnvironment":{"os":"linux","architecture":"amd64","variant":null,"nodeAbi":"137","piSdkVersion":"0.86.1"}}`)
	if err := os.WriteFile(filepath.Join(spool, "request.json"), request, 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := (Helper{Paths: Paths{WorkRoot: work, SpoolRoot: spool}}).Run(context.Background(), "capture"); !errors.Is(err, pipackage.ErrUnsafe) {
		t.Fatal("outside capture root accepted", err)
	}
	if _, err := os.Lstat(filepath.Join(spool, "artifact.zip")); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("outside bytes published")
	}
}
