//go:build linux

package filehelper

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"strconv"

	"golang.org/x/sys/unix"
	"piwork/internal/contracts"
	"piwork/internal/fileprotocol"
)

type conditionCheck func(*contracts.FileHelperMeta) error

func (work *Workspace) targetInfo(parent int, name string) (*unix.Stat_t, error) {
	var stat unix.Stat_t
	if err := unix.Fstatat(parent, name, &stat, unix.AT_SYMLINK_NOFOLLOW); err != nil {
		if errors.Is(err, unix.ENOENT) {
			return nil, nil
		}
		return nil, filesystemError(err)
	}
	kind := fileKind(stat.Mode)
	if kind == "directory" {
		return nil, pathError("FILE_METHOD_NOT_ALLOWED")
	}
	if kind != "file" {
		return nil, pathError("FILE_TYPE_UNSUPPORTED")
	}
	return &stat, nil
}
func checkStat(check conditionCheck, parts []string, stat *unix.Stat_t) error {
	if check == nil {
		return nil
	}
	if stat == nil {
		return check(nil)
	}
	meta, err := metadata(parts, *stat)
	if err != nil {
		return err
	}
	return check(&meta)
}
func randomNonce() (string, error) {
	var nonce [16]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		return "", pathError("FILE_RUNTIME_UNAVAILABLE")
	}
	return hex.EncodeToString(nonce[:]), nil
}
func (work *Workspace) removeOwnedTemporary(parent int, name string, identity *unix.Stat_t) error {
	if identity == nil {
		return nil
	}
	var current unix.Stat_t
	if err := unix.Fstatat(parent, name, &current, unix.AT_SYMLINK_NOFOLLOW); err != nil {
		if errors.Is(err, unix.ENOENT) {
			return nil
		}
		return filesystemError(err)
	}
	if current.Dev != identity.Dev || current.Ino != identity.Ino || fileKind(current.Mode) != "file" {
		return pathError("FILE_CLEANUP_REQUIRED")
	}
	if err := unix.Unlinkat(parent, name, 0); err != nil {
		return filesystemError(err)
	}
	return filesystemError(unix.Fsync(parent))
}

