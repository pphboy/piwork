//go:build linux

package workhistory

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strings"

	"golang.org/x/sys/unix"
	"piwork/internal/contracts"
	"piwork/internal/workpackage"
)

type BackupRequest struct {
	OperationID            string   `json:"operationId"`
	WorkID                 string   `json:"workId"`
	BackupKey              string   `json:"backupKey"`
	ContextIDs             []string `json:"contextIds"`
	ExpectedManifestDigest string   `json:"expectedManifestDigest,omitempty"`
}
type BackupFile struct {
	Name    string `json:"name"`
	Present bool   `json:"present"`
	Digest  string `json:"digest"`
	Size    int64  `json:"size"`
	UID     uint32 `json:"uid"`
	GID     uint32 `json:"gid"`
	Mode    uint32 `json:"mode"`
}
type BackupManifest struct {
	Version           int          `json:"version"`
	OperationID       string       `json:"operationId"`
	WorkID            string       `json:"workId"`
	BackupKey         string       `json:"backupKey"`
	Files             []BackupFile `json:"files"`
	MemoryCreated     bool         `json:"memoryCreated"`
	MemoryInitialized bool         `json:"memoryInitialized"`
	MemoryDev         uint64       `json:"memoryDev"`
	MemoryIno         uint64       `json:"memoryIno"`
	RootDev           uint64       `json:"rootDev"`
	RootIno           uint64       `json:"rootIno"`
}
type BackupResult struct {
	SchemaVersion  int64  `json:"schemaVersion"`
	ManifestDigest string `json:"manifestDigest"`
	State          string `json:"state"`
}

func backupIDs(request BackupRequest) bool {
	valid := func(value string) bool {
		return value != "" && len(value) <= 128 && !strings.ContainsAny(value, "/\\\x00\r\n")
	}
	return valid(request.WorkID) && valid(request.OperationID) && valid(request.BackupKey)
}
func digestFile(ctx context.Context, file *os.File) (string, error) {
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return "", err
	}
	hash := sha256.New()
	if _, err := io.Copy(hash, reader{ctx, file}); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}
func backupManifest(spool int) (BackupManifest, string, error) {
	var manifest BackupManifest
	file, err := Regular(spool, "history-backup-manifest.json")
	if err != nil {
		return manifest, "", err
	}
	defer file.Close()
	raw, err := io.ReadAll(io.LimitReader(file, 1<<20))
	if err != nil {
		return manifest, "", err
	}
	if _, err := contracts.ParseJSON(strings.NewReader(string(raw)), 1<<20); err != nil {
		return manifest, "", ErrInvalid
	}
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&manifest) != nil || manifest.Version != 1 {
		return manifest, "", ErrInvalid
	}
	hash := sha256.Sum256(raw)
	return manifest, hex.EncodeToString(hash[:]), nil
}
func writeBackupManifest(spool int, manifest BackupManifest) (string, error) {
	raw, err := contracts.EncodeCanonicalJSON(manifest)
	if err != nil {
		return "", err
	}
	temp := "history-backup-manifest-" + uuid.NewString() + ".tmp"
	fd, err := unix.Openat(spool, temp, unix.O_WRONLY|unix.O_CREAT|unix.O_EXCL|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0600)
	if err != nil {
		return "", err
	}
	file := os.NewFile(uintptr(fd), temp)
	var parent unix.Stat_t
	if unix.Fstat(spool, &parent) != nil || unix.Fchown(fd, int(parent.Uid), int(parent.Gid)) != nil {
		file.Close()
		return "", ErrInvalid
	}
	_, err = file.Write(raw)
	if err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		return "", err
	}
	if err := unix.Renameat(spool, temp, spool, "history-backup-manifest.json"); err != nil {
		return "", err
	}
	if err := unix.Fsync(spool); err != nil {
		return "", err
	}
	hash := sha256.Sum256(raw)
	return hex.EncodeToString(hash[:]), nil
}

