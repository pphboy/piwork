package clientfs

import (
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"io"
	"math"
	"os"
	"unsafe"

	"golang.org/x/sys/windows"
)

type fileIDInformation struct {
	Volume uint64
	FileID [16]byte
}
type fileBasicInformation struct {
	Created, Accessed, Written, Changed int64
	Attributes                          uint32
	_                                   uint32
}

func Identity(f *os.File) (FileIdentity, error) {
	var result FileIdentity
	if f == nil {
		return result, ErrUnsafe
	}
	h := windows.Handle(f.Fd())
	if err := checkNativeType(h, false); err != nil {
		return result, err
	}
	var id fileIDInformation
	if windows.GetFileInformationByHandleEx(h, 18, (*byte)(unsafe.Pointer(&id)), uint32(unsafe.Sizeof(id))) != nil {
		return result, ErrUnsafe
	}
	var basic fileBasicInformation
	if windows.GetFileInformationByHandleEx(h, 0, (*byte)(unsafe.Pointer(&basic)), uint32(unsafe.Sizeof(basic))) != nil {
		return result, ErrUnsafe
	}
	var st windows.ByHandleFileInformation
	if windows.GetFileInformationByHandle(h, &st) != nil {
		return result, ErrUnsafe
	}
	size := uint64(st.FileSizeHigh)<<32 | uint64(st.FileSizeLow)
	if size > math.MaxInt64 {
		return result, ErrUnsafe
	}
	result.Volume, result.FileID, result.Size = id.Volume, id.FileID, int64(size)
	result.Modified, result.Changed, result.Mode, result.Links = basic.Written, basic.Changed, basic.Attributes, st.NumberOfLinks
	// NTFS timestamps may coalesce even across closed writers. Use the native
	// change sequence where the filesystem provides one. Other filesystems use
	// a content digest, so UNC/non-journal inputs are not silently trusted or
	// excluded. SectionReader preserves the caller's stream position.
	result.Sequence = fileChangeSequence(h)
	if result.Sequence == 0 {
		hash := sha256.New()
		if n, err := io.Copy(hash, io.NewSectionReader(f, 0, result.Size)); err != nil || n != result.Size {
			return FileIdentity{}, ErrUnsafe
		}
		copy(result.Content[:], hash.Sum(nil))
	}
	return result, nil
}

func fileChangeSequence(h windows.Handle) int64 {
	versions := [2]uint16{2, 3}
	var raw [512]byte
	var returned uint32
	if windows.DeviceIoControl(h, windows.FSCTL_READ_FILE_USN_DATA, (*byte)(unsafe.Pointer(&versions[0])), 4, &raw[0], uint32(len(raw)), &returned, nil) != nil || returned < 8 || returned > uint32(len(raw)) {
		return 0
	}
	length := binary.LittleEndian.Uint32(raw[:4])
	if length > returned {
		return 0
	}
	offset := 24
	switch binary.LittleEndian.Uint16(raw[4:6]) {
	case 2:
	case 3:
		offset = 40
	default:
		return 0
	}
	if length < uint32(offset+8) {
		return 0
	}
	sequence := int64(binary.LittleEndian.Uint64(raw[offset : offset+8]))
	if sequence <= 0 {
		return 0
	}
	return sequence
}

type fileFsFullSizeInformation struct {
	Total, CallerAvailable, ActualAvailable int64
	SectorsPerUnit, BytesPerSector          uint32
}

var ntQueryVolumeInformationFile = windows.NewLazySystemDLL("ntdll.dll").NewProc("NtQueryVolumeInformationFile")

func (d *Directory) FreeBytes() (uint64, error) {
	if err := d.Check(); err != nil {
		return 0, err
	}
	var st fileFsFullSizeInformation
	var iosb windows.IO_STATUS_BLOCK
	const fileFsFullSizeInformationClass = 7
	status, _, _ := ntQueryVolumeInformationFile.Call(uintptr(d.handle), uintptr(unsafe.Pointer(&iosb)), uintptr(unsafe.Pointer(&st)), unsafe.Sizeof(st), fileFsFullSizeInformationClass)
	if status != 0 {
		return 0, windows.NTStatus(uint32(status)).Errno()
	}
	if iosb.Information < unsafe.Sizeof(st) || st.CallerAvailable < 0 {
		return 0, ErrUnsafe
	}
	return availableBytes(uint64(st.CallerAvailable), uint64(st.SectorsPerUnit), uint64(st.BytesPerSector))
}

func ProcessAlive(pid int) (bool, error) {
	if pid <= 0 || uint64(pid) > math.MaxUint32 {
		return true, ErrUnsafe
	}
	h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION|windows.SYNCHRONIZE, false, uint32(pid))
	if errors.Is(err, windows.ERROR_INVALID_PARAMETER) {
		return false, nil
	}
	if err != nil {
		return true, err
	}
	defer windows.CloseHandle(h)
	state, err := windows.WaitForSingleObject(h, 0)
	if err != nil {
		return true, err
	}
	if state == windows.WAIT_OBJECT_0 {
		return false, nil
	}
	if state == uint32(windows.WAIT_TIMEOUT) {
		return true, nil
	}
	return true, ErrUnsafe
}
