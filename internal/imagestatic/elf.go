package imagestatic

import (
	"encoding/binary"
	"io"
	"sort"
)

type elfPlatform struct {
	class, endian byte
	machine       uint16
}

var elfPlatforms = map[string]elfPlatform{
	"amd64": {2, 1, 62}, "386": {1, 1, 3}, "arm": {1, 1, 40}, "arm64": {2, 1, 183},
	"ppc64": {2, 2, 21}, "ppc64le": {2, 1, 21}, "mips": {1, 2, 8}, "mipsle": {1, 1, 8},
	"mips64": {2, 2, 8}, "mips64le": {2, 1, 8}, "riscv64": {2, 1, 243}, "s390x": {2, 2, 22}, "loong64": {2, 1, 258},
}

// inspectELF streams the header and program tables. Claimed section sizes never
// cause an allocation. ELF/platform checks do not establish producer language
// or provenance; release build information supplies that separate evidence.
func inspectELF(r io.Reader, size int64, architecture string) bool {
	want, ok := elfPlatforms[architecture]
	if !ok || size < 52 {
		return false
	}
	var h [64]byte
	if _, err := io.ReadFull(r, h[:16]); err != nil || string(h[:4]) != "\x7fELF" || h[4] != want.class || h[5] != want.endian || h[6] != 1 || (h[7] != 0 && h[7] != 3) {
		return false
	}
	headerSize := 52
	if want.class == 2 {
		headerSize = 64
	}
	if _, err := io.ReadFull(r, h[16:headerSize]); err != nil {
		return false
	}
	var order binary.ByteOrder = binary.LittleEndian
	if want.endian == 2 {
		order = binary.BigEndian
	}
	fileType := order.Uint16(h[16:18])
	if (fileType != 2 && fileType != 3) || order.Uint16(h[18:20]) != want.machine || order.Uint32(h[20:24]) != 1 {
		return false
	}
	var entry, phoff uint64
	var phsize, phnum, ehsize uint16
	if want.class == 2 {
		entry = order.Uint64(h[24:32])
		phoff = order.Uint64(h[32:40])
		ehsize = order.Uint16(h[52:54])
		phsize = order.Uint16(h[54:56])
		phnum = order.Uint16(h[56:58])
	} else {
		entry = uint64(order.Uint32(h[24:28]))
		phoff = uint64(order.Uint32(h[28:32]))
		ehsize = order.Uint16(h[40:42])
		phsize = order.Uint16(h[42:44])
		phnum = order.Uint16(h[44:46])
	}
	expectedPhSize := uint16(32)
	if want.class == 2 {
		expectedPhSize = 56
	}
	if ehsize != uint16(headerSize) || phsize != expectedPhSize || phnum == 0 || phnum == 65535 || phoff < uint64(headerSize) || phoff > uint64(size) || uint64(phsize)*uint64(phnum) > uint64(size)-phoff {
		return false
	}
	if _, err := io.CopyN(io.Discard, r, int64(phoff)-int64(headerSize)); err != nil {
		return false
	}
	type dynamicSegment struct{ offset, size uint64 }
	var dynamic []dynamicSegment
	executable := false
	var p [56]byte
	for i := uint16(0); i < phnum; i++ {
		if _, err := io.ReadFull(r, p[:phsize]); err != nil {
			return false
		}
		kind := order.Uint32(p[:4])
		var flags uint32
		var offset, vaddr, filesz, memsz uint64
		if want.class == 2 {
			flags = order.Uint32(p[4:8])
			offset = order.Uint64(p[8:16])
			vaddr = order.Uint64(p[16:24])
			filesz = order.Uint64(p[32:40])
			memsz = order.Uint64(p[40:48])
		} else {
			offset = uint64(order.Uint32(p[4:8]))
			vaddr = uint64(order.Uint32(p[8:12]))
			filesz = uint64(order.Uint32(p[16:20]))
			memsz = uint64(order.Uint32(p[20:24]))
			flags = order.Uint32(p[24:28])
		}
		if offset > uint64(size) || filesz > uint64(size)-offset || (kind == 1 && memsz < filesz) {
			return false
		}
		if kind == 3 {
			return false
		} // PT_INTERP requires an external ELF loader.
		if kind == 1 && flags&1 != 0 && filesz > 0 && entry >= vaddr && entry-vaddr < memsz {
			executable = true
		}
		if kind == 2 {
			dynamic = append(dynamic, dynamicSegment{offset, filesz})
		}
	}
	if !executable {
		return false
	}
	// A PIE may have a dynamic table without any dynamic library dependency.
	// Reject DT_NEEDED rather than treating PT_DYNAMIC alone as a dependency.
	sort.Slice(dynamic, func(i, j int) bool { return dynamic[i].offset < dynamic[j].offset })
	position := phoff + uint64(phsize)*uint64(phnum)
	entrySize := uint64(8)
	if want.class == 2 {
		entrySize = 16
	}
	var d [16]byte
	for _, segment := range dynamic {
		if segment.offset < position || segment.size%entrySize != 0 {
			return false
		}
		if _, err := io.CopyN(io.Discard, r, int64(segment.offset-position)); err != nil {
			return false
		}
		terminated := false
		for n := uint64(0); n < segment.size; n += entrySize {
			if _, err := io.ReadFull(r, d[:entrySize]); err != nil {
				return false
			}
			tag := uint64(order.Uint32(d[:4]))
			if want.class == 2 {
				tag = order.Uint64(d[:8])
			}
			if !terminated && tag == 1 {
				return false
			}
			if tag == 0 {
				terminated = true
			}
		}
		if !terminated {
			return false
		}
		position = segment.offset + segment.size
	}
	return true
}