// CheckpointHistory is invoked only after the Core has fenced and stopped the old writer.
func CheckpointHistory(ctx context.Context, privateDirectory, spoolDirectory string, request BackupRequest) (BackupResult, error) {
	if !backupIDs(request) {
		return BackupResult{}, ErrInvalid
	}
	root, err := workpackage.OpenDirectoryFD(privateDirectory)
	if err != nil {
		return BackupResult{}, err
	}
	defer unix.Close(root)
	spool, err := workpackage.OpenDirectoryFD(spoolDirectory)
	if err != nil {
		return BackupResult{}, err
	}
	defer unix.Close(spool)
	if manifest, digest, err := backupManifest(spool); err == nil {
		if manifest.OperationID != request.OperationID || manifest.WorkID != request.WorkID || manifest.BackupKey != request.BackupKey {
			return BackupResult{}, ErrInvalid
		}
		if err := verifyBackupFiles(ctx, spool, manifest); err != nil {
			return BackupResult{}, err
		}
		if manifest.MemoryInitialized {
			if err := verifyBackupMemory(root, manifest); err != nil {
				return BackupResult{}, err
			}
			return BackupResult{4, digest, "saved"}, nil
		}
		return prepareBackupMemory(ctx, privateDirectory, root, spool, manifest)
	} else if !os.IsNotExist(err) {
		return BackupResult{}, err
	}
	contexts := map[string]bool{}
	for _, id := range request.ContextIDs {
		contexts[id] = true
	}
	snapshot, err := Open(ctx, privateDirectory, Scope{SourceWorkID: request.WorkID, ContextIDs: contexts, ScratchDirectory: spoolDirectory})
	if err != nil {
		return BackupResult{}, err
	}
	if snapshot == nil {
		return BackupResult{0, "", "not-required"}, nil
	}
	version := snapshot.SchemaVersion
	snapshot.Close()
	if version == 5 {
		return BackupResult{5, "", "not-required"}, nil
	}
	if version != 4 {
		return BackupResult{}, ErrUnsupported
	}
	memory, err := Regular(root, "memory.sqlite")
	if err == nil {
		memory.Close()
		return BackupResult{}, ErrInvalid
	}
	if !os.IsNotExist(err) {
		return BackupResult{}, err
	}
	var attributes unix.Stat_t
	if unix.Fstat(root, &attributes) != nil {
		return BackupResult{}, ErrInvalid
	}
	manifest := BackupManifest{Version: 1, OperationID: request.OperationID, WorkID: request.WorkID, BackupKey: request.BackupKey, RootDev: uint64(attributes.Dev), RootIno: attributes.Ino, Files: []BackupFile{}}
	for _, name := range files {
		entry := BackupFile{Name: name}
		source, err := Regular(root, name)
		if os.IsNotExist(err) {
			manifest.Files = append(manifest.Files, entry)
			continue
		}
		if err != nil {
			return BackupResult{}, err
		}
		var stat unix.Stat_t
		if unix.Fstat(int(source.Fd()), &stat) != nil {
			source.Close()
			return BackupResult{}, ErrInvalid
		}
		backupName := "backup-" + name
		tempName := backupName + "-" + uuid.NewString() + ".tmp"
		defer unix.Unlinkat(spool, tempName, 0)
		backupPath := fmt.Sprintf("/proc/self/fd/%d/%s", spool, tempName)
		if err := copyFile(ctx, source, backupPath); err != nil {
			source.Close()
			return BackupResult{}, err
		}
		digest, err := digestFile(ctx, source)
		source.Close()
		if err != nil {
			return BackupResult{}, err
		}
		var spoolAttrs unix.Stat_t
		if unix.Fstat(spool, &spoolAttrs) != nil || unix.Fchownat(spool, tempName, int(spoolAttrs.Uid), int(spoolAttrs.Gid), unix.AT_SYMLINK_NOFOLLOW) != nil {
			return BackupResult{}, ErrInvalid
		}
		if err := unix.Renameat(spool, tempName, spool, backupName); err != nil {
			return BackupResult{}, err
		}
		entry.Present = true
		entry.Digest = digest
		entry.Size = stat.Size
		entry.UID = stat.Uid
		entry.GID = stat.Gid
		entry.Mode = stat.Mode & 07777
		manifest.Files = append(manifest.Files, entry)
	}
	// Persist the original recovery bytes before creating any migration output.
	if _, err := writeBackupManifest(spool, manifest); err != nil {
		return BackupResult{}, err
	}
	return prepareBackupMemory(ctx, privateDirectory, root, spool, manifest)
}

