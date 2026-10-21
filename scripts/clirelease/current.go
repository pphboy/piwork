package clirelease

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
)

// PackageCurrent owns only dist/cli-release. Stage the complete archive and its
// checksum before replacing any previous client release; data paths are refused.
func PackageCurrent(root, directory, evidence, output string) (string, error) {
	root, err := filepath.Abs(root)
	if err != nil {
		return "", err
	}
	output, err = filepath.Abs(output)
	if err != nil {
		return "", err
	}
	if output != filepath.Join(root, "dist", "cli-release") {
		return "", errors.New("client release output must be dist/cli-release")
	}
	for path := output; ; path = filepath.Dir(path) {
		info, err := os.Lstat(path)
		if err != nil && !os.IsNotExist(err) {
			return "", err
		}
		if err == nil && info.Mode()&os.ModeSymlink != 0 {
			return "", errors.New("release output must not follow links")
		}
		if path == filepath.Dir(path) {
			break
		}
	}
	if err = os.MkdirAll(filepath.Dir(output), 0755); err != nil {
		return "", err
	}
	backup := output + ".previous"
	if info, err := os.Lstat(backup); err == nil {
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return "", errors.New("unsafe release backup")
		}
		if _, err = os.Stat(output); os.IsNotExist(err) {
			err = os.Rename(backup, output)
		} else if err == nil {
			err = os.RemoveAll(backup)
		}
		if err != nil {
			return "", err
		}
	} else if !os.IsNotExist(err) {
		return "", err
	}
	stage, err := os.MkdirTemp(filepath.Dir(output), "cli-release.stage-")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(stage)
	archive, err := Package(directory, evidence, stage)
	if err != nil {
		return "", err
	}
	if _, err = os.Stat(output); err == nil {
		if err = os.Rename(output, backup); err != nil {
			return "", err
		}
	} else if !os.IsNotExist(err) {
		return "", err
	}
	if err = os.Rename(stage, output); err != nil {
		restore := os.Rename(backup, output)
		if os.IsNotExist(restore) {
			restore = nil
		}
		return "", errors.Join(err, restore)
	}
	if err = os.RemoveAll(backup); err != nil {
		return "", err
	}
	return filepath.Join(output, strings.TrimPrefix(archive, stage+string(filepath.Separator))), nil
}
