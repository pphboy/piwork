package clinative

import (
	"errors"
	"net"
	"os"
	"time"
)

func ProbeOtherUserControl(path string) error {
	if path == "" {
		return errors.New("live owner Desktop socket fixture is required")
	}
	connection, err := net.DialTimeout("unix", path, 3*time.Second)
	if connection != nil {
		connection.Close()
	}
	if !errors.Is(err, os.ErrPermission) {
		return errors.New("other UID access was not denied by the live native Unix socket")
	}
	return nil
}
