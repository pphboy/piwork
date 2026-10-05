package clientfs

import "math"

// FileIdentity describes one already opened native regular file. Comparing
// both object identity and metadata catches replacement and in-place changes.
type FileIdentity struct {
	Volume   uint64
	FileID   [16]byte
	Size     int64
	Modified int64
	Changed  int64
	Mode     uint32
	Links    uint32
	Sequence int64
	Content  [32]byte
}

func availableBytes(units, sectors, bytesPerSector uint64) (uint64, error) {
	if sectors == 0 || bytesPerSector == 0 || sectors > math.MaxUint64/bytesPerSector {
		return 0, ErrUnsafe
	}
	unitSize := sectors * bytesPerSector
	if units > math.MaxUint64/unitSize {
		return 0, ErrUnsafe
	}
	return units * unitSize, nil
}
