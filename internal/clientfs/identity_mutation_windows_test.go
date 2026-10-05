package clientfs

import (
	"errors"
	"golang.org/x/sys/windows"
	"os"
	"path/filepath"
	"testing"
)

func modifyIdentityInput(t *testing.T, d *Directory, path string, reader *os.File) *os.File {
	t.Helper()
	// Native sharing must prevent mutation for the entire validation/upload
	// lifetime, including private transfer inputs. A closed reader may change,
	// so opening it again must observe the new metadata/identity.
	writer, err := os.OpenFile(filepath.Join(path, "input"), os.O_WRONLY, 0)
	if writer != nil {
		writer.Close()
	}
	if !errors.Is(err, windows.ERROR_SHARING_VIOLATION) {
		t.Fatal("input reader permitted mutation", err)
	}
	if err := reader.Close(); err != nil {
		t.Fatal(err)
	}
	writeIdentityInput(t, path)
	reader, err = d.OpenRegular("input")
	if err != nil {
		t.Fatal(err)
	}
	return reader
}
