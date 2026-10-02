package dockerengine

import (
	"os"
	"path/filepath"
	"testing"
)

// Unix sockets have a short kernel path limit. Keep the socket separate from
// TMPDIR, which may legitimately point at a long SSD directory for large tests.
func shortEngineSocket(t *testing.T, name string) string {
	t.Helper()
	directory, err := os.MkdirTemp("/tmp", "piwork-engine-test-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := os.RemoveAll(directory); err != nil {
			t.Error(err)
		}
	})
	return filepath.Join(directory, name)
}