func verifyBackupFiles(ctx context.Context, spool int, manifest BackupManifest) error {
	if len(manifest.Files) != len(files) {
		return ErrInvalid
	}
	for i, entry := range manifest.Files {
		if entry.Name != files[i] {
			return ErrInvalid
		}
		if !entry.Present {
			continue
		}
		f, err := Regular(spool, "backup-"+entry.Name)
		if err != nil {
			return err
		}
		stat, err := f.Stat()
		got, hashErr := digestFile(ctx, f)
		f.Close()
		if err != nil || hashErr != nil || stat.Size() != entry.Size || got != entry.Digest {
			return ErrInvalid
		}
	}
	return nil
}
func verifyBackupMemory(root int, manifest BackupManifest) error {
	var attrs unix.Stat_t
	if unix.Fstat(root, &attrs) != nil || manifest.RootDev != uint64(attrs.Dev) || manifest.RootIno != attrs.Ino {
		return ErrInvalid
	}
	f, err := Regular(root, "memory.sqlite")
	if err != nil {
		return err
	}
	defer f.Close()
	var stat unix.Stat_t
	if unix.Fstat(int(f.Fd()), &stat) != nil || !manifest.MemoryCreated || manifest.MemoryDev != uint64(stat.Dev) || manifest.MemoryIno != stat.Ino {
		return ErrInvalid
	}
	return nil
}
func prepareBackupMemory(ctx context.Context, privateDirectory string, root, spool int, manifest BackupManifest) (BackupResult, error) {
	var attrs unix.Stat_t
	if unix.Fstat(root, &attrs) != nil || manifest.RootDev != uint64(attrs.Dev) || manifest.RootIno != attrs.Ino {
		return BackupResult{}, ErrInvalid
	}
	file, err := Regular(root, "memory.sqlite")
	if err == nil {
		file.Close()
		if verifyBackupMemory(root, manifest) != nil {
			return BackupResult{}, ErrInvalid
		}
	} else if os.IsNotExist(err) {
		// Persist ownership of an unnamed inode before publishing its path. A killed
		// helper leaves either no file or an inode already recorded by this operation.
		fd, err := unix.Openat(root, ".", unix.O_TMPFILE|unix.O_RDWR|unix.O_CLOEXEC, 0600)
		if err != nil {
			return BackupResult{}, err
		}
		defer unix.Close(fd)
		var stat unix.Stat_t
		if unix.Fstat(fd, &stat) != nil || unix.Fchown(fd, int(attrs.Uid), int(attrs.Gid)) != nil {
			return BackupResult{}, ErrInvalid
		}
		manifest.MemoryCreated = true
		manifest.MemoryDev = uint64(stat.Dev)
		manifest.MemoryIno = stat.Ino
		if _, err := writeBackupManifest(spool, manifest); err != nil {
			return BackupResult{}, err
		}
		if err := unix.Linkat(fd, "", root, "memory.sqlite", unix.AT_EMPTY_PATH); err != nil {
			return BackupResult{}, err
		}
		if unix.Fsync(root) != nil {
			return BackupResult{}, ErrInvalid
		}
	} else {
		return BackupResult{}, err
	}
	db, err := database(filepath.Join(privateDirectory, "memory.sqlite"), false)
	if err != nil {
		return BackupResult{}, err
	}
	// Initialization is idempotent only for the trusted exact schema created here.
	var count int
	if _, err = db.ExecContext(ctx, "BEGIN IMMEDIATE"); err != nil {
		db.Close()
		return BackupResult{}, err
	}
	err = db.QueryRowContext(ctx, "SELECT count(*) FROM sqlite_master").Scan(&count)
	if err == nil && count == 0 {
		_, err = db.ExecContext(ctx, memorySchemaSQL)
	}
	if err == nil {
		err = validateBackupMemorySchema(ctx, db)
	}
	if err == nil {
		_, err = db.ExecContext(ctx, "INSERT OR IGNORE INTO memory_versions VALUES(0,strftime('%Y-%m-%dT%H:%M:%fZ','now'),0); INSERT OR IGNORE INTO memory_head VALUES(1,0,strftime('%Y-%m-%dT%H:%M:%fZ','now'))")
	}
	if err == nil {
		_, err = db.ExecContext(ctx, "INSERT OR IGNORE INTO memory_meta VALUES(1,1,?,?)", manifest.WorkID, manifest.BackupKey)
	}
	if err == nil {
		_, err = db.ExecContext(ctx, "COMMIT")
	}
	if err != nil {
		_, _ = db.ExecContext(ctx, "ROLLBACK")
	}
	closeErr := db.Close()
	if err != nil {
		return BackupResult{}, err
	}
	if closeErr != nil {
		return BackupResult{}, closeErr
	}
	manifest.MemoryInitialized = true
	digest, err := writeBackupManifest(spool, manifest)
	if err != nil {
		return BackupResult{}, err
	}
	return BackupResult{4, digest, "saved"}, nil
}

