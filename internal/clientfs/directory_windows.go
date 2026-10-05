package clientfs

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
	"unicode/utf8"
	"unsafe"

	"golang.org/x/sys/windows"
)

type Directory struct {
	handle  windows.Handle
	private bool
	sid     *windows.SID
}

func currentSID() (*windows.SID, error) {
	token, err := windows.OpenCurrentProcessToken()
	if err != nil {
		return nil, err
	}
	defer token.Close()
	user, err := token.GetTokenUser()
	if err != nil {
		return nil, err
	}
	return user.User.Sid.Copy()
}

func privateDescriptor(sid *windows.SID, directory bool) (*windows.SECURITY_DESCRIPTOR, error) {
	inherit := ""
	if directory {
		inherit = "OICI"
	}
	return windows.SecurityDescriptorFromString("O:" + sid.String() + "D:P(A;" + inherit + ";FA;;;" + sid.String() + ")(A;" + inherit + ";FA;;;SY)")
}

func validWindowsName(name string) bool {
	if !validName(name) || strings.ContainsAny(name, ":*?\"<>|") || strings.HasSuffix(name, ".") || strings.HasSuffix(name, " ") {
		return false
	}
	for _, c := range name {
		if c < 0x20 {
			return false
		}
	}
	base := strings.ToUpper(strings.SplitN(name, ".", 2)[0])
	if base == "CON" || base == "PRN" || base == "AUX" || base == "NUL" || base == "CONIN$" || base == "CONOUT$" {
		return false
	}
	for _, prefix := range []string{"COM", "LPT"} {
		if suffix, ok := strings.CutPrefix(base, prefix); ok && len([]rune(suffix)) == 1 && strings.ContainsAny(suffix, "123456789¹²³") {
			return false
		}
	}
	return true
}

func ValidFileName(name string) bool { return validWindowsName(name) }

func nativeError(err error) error {
	var status windows.NTStatus
	if errors.As(err, &status) {
		switch status {
		case windows.STATUS_OBJECT_NAME_NOT_FOUND, windows.STATUS_OBJECT_PATH_NOT_FOUND:
			return os.ErrNotExist
		case windows.STATUS_OBJECT_NAME_COLLISION:
			return os.ErrExist
		case windows.STATUS_REPARSE_POINT_ENCOUNTERED, windows.STATUS_NOT_A_DIRECTORY, windows.STATUS_FILE_IS_A_DIRECTORY:
			return ErrUnsafe
		}
		return status.Errno()
	}
	return err
}

// A single relative component is passed to NtCreateFile beneath a pinned
// handle. OBJ_DONT_REPARSE and FILE_OPEN_REPARSE_POINT are both required;
// checking a pathname before a normal CreateFile would leave a race window.
func nativeOpen(parent windows.Handle, name string, directory, create, write bool, sid *windows.SID) (windows.Handle, error) {
	if parent != 0 && name == "." {
		name = ""
	}
	objectName, err := windows.NewNTUnicodeString(name)
	if err != nil {
		return 0, err
	}
	oa := windows.OBJECT_ATTRIBUTES{RootDirectory: parent, ObjectName: objectName, Attributes: windows.OBJ_CASE_INSENSITIVE}
	if parent != 0 {
		oa.Attributes |= windows.OBJ_DONT_REPARSE
	}
	oa.Length = uint32(unsafe.Sizeof(oa))
	if create && sid != nil {
		oa.SecurityDescriptor, err = privateDescriptor(sid, directory)
		if err != nil {
			return 0, err
		}
	}
	access := uint32(windows.FILE_GENERIC_READ)
	options := uint32(windows.FILE_SYNCHRONOUS_IO_NONALERT | windows.FILE_OPEN_REPARSE_POINT)
	attributes := uint32(windows.FILE_ATTRIBUTE_NORMAL)
	if directory {
		options |= windows.FILE_DIRECTORY_FILE
		attributes = windows.FILE_ATTRIBUTE_DIRECTORY
	} else {
		options |= windows.FILE_NON_DIRECTORY_FILE
	}
	if write {
		access |= windows.FILE_GENERIC_WRITE | windows.DELETE
		options |= windows.FILE_WRITE_THROUGH
	}
	disposition := uint32(windows.FILE_OPEN)
	if create {
		disposition = windows.FILE_CREATE
	}
	var h windows.Handle
	var iosb windows.IO_STATUS_BLOCK
	sharing := uint32(windows.FILE_SHARE_READ | windows.FILE_SHARE_WRITE | windows.FILE_SHARE_DELETE)
	// All input readers exclude concurrent writers: Windows timestamps can
	// remain unchanged while another handle modifies the stream. Sharing DELETE
	// still permits atomic replacement while old readers retain their stream.
	if !directory && !create && !write {
		sharing &^= windows.FILE_SHARE_WRITE
	}
	err = windows.NtCreateFile(&h, access, &oa, &iosb, nil, attributes, sharing, disposition, options, 0, 0)
	// A just-published private atomic writer briefly retains its write handle
	// for the final flush. Wait for that bounded window without allowing a
	// concurrent writer into the reader's validation lifetime.
	if !directory && !create && !write && sid != nil {
		deadline := time.Now().Add(time.Second)
		for errors.Is(nativeError(err), windows.ERROR_SHARING_VIOLATION) && time.Now().Before(deadline) {
			time.Sleep(2 * time.Millisecond)
			err = windows.NtCreateFile(&h, access, &oa, &iosb, nil, attributes, sharing, disposition, options, 0, 0)
		}
	}
	runtime.KeepAlive(oa.SecurityDescriptor)
	if err != nil {
		return 0, nativeError(err)
	}
	if err := checkNativeType(h, directory); err != nil {
		windows.CloseHandle(h)
		return 0, err
	}
	return h, nil
}

