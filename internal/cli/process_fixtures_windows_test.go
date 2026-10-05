package cli

import (
	"os/exec"
	"path/filepath"
	"sync"
	"syscall"
	"testing"

	"golang.org/x/sys/windows"
	"piwork/internal/clientfs"
)

var fixtureConsoleOnce sync.Once
var fixtureConsoleError error

func assertPrivateFixtureFile(t *testing.T, path string) {
	t.Helper()
	dir, err := clientfs.OpenPrivateDirectory(filepath.Dir(path), false)
	if err != nil {
		t.Fatal(err)
	}
	defer dir.Close()
	file, err := dir.OpenRegular(filepath.Base(path))
	if err != nil {
		t.Fatal(err)
	}
	file.Close()
}
func makePublicFixtureDirectory(t *testing.T, path string) {
	t.Helper()
	token, err := windows.OpenCurrentProcessToken()
	if err != nil {
		t.Fatal(err)
	}
	defer token.Close()
	user, err := token.GetTokenUser()
	if err != nil {
		t.Fatal(err)
	}
	sd, err := windows.SecurityDescriptorFromString("D:P(A;OICI;FA;;;" + user.User.Sid.String() + ")(A;OICI;FR;;;WD)")
	if err != nil {
		t.Fatal(err)
	}
	acl, _, err := sd.DACL()
	if err != nil {
		t.Fatal(err)
	}
	if err := windows.SetNamedSecurityInfo(path, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION, nil, nil, acl, nil); err != nil {
		t.Fatal(err)
	}
}
func makeLinkedFixtureDirectory(t *testing.T, target, link string) {
	t.Helper()
	command := exec.Command("cmd.exe", "/c", "mklink", "/J", link, target)
	if result, err := command.CombinedOutput(); err != nil {
		t.Fatalf("junction fixture: %v %s", err, result)
	}
}

func holdCredentialFixtureLock(t *testing.T, path string) func() {
	t.Helper()
	dir, err := clientfs.OpenPrivateDirectory(filepath.Join(filepath.Dir(path), ".credential-lock"), false)
	if err != nil {
		t.Fatal(err)
	}
	lock, err := dir.TryLock(".lock")
	if err != nil {
		dir.Close()
		t.Fatal(err)
	}
	return func() { lock.Close(); dir.Close() }
}

func prepareInterruptFixture(t *testing.T, command *exec.Cmd) {
	t.Helper()
	fixtureConsoleOnce.Do(func() {
		result, _, err := windows.NewLazySystemDLL("kernel32.dll").NewProc("AllocConsole").Call()
		// ACCESS_DENIED means this test process already has a console.
		if result == 0 && err != windows.ERROR_ACCESS_DENIED {
			fixtureConsoleError = err
		}
	})
	if fixtureConsoleError != nil {
		t.Fatalf("console-control fixture unavailable: %v", fixtureConsoleError)
	}
	command.SysProcAttr = &syscall.SysProcAttr{CreationFlags: windows.CREATE_NEW_PROCESS_GROUP}
}

func interruptTestProcess(command *exec.Cmd) error {
	return windows.GenerateConsoleCtrlEvent(windows.CTRL_BREAK_EVENT, uint32(command.Process.Pid))
}
