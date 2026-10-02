package coreoperator

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"golang.org/x/sys/unix"
	"golang.org/x/term"
	"piwork/internal/safefs"
)

const secretBytes = 3*65536 + 2

func protectedFile(path string, limit int64) ([]byte, error) {
	root, err := safefs.OpenExistingRoot(filepath.Dir(path))
	if err != nil {
		return nil, errors.New("protected file is unavailable or unsafe")
	}
	defer root.Close()
	if root.CheckPrivate() != nil {
		return nil, errors.New("protected file parent must be private")
	}
	data, err := root.ReadFile(filepath.Base(path), limit)
	if err != nil {
		return nil, errors.New("protected file is unavailable or unsafe")
	}
	return data, nil
}

func readContentFile(path string, limit int64) ([]byte, error) {
	fd, err := unix.Open(path, unix.O_RDONLY|unix.O_NOFOLLOW|unix.O_CLOEXEC|unix.O_NONBLOCK, 0)
	if err != nil {
		return nil, errors.New("content file is unavailable")
	}
	file := os.NewFile(uintptr(fd), "operator content input")
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() > limit {
		return nil, errors.New("content input must be a bounded regular file")
	}
	raw, err := io.ReadAll(io.LimitReader(file, limit+1))
	if err != nil || int64(len(raw)) > limit || !utf8.Valid(raw) {
		return nil, errors.New("content file is unavailable or invalid")
	}
	return raw, nil
}
func secretValue(raw []byte) (string, error) {
	if !utf8.Valid(raw) {
		return "", errors.New("secret input is invalid")
	}
	value := strings.TrimRight(string(raw), "\r\n")
	if value == "" {
		return "", errors.New("secret input must not be empty")
	}
	return value, nil
}
func readSecret(ctx context.Context, input io.Reader, output io.Writer, stdin bool, prompt string) (string, error) {
	type result struct {
		raw []byte
		err error
	}
	completed := make(chan result, 1)
	if stdin {
		go func() {
			raw, err := io.ReadAll(io.LimitReader(input, secretBytes+1))
			if len(raw) > secretBytes {
				raw, err = nil, errors.New("secret input is too large")
			}
			completed <- result{raw, err}
		}()
	} else {
		file, ok := input.(*os.File)
		terminalOutput, outputOK := output.(*os.File)
		if !ok || !outputOK || !term.IsTerminal(int(file.Fd())) || !term.IsTerminal(int(terminalOutput.Fd())) {
			return "", errors.New("secret input requires a terminal or the explicit stdin option")
		}
		state, err := term.GetState(int(file.Fd()))
		if err != nil {
			return "", errors.New("secret terminal is unavailable")
		}
		defer term.Restore(int(file.Fd()), state)
		fmt.Fprint(output, prompt)
		go func() {
			raw, err := term.ReadPassword(int(file.Fd()))
			if len(raw) > secretBytes {
				raw, err = nil, errors.New("secret input is too large")
			}
			completed <- result{raw, err}
		}()
	}
	select {
	case <-ctx.Done():
		return "", ctx.Err()
	case r := <-completed:
		if !stdin {
			fmt.Fprintln(output)
		}
		if r.err != nil {
			return "", errors.New("secret input could not be read")
		}
		return secretValue(r.raw)
	}
}