func checkNativeType(h windows.Handle, directory bool) error {
	kind, err := windows.GetFileType(h)
	if err != nil || kind != windows.FILE_TYPE_DISK {
		return ErrUnsafe
	}
	var info windows.ByHandleFileInformation
	if windows.GetFileInformationByHandle(h, &info) != nil || info.FileAttributes&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0 || (info.FileAttributes&windows.FILE_ATTRIBUTE_DIRECTORY != 0) != directory {
		return ErrUnsafe
	}
	return nil
}

func checkPrivateHandle(h windows.Handle, sid *windows.SID) error {
	var flags uint32
	if windows.GetVolumeInformationByHandle(h, nil, 0, nil, nil, &flags, nil, 0) != nil || flags&windows.FILE_PERSISTENT_ACLS == 0 {
		return ErrUnsafe
	}
	sd, err := windows.GetSecurityInfo(h, windows.SE_FILE_OBJECT, windows.OWNER_SECURITY_INFORMATION|windows.DACL_SECURITY_INFORMATION)
	if err != nil || !sd.IsValid() {
		return ErrUnsafe
	}
	owner, _, err := sd.Owner()
	if err != nil || owner == nil || !owner.Equals(sid) {
		return ErrUnsafe
	}
	control, _, err := sd.Control()
	if err != nil || control&windows.SE_DACL_PROTECTED == 0 || control&windows.SE_DACL_PRESENT == 0 {
		return ErrUnsafe
	}
	acl, _, err := sd.DACL()
	if err != nil || acl == nil || acl.AceCount == 0 {
		return ErrUnsafe
	}
	system, err := windows.CreateWellKnownSid(windows.WinLocalSystemSid)
	if err != nil {
		return ErrUnsafe
	}
	allowedUser := false
	for i := uint32(0); i < uint32(acl.AceCount); i++ {
		var ace *windows.ACCESS_ALLOWED_ACE
		if windows.GetAce(acl, i, &ace) != nil || ace == nil || ace.Header.AceType != windows.ACCESS_ALLOWED_ACE_TYPE || ace.Header.AceFlags&windows.INHERITED_ACE != 0 {
			return ErrUnsafe
		}
		entrySID := (*windows.SID)(unsafe.Pointer(&ace.SidStart))
		if !entrySID.IsValid() || !entrySID.Equals(sid) && !entrySID.Equals(system) {
			return ErrUnsafe
		}
		if entrySID.Equals(sid) && ace.Mask != 0 {
			allowedUser = true
		}
	}
	if !allowedUser {
		return ErrUnsafe
	}
	return nil
}

