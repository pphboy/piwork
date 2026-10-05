package cli

import (
	"golang.org/x/sys/unix"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"testing"
)

func prepareInterruptFixture(t *testing.T, command *exec.Cmd) {}

func assertPrivateFixtureFile(t *testing.T, path string) {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil || info.Mode().Perm()&0077 != 0 {
		t.Fatal("unsafe private file", err)
	}
}
func makePublicFixtureDirectory(t *testing.T, path string) {
	t.Helper()
	if err := os.Chmod(path, 0777); err != nil {
		t.Fatal(err)
	}
}
func makeLinkedFixtureDirectory(t *testing.T, target, link string) {
	t.Helper()
	if err := os.Symlink(target, link); err != nil {
		t.Fatal(err)
	}
}

func holdCredentialFixtureLock(t *testing.T, path string) func() {
	t.Helper()
	fd, err := unix.Open(filepath.Dir(path), unix.O_RDONLY|unix.O_DIRECTORY, 0)
	if err != nil {
		t.Fatal(err)
	}
	if err := unix.Flock(fd, unix.LOCK_EX|unix.LOCK_NB); err != nil {
		unix.Close(fd)
		t.Fatal(err)
	}
	return func() { unix.Close(fd) }
}
func interruptTestProcess(command *exec.Cmd) error { return command.Process.Signal(syscall.SIGINT) }