// All target changes follow the durable Core commit ACK. Staging uses an
// exclusive same-directory file and a separately acknowledged inode identity.
func (work *Workspace) publish(parts []string, session *fileprotocol.Session, stream func(func([]byte) error) (int64, error), mode *uint32, overwrite, commit bool, check conditionCheck, beforeCommit func() error) (status, count int64, returned error) {
	parent, err := work.openParent(parts, true)
	if err != nil {
		return 0, 0, err
	}
	defer unix.Close(parent)
	parents, name := parts[:len(parts)-1], parts[len(parts)-1]
	if err := work.verifyParent(parent, parents); err != nil {
		return 0, 0, err
	}
	original, err := work.targetInfo(parent, name)
	if err != nil {
		return 0, 0, err
	}
	if original != nil && !overwrite {
		return 0, 0, pathError("FILE_PRECONDITION_FAILED")
	}
	if err := checkStat(check, parts, original); err != nil {
		return 0, 0, err
	}
	permission := uint32(0644)
	if original != nil {
		permission = original.Mode & 0777
	}
	if mode != nil {
		permission = *mode & 0777
	}
	nonce, err := randomNonce()
	if err != nil {
		return 0, 0, err
	}
	temporaryID := "filetemp-" + nonce
	nonce, err = randomNonce()
	if err != nil {
		return 0, 0, err
	}
	temporaryName := ".piwork-file-" + session.JobID + "-" + nonce + ".tmp"
	if len(temporaryName) > 255 {
		return 0, 0, pathError("FILE_PATH_TOO_LONG")
	}
	if err := session.Prepare("temporary", &temporaryID, parents, &temporaryName, nil, nil); err != nil {
		return 0, 0, err
	}
	fd, err := unix.Openat(parent, temporaryName, unix.O_WRONLY|unix.O_CREAT|unix.O_EXCL|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0600)
	if err != nil {
		return 0, 0, filesystemError(err)
	}
	file := os.NewFile(uintptr(fd), "workspace-temporary")
	defer file.Close()
	var stat unix.Stat_t
	var identity *unix.Stat_t
	published := false
	defer func() {
		if !published {
			if err := work.removeOwnedTemporary(parent, temporaryName, identity); err != nil {
				returned = err
			}
		}
	}()
	if err := unix.Fstat(fd, &stat); err != nil {
		return 0, 0, filesystemError(err)
	}
	identity = &stat
	device, inode := strconv.FormatUint(uint64(stat.Dev), 10), strconv.FormatUint(stat.Ino, 10)
	if err := session.Prepare("temporary", &temporaryID, parents, &temporaryName, &device, &inode); err != nil {
		return 0, 0, err
	}
	count, err = stream(func(data []byte) error {
		for len(data) > 0 {
			n, err := file.Write(data)
			if err != nil {
				return filesystemError(err)
			}
			if n <= 0 {
				return pathError("FILE_STORAGE_FULL")
			}
			data = data[n:]
		}
		return nil
	})
	if err != nil {
		return 0, count, err
	}
	if count > fileprotocol.MaxFile {
		return 0, count, pathError("FILE_LIMIT_EXCEEDED")
	}
	if err := file.Chmod(os.FileMode(permission)); err != nil {
		return 0, count, filesystemError(err)
	}
	if err := file.Sync(); err != nil {
		return 0, count, filesystemError(err)
	}
	if err := file.Close(); err != nil {
		return 0, count, filesystemError(err)
	}
	recheck := func() (*unix.Stat_t, error) {
		if err := work.verifyParent(parent, parents); err != nil {
			return nil, err
		}
		current, err := work.targetInfo(parent, name)
		if err != nil {
			return nil, err
		}
		if (original == nil) != (current == nil) {
			return nil, pathError("FILE_CONFLICT")
		}
		if err := checkStat(check, parts, current); err != nil {
			return nil, err
		}
		if beforeCommit != nil {
			if err := beforeCommit(); err != nil {
				return nil, err
			}
		}
		return current, nil
	}
	if _, err := recheck(); err != nil {
		return 0, count, err
	}
	if commit {
		if err := session.Prepare("commit", nil, nil, nil, nil, nil); err != nil {
			return 0, count, err
		}
	} else if !session.CommitGranted {
		return 0, count, pathError("FILE_BACKEND_PROTOCOL_ERROR")
	}
	current, err := recheck()
	if err != nil {
		return 0, count, err
	}
	var existing unix.Stat_t
	if err := unix.Fstatat(parent, temporaryName, &existing, unix.AT_SYMLINK_NOFOLLOW); err != nil {
		return 0, count, filesystemError(err)
	}
	if existing.Dev != identity.Dev || existing.Ino != identity.Ino || fileKind(existing.Mode) != "file" {
		return 0, count, pathError("FILE_CLEANUP_REQUIRED")
	}
	if current == nil {
		err = unix.Renameat2(parent, temporaryName, parent, name, unix.RENAME_NOREPLACE)
	} else {
		err = unix.Renameat(parent, temporaryName, parent, name)
	}
	if err != nil {
		return 0, count, filesystemError(err)
	}
	published = true
	if err := unix.Fsync(parent); err != nil {
		return 0, count, filesystemError(err)
	}
	status = 201
	if original != nil {
		status = 204
	}
	return status, count, nil
}
func (work *Workspace) Put(parts []string, session *fileprotocol.Session, check conditionCheck) (int64, int64, error) {
	return work.publish(parts, session, session.Upload, nil, true, true, check, nil)
}
func (work *Workspace) mkdir(parts []string) error {
	parent, err := work.openParent(parts, true)
	if err != nil {
		return err
	}
	defer unix.Close(parent)
	if err := work.verifyParent(parent, parts[:len(parts)-1]); err != nil {
		return err
	}
	if err := unix.Mkdirat(parent, parts[len(parts)-1], 0755); err != nil {
		if errors.Is(err, unix.EEXIST) {
			return pathError("FILE_METHOD_NOT_ALLOWED")
		}
		return filesystemError(err)
	}
	return filesystemError(unix.Fsync(parent))
}
func (work *Workspace) Mkcol(parts []string, session *fileprotocol.Session, check conditionCheck) (int64, error) {
	if len(parts) == 0 {
		return 0, pathError("FILE_ROOT_PROTECTED")
	}
	parent, err := work.openParent(parts, true)
	if err != nil {
		return 0, err
	}
	err = work.verifyParent(parent, parts[:len(parts)-1])
	var stat unix.Stat_t
	if err == nil {
		err = unix.Fstatat(parent, parts[len(parts)-1], &stat, unix.AT_SYMLINK_NOFOLLOW)
		if err == nil {
			err = pathError("FILE_METHOD_NOT_ALLOWED")
		} else if errors.Is(err, unix.ENOENT) {
			err = nil
		} else {
			err = filesystemError(err)
		}
	}
	unix.Close(parent)
	if err != nil {
		return 0, err
	}
	if check != nil {
		if err := check(nil); err != nil {
			return 0, err
		}
	}
	if err := session.Prepare("commit", nil, nil, nil, nil, nil); err != nil {
		return 0, err
	}
	if check != nil {
		current, err := work.StatOptional(parts)
		if err != nil {
			return 0, err
		}
		if err := check(current); err != nil {
			return 0, err
		}
	}
	if err := work.mkdir(parts); err != nil {
		return 0, err
	}
	return 201, nil
}
func (work *Workspace) preflight(parts []string) (int64, int64, error) {
	var entries, size int64
	var walk func([]string) error
	walk = func(parts []string) error {
		item, err := work.Stat(parts)
		if err != nil {
			return err
		}
		if item.Kind != "file" && item.Kind != "directory" {
			return pathError("FILE_TYPE_UNSUPPORTED")
		}
		entries++
		if entries > MaxEntries {
			return pathError("FILE_LIMIT_EXCEEDED")
		}
		if item.Kind == "file" {
			var own int64
			if json.Unmarshal(item.Size, &own) != nil {
				return pathError("FILE_RUNTIME_UNAVAILABLE")
			}
			size += own
			if size > fileprotocol.MaxFile {
				return pathError("FILE_LIMIT_EXCEEDED")
			}
			return nil
		}
		children, err := work.List(parts)
		if err != nil {
			return err
		}
		for _, child := range children {
			if err := walk(child.PathSegments); err != nil {
				return err
			}
		}
		return nil
	}
	err := walk(parts)
	return entries, size, err
}

