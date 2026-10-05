package clientfs

import (
	"os"
	"testing"
)

func modifyIdentityInput(t *testing.T, d *Directory, path string, reader *os.File) *os.File {
	t.Helper()
	writeIdentityInput(t, path)
	return reader
}
