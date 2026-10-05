package clinative

import (
	"golang.org/x/sys/windows"
	"os/exec"
	"syscall"
)

func UserIdentity() (string, error) {
	token, err := windows.OpenCurrentProcessToken()
	if err != nil {
		return "", err
	}
	defer token.Close()
	user, err := token.GetTokenUser()
	if err != nil {
		return "", err
	}
	return user.User.Sid.String(), nil
}

func prepareConsole(command *exec.Cmd) error {
	result, _, err := windows.NewLazySystemDLL("kernel32.dll").NewProc("AllocConsole").Call()
	if result == 0 && err != windows.ERROR_ACCESS_DENIED {
		return err
	}
	command.SysProcAttr = &syscall.SysProcAttr{CreationFlags: windows.CREATE_NEW_PROCESS_GROUP}
	return nil
}
func interrupt(command *exec.Cmd) error {
	return windows.GenerateConsoleCtrlEvent(windows.CTRL_BREAK_EVENT, uint32(command.Process.Pid))
}
