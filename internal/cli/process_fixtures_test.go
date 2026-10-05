package cli

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
)

func nativeTestCommand(t *testing.T, args ...string) *exec.Cmd {
	t.Helper()
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	command := exec.Command(executable, args...)
	prepareInterruptFixture(t, command)
	return command
}

func nativeCLIForTest(t *testing.T) string {
	t.Helper()
	if supplied := os.Getenv("PIWORK_TEST_CLI_BINARY"); supplied != "" {
		absolute, err := filepath.Abs(supplied)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := os.Stat(absolute); err != nil {
			t.Fatal(err)
		}
		return absolute
	}
	filename := "piwork-cli"
	if runtime.GOOS == "windows" {
		filename += ".exe"
	}
	binary := filepath.Join(t.TempDir(), filename)
	build := exec.Command("go", "build", "-mod=readonly", "-o", binary, "./cmd/piwork-cli")
	build.Dir = "../.."
	if result, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build: %v %s", err, result)
	}
	return binary
}
