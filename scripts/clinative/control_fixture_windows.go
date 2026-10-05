package clinative

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/Microsoft/go-winio"
	"golang.org/x/sys/windows"
)

func ProbeOtherUserControl(name string) error {
	if !strings.HasPrefix(name, `\\.\pipe\piwork-desktop-`) {
		return errors.New("live owner Desktop pipe fixture is required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	connection, err := winio.DialPipeContext(ctx, name)
	if connection != nil {
		connection.Close()
	}
	if !errors.Is(err, windows.ERROR_ACCESS_DENIED) {
		return errors.New("other SID access was not denied by the live native pipe DACL")
	}
	return nil
}
