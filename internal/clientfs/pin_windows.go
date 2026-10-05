package clientfs

import (
	"errors"
	"os"
	"unsafe"

	"golang.org/x/sys/windows"
)

func duplicateHandle(f *os.File) (windows.Handle, error) {
	if f == nil {
		return 0, ErrUnsafe
	}
	var handle windows.Handle
	p := windows.CurrentProcess()
	if err := windows.DuplicateHandle(p, windows.Handle(f.Fd()), p, &handle, 0, false, windows.DUPLICATE_SAME_ACCESS); err != nil {
		return 0, err
	}
	return handle, nil
}

func (d *Directory) createPrivateChild(name string) (*Directory, error) {
	if !validWindowsName(name) || d.Check() != nil {
		return nil, ErrUnsafe
	}
	h, err := nativeOpen(d.handle, name, true, true, false, d.sid)
	if err != nil {
		return nil, err
	}
	child := &Directory{handle: h, private: true, sid: d.sid}
	if err := child.Check(); err != nil {
		child.Close()
		return nil, err
	}
	return child, nil
}

func (d *Directory) removeChildDirectory(name string, child *Directory) error {
	if !validWindowsName(name) || d.Check() != nil || child.Check() != nil {
		return ErrUnsafe
	}
	h, err := nativeOpen(d.handle, name, true, false, true, nil)
	if err != nil {
		return err
	}
	f := os.NewFile(uintptr(h), "client-directory")
	if !child.SameDirectory(f) {
		f.Close()
		return ErrUnsafe
	}
	var iosb windows.IO_STATUS_BLOCK
	flags := uint32(3) // DELETE | POSIX_SEMANTICS: unlink when this handle closes.
	err = windows.NtSetInformationFile(h, &iosb, (*byte)(unsafe.Pointer(&flags)), 4, windows.FileDispositionInformationEx)
	closeErr := f.Close()
	if err != nil {
		return nativeError(err)
	}
	if err := errors.Join(closeErr, d.Sync()); err != nil {
		return errors.Join(ErrOutcomeUnknown, err)
	}
	return nil
}

// PinDirectory duplicates an already opened directory; it never reopens its
// pathname. The caller retains ownership of the input file.
func PinDirectory(f *os.File, private bool) (*Directory, error) {
	h, err := duplicateHandle(f)
	if err != nil {
		return nil, err
	}
	sid, err := currentSID()
	if err != nil {
		windows.CloseHandle(h)
		return nil, err
	}
	d := &Directory{handle: h, private: private, sid: sid}
	if err := d.Check(); err != nil {
		d.Close()
		return nil, err
	}
	return d, nil
}

func (d *Directory) SameDirectory(f *os.File) bool {
	if f == nil || d.Check() != nil || checkNativeType(windows.Handle(f.Fd()), true) != nil {
		return false
	}
	var a, b fileIDInformation
	return windows.GetFileInformationByHandleEx(d.handle, 18, (*byte)(unsafe.Pointer(&a)), uint32(unsafe.Sizeof(a))) == nil &&
		windows.GetFileInformationByHandleEx(windows.Handle(f.Fd()), 18, (*byte)(unsafe.Pointer(&b)), uint32(unsafe.Sizeof(b))) == nil && a == b
}

func DuplicateFile(f *os.File) (*os.File, error) {
	if _, err := Identity(f); err != nil {
		return nil, err
	}
	h, err := duplicateHandle(f)
	if err != nil {
		return nil, err
	}
	return os.NewFile(uintptr(h), "client-file"), nil
}

func (d *Directory) CreatePrivateExclusive(name string) (*os.File, error) {
	if !validWindowsName(name) || d.Check() != nil {
		return nil, ErrUnsafe
	}
	h, err := nativeOpen(d.handle, name, false, true, true, d.sid)
	if err != nil {
		return nil, err
	}
	f := os.NewFile(uintptr(h), name)
	if err := checkPrivateHandle(h, d.sid); err != nil {
		f.Close()
		return nil, err
	}
	return f, nil
}

func (d *Directory) OpenDirectoryFile() (*os.File, error) {
	if err := d.Check(); err != nil {
		return nil, err
	}
	h, err := nativeOpen(d.handle, ".", true, false, false, nil)
	if err != nil {
		return nil, err
	}
	return os.NewFile(uintptr(h), "client-directory"), nil
}
