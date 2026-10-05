package clinative

import (
	"errors"
	"os"
	"path/filepath"
	"piwork/internal/clientfs"
)

// CreateStorageFixture prepares harmless sentinels for a genuinely different
// OS account. It never creates accounts or changes existing user permissions.
func CreateStorageFixture(path string) (string, error) {
	if _, err := os.Lstat(path); !os.IsNotExist(err) {
		return "", errors.New("fixture directory must not already exist")
	}
	dir, err := clientfs.OpenPrivateDirectory(path, true)
	if err != nil {
		return "", err
	}
	defer dir.Close()
	file, err := dir.CreateExclusive("sentinel.txt")
	if err != nil {
		return "", err
	}
	_, writeErr := file.WriteString("piwork native other-user sentinel\n")
	err = errors.Join(writeErr, file.Sync(), file.Close())
	if err != nil {
		return "", err
	}
	return UserIdentity()
}

func ProbeOtherUserStorage(path, expectedOwner string) error {
	user, err := UserIdentity()
	if err != nil {
		return err
	}
	if expectedOwner == "" || user == expectedOwner {
		return errors.New("fixture must run as a genuinely different OS account")
	}
	filename := filepath.Join(path, "sentinel.txt")
	for _, mode := range []int{os.O_RDONLY, os.O_WRONLY} {
		file, err := os.OpenFile(filename, mode, 0)
		if file != nil {
			file.Close()
		}
		if !errors.Is(err, os.ErrPermission) {
			return errors.New("other account read/write was not denied by native access control")
		}
	}
	if err := os.Mkdir(filepath.Join(path, "must-not-create"), 0700); !errors.Is(err, os.ErrPermission) {
		return errors.New("other account directory mutation was not denied")
	}
	if dir, err := clientfs.OpenPrivateDirectory(path, false); err == nil {
		dir.Close()
		return errors.New("other account opened owner private storage")
	}
	return nil
}
