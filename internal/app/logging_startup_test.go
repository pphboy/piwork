package app

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestHelpAndInvalidStartupDoNotCreateLogs(t *testing.T) {
	directory := t.TempDir()
	var stdout, stderr bytes.Buffer
	if code := Run(context.Background(), []string{"--help"}, &stdout, &stderr); code != 0 || stdout.Len() == 0 {
		t.Fatalf("help failed: %d", code)
	}
	if _, err := os.Stat(filepath.Join(directory, "logs")); !os.IsNotExist(err) {
		t.Fatal("help created a log namespace")
	}
	stdout.Reset()
	stderr.Reset()
	if code := Run(context.Background(), []string{"--data-dir", directory, "--ui-port", "invalid"}, &stdout, &stderr); code != 2 {
		t.Fatalf("invalid startup accepted: %d", code)
	}
	if _, err := os.Stat(filepath.Join(directory, "logs")); !os.IsNotExist(err) {
		t.Fatal("invalid startup created a log namespace")
	}
}
