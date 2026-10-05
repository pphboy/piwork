package clinative

import (
	"os"
	"os/exec"
	"strconv"
)

func UserIdentity() (string, error) { return strconv.Itoa(os.Geteuid()), nil }

func prepareConsole(command *exec.Cmd) error { return nil }
func interrupt(command *exec.Cmd) error      { return command.Process.Signal(os.Interrupt) }
