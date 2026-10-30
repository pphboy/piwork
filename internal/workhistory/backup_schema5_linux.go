//go:build linux

package workhistory

import (
	"context"
	"fmt"
	"github.com/google/uuid"
	"golang.org/x/sys/unix"
	"os"
)

// The old writer is fenced. Only fixed managed files are copied, and the
// existing Memory database remains owned by the original Work.
func checkpointMemoryHistory(ctx context.Context, root, spool int, request BackupRequest, version int64) (BackupResult, error) {
	var rootInfo, spoolInfo unix.Stat_t
	if unix.Fstat(root, &rootInfo) != nil || unix.Fstat(spool, &spoolInfo) != nil {
		return BackupResult{}, ErrInvalid
	}
	manifest := BackupManifest{Version: 1, OperationID: request.OperationID, WorkID: request.WorkID, BackupKey: request.BackupKey, RootDev: uint64(rootInfo.Dev), RootIno: rootInfo.Ino, SourceSchema: version, Files: []BackupFile{}}
	names := append(append([]string{}, files...), "memory.sqlite")
	for _, name := range names {
		entry := BackupFile{Name: name}
		source, err := Regular(root, name)
		if os.IsNotExist(err) && name != "work.sqlite" && name != "memory.sqlite" {
			manifest.Files = append(manifest.Files, entry)
			continue
		}
		if err != nil {
			return BackupResult{}, err
		}
		var info unix.Stat_t
		if unix.Fstat(int(source.Fd()), &info) != nil {
			source.Close()
			return BackupResult{}, ErrInvalid
		}
		temp := "backup-" + name + "-" + uuid.NewString() + ".tmp"
		defer unix.Unlinkat(spool, temp, 0)
		if err := copyFile(ctx, source, fmt.Sprintf("/proc/self/fd/%d/%s", spool, temp)); err != nil {
			source.Close()
			return BackupResult{}, err
		}
		digest, err := digestFile(ctx, source)
		source.Close()
		if err != nil {
			return BackupResult{}, err
		}
		if unix.Fchownat(spool, temp, int(spoolInfo.Uid), int(spoolInfo.Gid), unix.AT_SYMLINK_NOFOLLOW) != nil || unix.Renameat(spool, temp, spool, "backup-"+name) != nil {
			return BackupResult{}, ErrInvalid
		}
		entry.Present = true
		entry.Digest = digest
		entry.Size = info.Size
		entry.UID = info.Uid
		entry.GID = info.Gid
		entry.Mode = info.Mode & 07777
		manifest.Files = append(manifest.Files, entry)
	}
	if unix.Fsync(spool) != nil {
		return BackupResult{}, ErrInvalid
	}
	digest, err := writeBackupManifest(spool, manifest)
	if err != nil {
		return BackupResult{}, err
	}
	return BackupResult{version, digest, "saved"}, nil
}

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