func openDirectory(input string, private, create bool) (*Directory, error) {
	if input == "" || !utf8.ValidString(input) || strings.ContainsRune(input, 0) || strings.HasPrefix(input, `\\?\`) || strings.HasPrefix(input, `\\.\`) || strings.HasPrefix(input, `\??\`) {
		return nil, ErrUnsafe
	}
	volume := filepath.VolumeName(input)
	if len(volume) == 2 && len(input) > 2 && input[2] != '\\' && input[2] != '/' {
		return nil, ErrUnsafe
	}
	name, err := filepath.Abs(input)
	if err != nil {
		return nil, err
	}
	volume = filepath.VolumeName(name)
	if volume == "" {
		return nil, ErrUnsafe
	}
	sid, err := currentSID()
	if err != nil {
		return nil, err
	}
	rootName := `\??\` + volume + `\`
	if strings.HasPrefix(volume, `\\`) {
		rootName = `\??\UNC\` + strings.TrimPrefix(volume, `\\`) + `\`
	}
	h, err := nativeOpen(0, rootName, true, false, false, nil)
	if err != nil {
		return nil, err
	}
	parts := strings.Split(strings.TrimPrefix(strings.TrimPrefix(name, volume), `\`), `\`)
	if len(parts) == 1 && parts[0] == "" {
		parts = nil
	}
	for _, part := range parts {
		if !validWindowsName(part) {
			windows.CloseHandle(h)
			return nil, ErrUnsafe
		}
		next, openErr := nativeOpen(h, part, true, false, false, nil)
		if create && errors.Is(openErr, os.ErrNotExist) {
			next, openErr = nativeOpen(h, part, true, true, false, sid)
			if errors.Is(openErr, os.ErrExist) {
				next, openErr = nativeOpen(h, part, true, false, false, nil)
			}
		}
		windows.CloseHandle(h)
		if openErr != nil {
			return nil, openErr
		}
		h = next
	}
	d := &Directory{handle: h, private: private, sid: sid}
	if err := d.Check(); err != nil {
		d.Close()
		return nil, err
	}
	return d, nil
}

func (d *Directory) Close() error {
	if d == nil || d.handle == 0 {
		return nil
	}
	h := d.handle
	d.handle = 0
	return windows.CloseHandle(h)
}

func (d *Directory) Check() error {
	if d == nil || d.handle == 0 || checkNativeType(d.handle, true) != nil {
		return ErrUnsafe
	}
	if d.private {
		return checkPrivateHandle(d.handle, d.sid)
	}
	return nil
}

// Windows commits flushed file data and native write-through mutations.
// There is no POSIX directory-fsync equivalent here; confirm the pinned
// parent after the native mutation, without claiming universal power-loss safety.
func (d *Directory) Sync() error { return d.Check() }

func (d *Directory) checkOpenFile(f *os.File) error {
	if f == nil {
		return ErrUnsafe
	}
	h := windows.Handle(f.Fd())
	if err := checkNativeType(h, false); err != nil {
		return err
	}
	if d.private {
		var info windows.ByHandleFileInformation
		if windows.GetFileInformationByHandle(h, &info) != nil || info.NumberOfLinks > 1 {
			return ErrUnsafe
		}
		return checkPrivateHandle(h, d.sid)
	}
	return nil
}

func (d *Directory) openFile(name string, create, write bool) (*os.File, error) {
	if !validWindowsName(name) || d.Check() != nil {
		return nil, ErrUnsafe
	}
	var sid *windows.SID
	if d.private {
		sid = d.sid
	}
	h, err := nativeOpen(d.handle, name, false, create, write, sid)
	if err != nil {
		return nil, err
	}
	f := os.NewFile(uintptr(h), name)
	if err := d.checkOpenFile(f); err != nil {
		f.Close()
		return nil, err
	}
	return f, nil
}

func (d *Directory) OpenRegular(name string) (*os.File, error) { return d.openFile(name, false, false) }
func (d *Directory) CreateExclusive(name string) (*os.File, error) {
	return d.openFile(name, true, true)
}
func (d *Directory) checkTarget(name string) error {
	f, err := d.OpenRegular(name)
	if err != nil {
		return err
	}
	return f.Close()
}

func (d *Directory) TryLock(name string) (*Lock, error) {
	if !d.private {
		return nil, ErrUnsafe
	}
	f, err := d.CreateExclusive(name)
	if errors.Is(err, os.ErrExist) {
		f, err = d.openFile(name, false, true)
	}
	if err != nil {
		return nil, err
	}
	var overlapped windows.Overlapped
	if err := windows.LockFileEx(windows.Handle(f.Fd()), windows.LOCKFILE_EXCLUSIVE_LOCK|windows.LOCKFILE_FAIL_IMMEDIATELY, 0, 1, 0, &overlapped); err != nil {
		f.Close()
		if errors.Is(err, windows.ERROR_LOCK_VIOLATION) {
			return nil, ErrBusy
		}
		return nil, err
	}
	return &Lock{file: f}, nil
}

type fileRenameInformation struct {
	Flags          uint32
	RootDirectory  windows.Handle
	FileNameLength uint32
	FileName       [1]uint16
}

func (d *Directory) rename(old, name string, replace bool) error {
	if !validWindowsName(old) || !validWindowsName(name) || d.Check() != nil {
		return ErrUnsafe
	}
	f, err := d.openFile(old, false, true)
	if err != nil {
		return err
	}
	defer f.Close()
	newName, err := windows.UTF16FromString(name)
	if err != nil {
		return err
	}
	var layout fileRenameInformation
	length := (len(newName) - 1) * 2
	buffer := make([]byte, int(unsafe.Offsetof(layout.FileName))+length)
	info := (*fileRenameInformation)(unsafe.Pointer(&buffer[0]))
	if replace {
		info.Flags = windows.FILE_RENAME_REPLACE_IF_EXISTS | windows.FILE_RENAME_POSIX_SEMANTICS
	}
	info.RootDirectory = d.handle
	info.FileNameLength = uint32(length)
	copy(unsafe.Slice(&info.FileName[0], len(newName)-1), newName[:len(newName)-1])
	var iosb windows.IO_STATUS_BLOCK
	// Extended rename is required for the documented POSIX replacement flag:
	// existing readers keep their old file while new opens see the replacement.
	const fileRenameInformationEx = 65
	if err := windows.NtSetInformationFile(windows.Handle(f.Fd()), &iosb, &buffer[0], uint32(len(buffer)), fileRenameInformationEx); err != nil {
		return nativeError(err)
	}
	if err := f.Sync(); err != nil {
		return errors.Join(ErrOutcomeUnknown, err)
	}
	return nil
}

func (d *Directory) Remove(name string) error {
	f, err := d.openFile(name, false, true)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	var iosb windows.IO_STATUS_BLOCK
	flags := uint32(3) // DELETE | POSIX_SEMANTICS; existing readers retain their handles.
	err = windows.NtSetInformationFile(windows.Handle(f.Fd()), &iosb, (*byte)(unsafe.Pointer(&flags)), 4, windows.FileDispositionInformationEx)
	closeErr := f.Close()
	if err != nil {
		return nativeError(err)
	}
	if err := errors.Join(closeErr, d.Sync()); err != nil {
		return errors.Join(ErrOutcomeUnknown, err)
	}
	return nil
}

func (d *Directory) removeTemporary(name string) { _ = d.Remove(name) }

func (d *Directory) Child(name string, create bool) (*Directory, error) {
	if !validWindowsName(name) || d.Check() != nil {
		return nil, ErrUnsafe
	}
	h, err := nativeOpen(d.handle, name, true, false, false, nil)
	if create && errors.Is(err, os.ErrNotExist) {
		h, err = nativeOpen(d.handle, name, true, true, false, d.sid)
		if errors.Is(err, os.ErrExist) {
			h, err = nativeOpen(d.handle, name, true, false, false, nil)
		}
	}
	if err != nil {
		return nil, err
	}
	child := &Directory{handle: h, private: d.private, sid: d.sid}
	if err := child.Check(); err != nil {
		child.Close()
		return nil, err
	}
	return child, nil
}

func (d *Directory) Entries() ([]os.DirEntry, error) {
	if err := d.Check(); err != nil {
		return nil, err
	}
	// Open a distinct directory handle so independent enumeration cursors do
	// not share position; the trusted dot stays relative to the pinned parent.
	h, err := nativeOpen(d.handle, ".", true, false, false, nil)
	if err != nil {
		return nil, err
	}
	f := os.NewFile(uintptr(h), "client directory")
	defer f.Close()
	return f.ReadDir(-1)
}