type TreeFailure struct {
	Code         string
	PathSegments []string
}

func treeFailure(parts []string, err error) TreeFailure {
	return TreeFailure{Code: fileprotocol.Code(err), PathSegments: append([]string{}, parts...)}
}

type treeBudget struct {
	entries   int64
	exhausted bool
}

func (budget *treeBudget) enter(parts []string, failures *[]TreeFailure) bool {
	if budget.exhausted {
		return false
	}
	if budget.entries >= MaxEntries {
		budget.exhausted = true
		*failures = append(*failures, treeFailure(parts, pathError("FILE_LIMIT_EXCEEDED")))
		return false
	}
	budget.entries++
	return true
}
func (work *Workspace) deleteRecursive(parts []string, failures *[]TreeFailure, budget *treeBudget) {
	if !budget.enter(parts, failures) {
		return
	}
	item, err := work.Stat(parts)
	if err != nil {
		*failures = append(*failures, treeFailure(parts, err))
		return
	}
	if item.Kind != "file" && item.Kind != "directory" {
		*failures = append(*failures, treeFailure(parts, pathError("FILE_TYPE_UNSUPPORTED")))
		return
	}
	if item.Kind == "directory" {
		children, err := work.List(parts)
		if err != nil {
			*failures = append(*failures, treeFailure(parts, err))
			return
		}
		before := len(*failures)
		for _, child := range children {
			work.deleteRecursive(child.PathSegments, failures, budget)
			if budget.exhausted {
				break
			}
		}
		if len(*failures) != before {
			return
		}
	}
	parent, err := work.openParent(parts, false)
	if err != nil {
		*failures = append(*failures, treeFailure(parts, err))
		return
	}
	defer unix.Close(parent)
	if err := work.verifyParent(parent, parts[:len(parts)-1]); err != nil {
		*failures = append(*failures, treeFailure(parts, err))
		return
	}
	flags := 0
	if item.Kind == "directory" {
		flags = unix.AT_REMOVEDIR
	}
	if err := unix.Unlinkat(parent, parts[len(parts)-1], flags); err != nil {
		*failures = append(*failures, treeFailure(parts, filesystemError(err)))
		return
	}
	if err := unix.Fsync(parent); err != nil {
		*failures = append(*failures, treeFailure(parts, filesystemError(err)))
	}
}
func (work *Workspace) Delete(parts []string, session *fileprotocol.Session, check conditionCheck) (int64, []TreeFailure, error) {
	if len(parts) == 0 {
		return 0, nil, pathError("FILE_ROOT_PROTECTED")
	}
	if _, _, err := work.preflight(parts); err != nil {
		return 0, nil, err
	}
	if check != nil {
		item, err := work.StatOptional(parts)
		if err != nil {
			return 0, nil, err
		}
		if err := check(item); err != nil {
			return 0, nil, err
		}
	}
	if err := session.Prepare("commit", nil, nil, nil, nil, nil); err != nil {
		return 0, nil, err
	}
	if check != nil {
		item, err := work.StatOptional(parts)
		if err != nil {
			return 0, nil, err
		}
		if err := check(item); err != nil {
			return 0, nil, err
		}
	}
	failures := []TreeFailure{}
	work.deleteRecursive(parts, &failures, &treeBudget{})
	status := int64(204)
	if len(failures) > 0 {
		status = 207
	}
	return status, failures, nil
}
func prefix(left, right []string) bool {
	if len(left) > len(right) {
		return false
	}
	for i, part := range left {
		if right[i] != part {
			return false
		}
	}
	return true
}
func destinationRelation(source, destination []string) error {
	if err := ValidateSegments(source); err != nil {
		return err
	}
	if err := ValidateSegments(destination); err != nil {
		return err
	}
	if len(source) == 0 || len(destination) == 0 {
		return pathError("FILE_ROOT_PROTECTED")
	}
	if prefix(source, destination) || prefix(destination, source) {
		return pathError("FILE_CONFLICT")
	}
	return nil
}
func (work *Workspace) existingDestination(parts []string, overwrite bool) (*contracts.FileHelperMeta, error) {
	existing, err := work.StatOptional(parts)
	if err != nil || existing == nil {
		return existing, err
	}
	if existing.Kind != "file" && existing.Kind != "directory" {
		return nil, pathError("FILE_TYPE_UNSUPPORTED")
	}
	if !overwrite {
		return nil, pathError("FILE_PRECONDITION_FAILED")
	}
	if _, _, err := work.preflight(parts); err != nil {
		return nil, err
	}
	return existing, nil
}
func (work *Workspace) copyFile(source, destination []string, session *fileprotocol.Session, overwrite, commit bool, check conditionCheck, total *int64) (int64, error) {
	parent, err := work.openParent(source, false)
	if err != nil {
		return 0, err
	}
	original, err := work.targetInfo(parent, source[len(source)-1])
	unix.Close(parent)
	if err != nil {
		return 0, err
	}
	if original == nil {
		return 0, pathError("FILE_NOT_FOUND")
	}
	sourceMode := original.Mode & 0777
	beforeCommit := func() error {
		if check == nil {
			return nil
		}
		info, err := work.StatOptional(source)
		if err != nil {
			return err
		}
		return check(info)
	}
	stream := func(consume func([]byte) error) (int64, error) {
		return work.Read(source, 0, nil, func(data []byte) error {
			if total != nil {
				*total += int64(len(data))
				if *total > fileprotocol.MaxFile {
					return pathError("FILE_LIMIT_EXCEEDED")
				}
			}
			return consume(data)
		})
	}
	status, _, err := work.publish(destination, session, stream, &sourceMode, overwrite, commit, nil, beforeCommit)
	return status, err
}
func (work *Workspace) copyRecursive(source, destination []string, session *fileprotocol.Session, shallow bool, failures *[]TreeFailure, total *int64, budget *treeBudget) {
	if !budget.enter(destination, failures) {
		return
	}
	item, err := work.Stat(source)
	if err == nil {
		switch item.Kind {
		case "file":
			_, err = work.copyFile(source, destination, session, true, false, nil, total)
		case "directory":
			err = work.mkdir(destination)
			if err == nil && !shallow {
				var children []contracts.FileHelperMeta
				children, err = work.List(source)
				if err == nil {
					for _, child := range children {
						target := append(append([]string{}, destination...), child.PathSegments[len(child.PathSegments)-1])
						work.copyRecursive(child.PathSegments, target, session, shallow, failures, total, budget)
						if budget.exhausted {
							break
						}
					}
				}
			}
		default:
			err = pathError("FILE_TYPE_UNSUPPORTED")
		}
	}
	if err != nil {
		*failures = append(*failures, treeFailure(destination, err))
	}
}
func (work *Workspace) Copy(source, destination []string, session *fileprotocol.Session, overwrite, shallow bool, check conditionCheck) (int64, []TreeFailure, error) {
	if err := destinationRelation(source, destination); err != nil {
		return 0, nil, err
	}
	sourceInfo, err := work.Stat(source)
	if err != nil {
		return 0, nil, err
	}
	if check != nil {
		if err := check(&sourceInfo); err != nil {
			return 0, nil, err
		}
	}
	if _, _, err := work.preflight(source); err != nil {
		return 0, nil, err
	}
	existing, err := work.existingDestination(destination, overwrite)
	if err != nil {
		return 0, nil, err
	}
	parent, err := work.openParent(destination, true)
	if err != nil {
		return 0, nil, err
	}
	unix.Close(parent)
	if sourceInfo.Kind == "file" {
		var count int64
		status, err := work.copyFile(source, destination, session, overwrite, true, check, &count)
		return status, []TreeFailure{}, err
	}
	if err := session.Prepare("commit", nil, nil, nil, nil, nil); err != nil {
		return 0, nil, err
	}
	if check != nil {
		info, err := work.StatOptional(source)
		if err != nil {
			return 0, nil, err
		}
		if err := check(info); err != nil {
			return 0, nil, err
		}
	}
	failures := []TreeFailure{}
	if existing != nil {
		work.deleteRecursive(destination, &failures, &treeBudget{})
		if len(failures) > 0 {
			return 207, failures, nil
		}
	}
	var count int64
	work.copyRecursive(source, destination, session, shallow, &failures, &count, &treeBudget{})
	if len(failures) > 0 {
		return 207, failures, nil
	}
	status := int64(201)
	if existing != nil {
		status = 204
	}
	return status, failures, nil
}
func (work *Workspace) Move(source, destination []string, session *fileprotocol.Session, overwrite bool, check conditionCheck) (int64, []TreeFailure, error) {
	if err := destinationRelation(source, destination); err != nil {
		return 0, nil, err
	}
	if _, _, err := work.preflight(source); err != nil {
		return 0, nil, err
	}
	if check != nil {
		info, err := work.StatOptional(source)
		if err != nil {
			return 0, nil, err
		}
		if err := check(info); err != nil {
			return 0, nil, err
		}
	}
	existing, err := work.existingDestination(destination, overwrite)
	if err != nil {
		return 0, nil, err
	}
	parent, err := work.openParent(destination, true)
	if err != nil {
		return 0, nil, err
	}
	unix.Close(parent)
	if err := session.Prepare("commit", nil, nil, nil, nil, nil); err != nil {
		return 0, nil, err
	}
	if check != nil {
		info, err := work.StatOptional(source)
		if err != nil {
			return 0, nil, err
		}
		if err := check(info); err != nil {
			return 0, nil, err
		}
	}
	failures := []TreeFailure{}
	removed := false
	if existing != nil {
		work.deleteRecursive(destination, &failures, &treeBudget{})
		if len(failures) > 0 {
			return 207, failures, nil
		}
		removed = true
	}
	effect := func() error {
		from, err := work.openParent(source, false)
		if err != nil {
			return err
		}
		defer unix.Close(from)
		to, err := work.openParent(destination, true)
		if err != nil {
			return err
		}
		defer unix.Close(to)
		if err := work.verifyParent(from, source[:len(source)-1]); err != nil {
			return err
		}
		if err := work.verifyParent(to, destination[:len(destination)-1]); err != nil {
			return err
		}
		var current unix.Stat_t
		if err := unix.Fstatat(from, source[len(source)-1], &current, unix.AT_SYMLINK_NOFOLLOW); err != nil {
			return filesystemError(err)
		}
		if kind := fileKind(current.Mode); kind != "file" && kind != "directory" {
			return pathError("FILE_TYPE_UNSUPPORTED")
		}
		if overwrite {
			err = unix.Renameat(from, source[len(source)-1], to, destination[len(destination)-1])
		} else {
			err = unix.Renameat2(from, source[len(source)-1], to, destination[len(destination)-1], unix.RENAME_NOREPLACE)
		}
		if err != nil {
			return filesystemError(err)
		}
		if err := unix.Fsync(from); err != nil {
			return filesystemError(err)
		}
		return filesystemError(unix.Fsync(to))
	}
	if err := effect(); err != nil {
		if removed {
			return 207, []TreeFailure{treeFailure(destination, err)}, nil
		}
		return 0, nil, err
	}
	status := int64(201)
	if existing != nil {
		status = 204
	}
	return status, failures, nil
}
func (work *Workspace) Cleanup(request contracts.FileHelperRequest) (int64, error) {
	var count int64
	for _, item := range request.Temporaries.Value {
		parts := append(append([]string{}, item.ParentSegments...), item.Name)
		if err := ValidateSegments(parts); err != nil {
			return count, err
		}
		parent, err := work.openDirectory(item.ParentSegments)
		if err != nil {
			return count, err
		}
		err = func() error {
			defer unix.Close(parent)
			if err := work.verifyParent(parent, item.ParentSegments); err != nil {
				return err
			}
			var current unix.Stat_t
			if err := unix.Fstatat(parent, item.Name, &current, unix.AT_SYMLINK_NOFOLLOW); err != nil {
				if errors.Is(err, unix.ENOENT) {
					return nil
				}
				return filesystemError(err)
			}
			if strconv.FormatUint(uint64(current.Dev), 10) != item.Device || strconv.FormatUint(current.Ino, 10) != item.Inode || fileKind(current.Mode) != "file" {
				return pathError("FILE_CLEANUP_REQUIRED")
			}
			if err := unix.Unlinkat(parent, item.Name, 0); err != nil {
				return filesystemError(err)
			}
			if err := unix.Fsync(parent); err != nil {
				return filesystemError(err)
			}
			count++
			return nil
		}()
		if err != nil {
			return count, err
		}
	}
	return count, nil
}
