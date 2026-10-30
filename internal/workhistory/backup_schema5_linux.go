//go:build linux

package workhistory

import (
	"context"
	"fmt"
	"github.com/google/uuid"
	"golang.org/x/sys/unix"
	"os"
)

func restoreMemoryHistory(ctx context.Context, root, spool int, request BackupRequest, manifest BackupManifest, digest string) (BackupResult, error) {
	var attrs unix.Stat_t
	if unix.Fstat(root, &attrs) != nil || digest != request.ExpectedManifestDigest || request.TargetSchema <= manifest.SourceSchema || request.TargetSchema > 7 || manifest.WorkID != request.WorkID || manifest.OperationID != request.OperationID || manifest.BackupKey != request.BackupKey || manifest.RootDev != uint64(attrs.Dev) || manifest.RootIno != attrs.Ino {
		return BackupResult{}, ErrInvalid
	}
	if err := verifyBackupFiles(ctx, spool, manifest); err != nil {
		return BackupResult{}, err
	}
	for _, name := range []string{"work.sqlite-journal", "memory.sqlite-journal"} {
		f, err := Regular(root, name)
		if err == nil {
			f.Close()
			return BackupResult{}, ErrBusy
		}
		if !os.IsNotExist(err) {
			return BackupResult{}, err
		}
	}
	// Repeating all copies is safe if the helper was interrupted between files.
	for _, entry := range manifest.Files {
		original, originalErr := Regular(root, entry.Name)
		if originalErr == nil {
			original.Close()
		} else if !os.IsNotExist(originalErr) {
			return BackupResult{}, originalErr
		}
		if !entry.Present {
			f, err := Regular(root, entry.Name)
			if err == nil {
				f.Close()
				if unix.Unlinkat(root, entry.Name, 0) != nil {
					return BackupResult{}, ErrInvalid
				}
			} else if !os.IsNotExist(err) {
				return BackupResult{}, err
			}
			continue
		}
		source, err := Regular(spool, "backup-"+entry.Name)
		if err != nil {
			return BackupResult{}, err
		}
		temp := "restore-" + uuid.NewString() + "-" + entry.Name
		defer unix.Unlinkat(root, temp, 0)
		if err := copyFile(ctx, source, fmt.Sprintf("/proc/self/fd/%d/%s", root, temp)); err != nil {
			source.Close()
			return BackupResult{}, err
		}
		source.Close()
		fd, err := unix.Openat(root, temp, unix.O_RDONLY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
		if err != nil {
			return BackupResult{}, err
		}
		err = unix.Fchown(fd, int(entry.UID), int(entry.GID))
		if err == nil {
			err = unix.Fchmod(fd, entry.Mode)
		}
		if err == nil {
			err = unix.Fsync(fd)
		}
		unix.Close(fd)
		if err != nil {
			return BackupResult{}, err
		}
		if unix.Renameat(root, temp, root, entry.Name) != nil {
			return BackupResult{}, ErrInvalid
		}
	}
	if unix.Fsync(root) != nil {
		return BackupResult{}, ErrInvalid
	}
	if err := verifyRestoredFiles(ctx, root, manifest); err != nil {
		return BackupResult{}, err
	}
	return BackupResult{manifest.SourceSchema, digest, "restored"}, nil
}
