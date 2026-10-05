package pipackage

import (
	"context"
	"os"
	"path/filepath"

	"piwork/internal/clientfs"
)

func openArchiveOutput(output string, mode os.FileMode, inheritOwner bool) (*archiveOutput, error) {
	parent, err := clientfs.OpenDirectory(filepath.Dir(output))
	if err != nil {
		return nil, err
	}
	temporary, err := randomName(".package-zip-")
	if err != nil {
		parent.Close()
		return nil, err
	}
	file, err := parent.CreatePrivateExclusive(temporary)
	if err != nil {
		parent.Close()
		return nil, err
	}
	return &archiveOutput{file: file, commit: func() error {
		return parent.PublishReplace(context.Background(), temporary, filepath.Base(output))
	}, close: func() {
		file.Close()
		parent.Remove(temporary)
		parent.Close()
	}}, nil
}