// RestoreHistoryBackup never rolls back business files or accepts arbitrary paths.
func RestoreHistoryBackup(ctx context.Context, privateDirectory, spoolDirectory string, request BackupRequest) (BackupResult, error) {
	if !backupIDs(request) || request.ExpectedManifestDigest == "" {
		return BackupResult{}, ErrInvalid
	}
	root, err := workpackage.OpenDirectoryFD(privateDirectory)
	if err != nil {
		return BackupResult{}, err
	}
	defer unix.Close(root)
	spool, err := workpackage.OpenDirectoryFD(spoolDirectory)
	if err != nil {
		return BackupResult{}, err
	}
	defer unix.Close(spool)
	manifest, digest, err := backupManifest(spool)
	if err != nil {
		return BackupResult{}, err
	}
	var attributes unix.Stat_t
	if unix.Fstat(root, &attributes) != nil {
		return BackupResult{}, ErrInvalid
	}
	if digest != request.ExpectedManifestDigest || manifest.WorkID != request.WorkID || manifest.OperationID != request.OperationID || manifest.BackupKey != request.BackupKey ||
		manifest.RootDev != uint64(attributes.Dev) || manifest.RootIno != attributes.Ino || !manifest.MemoryCreated || len(manifest.Files) != len(files) {
		return BackupResult{}, ErrInvalid
	}
	if err := verifyBackupFiles(ctx, spool, manifest); err != nil {
		return BackupResult{}, err
	}
	marker, markerErr := Regular(spool, "history-restored.json")
	if markerErr == nil {
		raw, readErr := io.ReadAll(io.LimitReader(marker, 128))
		marker.Close()
		if readErr != nil || string(raw) != digest {
			return BackupResult{}, ErrInvalid
		}
		if err := verifyRestoredFiles(ctx, root, manifest); err != nil {
			return BackupResult{}, err
		}
		if err := verifyBackupMemory(root, manifest); err == nil {
			if err := unix.Unlinkat(root, "memory.sqlite", 0); err != nil {
				return BackupResult{}, err
			}
		} else if !os.IsNotExist(err) {
			return BackupResult{}, err
		}
		if unix.Fsync(root) != nil {
			return BackupResult{}, ErrInvalid
		}
		return BackupResult{4, digest, "restored"}, nil
	} else if !os.IsNotExist(markerErr) {
		return BackupResult{}, markerErr
	}
	memory, err := Regular(root, "memory.sqlite")
	if err != nil {
		return BackupResult{}, err
	}
	var stat unix.Stat_t
	err = unix.Fstat(int(memory.Fd()), &stat)
	memory.Close()
	if err != nil || manifest.MemoryDev != uint64(stat.Dev) || manifest.MemoryIno != stat.Ino {
		return BackupResult{}, ErrInvalid
	}
	// The restore helper mounts privateDirectory at the runtime's original /var/data path.
	// SQLite therefore sees original super-journal paths before any file replacement.
	db, err := database(filepath.Join(privateDirectory, "work.sqlite"), false)
	if err != nil {
		return BackupResult{}, err
	}
	if _, err = db.ExecContext(ctx, "ATTACH DATABASE ? AS memory", filepath.Join(privateDirectory, "memory.sqlite")); err == nil {
		var owner, store string
		err = db.QueryRowContext(ctx, "SELECT work_id,store_id FROM memory.memory_meta").Scan(&owner, &store)
		if err == nil && (owner != request.WorkID || store != request.BackupKey) {
			err = ErrInvalid
		}
	}
	closeErr := db.Close()
	if err != nil {
		return BackupResult{}, err
	}
	if closeErr != nil {
		return BackupResult{}, closeErr
	}
	for index, entry := range manifest.Files {
		if entry.Name != files[index] {
			return BackupResult{}, ErrInvalid
		}
		if !entry.Present {
			file, err := Regular(root, entry.Name)
			if os.IsNotExist(err) {
				continue
			}
			if err != nil {
				return BackupResult{}, err
			}
			file.Close()
			if unix.Unlinkat(root, entry.Name, 0) != nil {
				return BackupResult{}, ErrInvalid
			}
			continue
		}
		source, err := Regular(spool, "backup-"+entry.Name)
		if err != nil {
			return BackupResult{}, err
		}
		got, err := digestFile(ctx, source)
		if err != nil || got != entry.Digest {
			source.Close()
			return BackupResult{}, ErrInvalid
		}
		if _, err := source.Seek(0, io.SeekStart); err != nil {
			source.Close()
			return BackupResult{}, err
		}
		temp := "restore-" + request.BackupKey + "-" + uuid.NewString() + "-" + entry.Name
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
		original, err := Regular(root, entry.Name)
		if err == nil {
			original.Close()
		} else if !os.IsNotExist(err) {
			return BackupResult{}, err
		}
		if err := unix.Renameat(root, temp, root, entry.Name); err != nil {
			return BackupResult{}, err
		}
	}
	for _, name := range []string{"memory.sqlite-journal", "work.sqlite-journal"} {
		file, err := Regular(root, name)
		if err == nil {
			file.Close()
			return BackupResult{}, ErrBusy
		} else if !os.IsNotExist(err) {
			return BackupResult{}, err
		}
	}
	if err := verifyRestoredFiles(ctx, root, manifest); err != nil {
		return BackupResult{}, err
	}
	// Durable receipt precedes deletion so a lost helper result can safely resume.
	markerName := "history-restored-" + uuid.NewString() + ".tmp"
	defer unix.Unlinkat(spool, markerName, 0)
	markerFD, err := unix.Openat(spool, markerName, unix.O_WRONLY|unix.O_CREAT|unix.O_EXCL|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0600)
	if err != nil {
		return BackupResult{}, err
	}
	markerFile := os.NewFile(uintptr(markerFD), "history-restored.json")
	var spoolAttrs unix.Stat_t
	if unix.Fstat(spool, &spoolAttrs) != nil || unix.Fchown(markerFD, int(spoolAttrs.Uid), int(spoolAttrs.Gid)) != nil {
		markerFile.Close()
		return BackupResult{}, ErrInvalid
	}
	_, err = markerFile.WriteString(digest)
	if err == nil {
		err = markerFile.Sync()
	}
	closeErr = markerFile.Close()
	if err != nil || closeErr != nil {
		return BackupResult{}, ErrInvalid
	}
	if unix.Renameat(spool, markerName, spool, "history-restored.json") != nil || unix.Fsync(spool) != nil {
		return BackupResult{}, ErrInvalid
	}
	if err := unix.Unlinkat(root, "memory.sqlite", 0); err != nil {
		return BackupResult{}, err
	}
	if err := unix.Fsync(root); err != nil {
		return BackupResult{}, err
	}
	return BackupResult{4, digest, "restored"}, nil
}

func validateBackupMemorySchema(ctx context.Context, db *sql.DB) error {
	var expected []schemaObject
	if json.Unmarshal(memorySchemaObjects, &expected) != nil {
		return ErrInvalid
	}
	rows, err := db.QueryContext(ctx, "SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name")
	if err != nil {
		return err
	}
	defer rows.Close()
	var actual []schemaObject
	for rows.Next() {
		var item schemaObject
		if rows.Scan(&item.Type, &item.Name, &item.Table, &item.SQL) != nil {
			return ErrInvalid
		}
		actual = append(actual, item)
	}
	normalizeSchema(actual)
	normalizeSchema(expected)
	if !reflect.DeepEqual(actual, expected) {
		return ErrInvalid
	}
	return rows.Err()
}

func verifyRestoredFiles(ctx context.Context, root int, manifest BackupManifest) error {
	for _, entry := range manifest.Files {
		f, err := Regular(root, entry.Name)
		if !entry.Present {
			if os.IsNotExist(err) {
				continue
			}
			if f != nil {
				f.Close()
			}
			return ErrInvalid
		}
		if err != nil {
			return err
		}
		got, hashErr := digestFile(ctx, f)
		f.Close()
		if hashErr != nil || got != entry.Digest {
			return ErrInvalid
		}
	}
	return nil
}
