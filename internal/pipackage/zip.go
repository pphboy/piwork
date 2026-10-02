package pipackage

import (
	"archive/zip"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"golang.org/x/sys/unix"
	"piwork/internal/contracts"
)

type ZipEntry struct {
	Original, Path, Type string
	Size                 int64
	Mode                 uint32
	file                 *zip.File
}
type Archive struct {
	file          *os.File
	Entries       []ZipEntry
	Prefix        string
	RestoredBytes int64
}

func (a *Archive) Close() error { return a.file.Close() }

// Scan the central directory before archive/zip allocates its file table.
// Checking only the advertised EOCD count is insufficient: ZIP may truncate
// that count to 16 bits. Actual records are capped before parsing any content.
func checkDirectory(ctx context.Context, file *os.File, size int64) error {
	if size < 22 {
		return ErrUnsafe
	}
	tailSize := int64(65557)
	if size < tailSize {
		tailSize = size
	}
	tail := make([]byte, tailSize)
	if _, err := file.ReadAt(tail, size-tailSize); err != nil {
		return ErrUnsafe
	}
	eocd := -1
	for i := len(tail) - 22; i >= 0; i-- {
		if binary.LittleEndian.Uint32(tail[i:]) == 0x06054b50 && i+22+int(binary.LittleEndian.Uint16(tail[i+20:])) == len(tail) {
			eocd = i
			break
		}
	}
	if eocd < 0 {
		return ErrUnsafe
	}
	record := tail[eocd:]
	end := size - tailSize + int64(eocd)
	if binary.LittleEndian.Uint16(record[4:]) != 0 || binary.LittleEndian.Uint16(record[6:]) != 0 {
		return ErrUnsafe
	}
	count := uint64(binary.LittleEndian.Uint16(record[10:]))
	directorySize := uint64(binary.LittleEndian.Uint32(record[12:]))
	offset := uint64(binary.LittleEndian.Uint32(record[16:]))
	if count == 65535 || directorySize == 0xffffffff || offset == 0xffffffff {
		var locator [20]byte
		if end < 20 {
			return ErrUnsafe
		}
		if _, err := file.ReadAt(locator[:], end-20); err != nil || binary.LittleEndian.Uint32(locator[:]) != 0x07064b50 || binary.LittleEndian.Uint32(locator[4:]) != 0 || binary.LittleEndian.Uint32(locator[16:]) != 1 {
			return ErrUnsafe
		}
		zip64Offset := binary.LittleEndian.Uint64(locator[8:])
		if zip64Offset > uint64(end-20) || zip64Offset > uint64(size-56) {
			return ErrUnsafe
		}
		var extended [56]byte
		if _, err := file.ReadAt(extended[:], int64(zip64Offset)); err != nil || binary.LittleEndian.Uint32(extended[:]) != 0x06064b50 || binary.LittleEndian.Uint32(extended[16:]) != 0 || binary.LittleEndian.Uint32(extended[20:]) != 0 {
			return ErrUnsafe
		}
		count = binary.LittleEndian.Uint64(extended[32:])
		directorySize = binary.LittleEndian.Uint64(extended[40:])
		offset = binary.LittleEndian.Uint64(extended[48:])
		end = int64(zip64Offset)
	}
	if count > MaxEntries {
		return ErrLimit
	}
	if directorySize > uint64(end) || offset > uint64(size) {
		return ErrUnsafe
	}
	start := int64(offset)
	var magic [4]byte
	_, err := file.ReadAt(magic[:], start)
	if err != nil || binary.LittleEndian.Uint32(magic[:]) != 0x02014b50 {
		start = end - int64(directorySize)
	}
	if start < 0 || int64(directorySize) > size-start {
		return ErrUnsafe
	}
	limit := start + int64(directorySize)
	actual := uint64(0)
	for cursor := start; cursor < limit; {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		var header [46]byte
		if _, err := file.ReadAt(header[:], cursor); err != nil {
			return ErrUnsafe
		}
		if binary.LittleEndian.Uint32(header[:]) != 0x02014b50 {
			break
		}
		actual++
		if actual > MaxEntries {
			return ErrLimit
		}
		length := int64(46) + int64(binary.LittleEndian.Uint16(header[28:])) + int64(binary.LittleEndian.Uint16(header[30:])) + int64(binary.LittleEndian.Uint16(header[32:]))
		if length > limit-cursor {
			return ErrUnsafe
		}
		cursor += length
	}
	if actual != count {
		return ErrUnsafe
	}
	return nil
}

func OpenArchive(ctx context.Context, filename string) (*Archive, error) {
	file, err := os.OpenFile(filename, os.O_RDONLY|unix.O_NOFOLLOW|unix.O_NONBLOCK, 0)
	if err != nil {
		return nil, ErrUnsafe
	}
	return openArchiveFile(ctx, file)
}

// OpenArchiveFile duplicates an already pinned regular file descriptor. The
// archive owns the duplicate, so validation never reopens a replaceable path.
func OpenArchiveFile(ctx context.Context, source *os.File) (*Archive, error) {
	if source == nil {
		return nil, ErrUnsafe
	}
	fd, err := unix.FcntlInt(source.Fd(), unix.F_DUPFD_CLOEXEC, 0)
	if err != nil {
		return nil, ErrUnsafe
	}
	return openArchiveFile(ctx, os.NewFile(uintptr(fd), "package-archive"))
}

func openArchiveFile(ctx context.Context, file *os.File) (*Archive, error) {
	keep := false
	defer func() {
		if !keep {
			file.Close()
		}
	}()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		return nil, ErrUnsafe
	}
	if info.Size() > CompressedBytes {
		return nil, ErrLimit
	}
	if err := checkDirectory(ctx, file, info.Size()); err != nil {
		return nil, err
	}
	reader, err := zip.NewReader(file, info.Size())
	if err != nil {
		return nil, ErrUnsafe
	}
	if len(reader.File) > MaxEntries {
		return nil, ErrLimit
	}
	result := &Archive{file: file, Entries: make([]ZipEntry, 0, len(reader.File))}
	seen := make(map[string]string)
	for _, item := range reader.File {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		if item.Flags&1 != 0 {
			return nil, ErrUnsafe
		}
		directory := strings.HasSuffix(item.Name, "/")
		name := item.Name
		if directory {
			name = strings.TrimSuffix(name, "/")
		}
		if err := safePath(name); err != nil {
			return nil, err
		}
		if len(name) >= 2 && name[1] == ':' {
			return nil, ErrUnsafe
		}
		if _, ok := seen[name]; ok {
			return nil, ErrUnsafe
		}
		mode := item.ExternalAttrs >> 16
		bits := mode & 0170000
		kind := "file"
		if directory {
			kind = "directory"
		}
		if bits == 0120000 {
			kind = "symlink"
		}
		if bits != 0 && bits != 0100000 && bits != 0040000 && bits != 0120000 || bits == 0040000 && !directory || bits == 0100000 && directory || kind == "symlink" && directory {
			return nil, ErrUnsafe
		}
		if kind == "directory" && item.UncompressedSize64 != 0 {
			return nil, ErrUnsafe
		}
		max := uint64(FileBytes)
		if kind == "symlink" {
			max = MaxPathBytes
		}
		if item.UncompressedSize64 > max {
			return nil, ErrLimit
		}
		size := int64(item.UncompressedSize64)
		if result.RestoredBytes > RestoredBytes-size {
			return nil, ErrLimit
		}
		result.RestoredBytes += size
		seen[name] = kind
		result.Entries = append(result.Entries, ZipEntry{Original: item.Name, Path: name, Type: kind, Size: size, Mode: mode, file: item})
	}
	if _, ok := seen["package.json"]; !ok {
		candidates := []string{}
		for name := range seen {
			if strings.HasSuffix(name, "/package.json") && len(strings.Split(name, "/")) == 2 {
				candidates = append(candidates, name)
			}
		}
		if len(candidates) != 1 {
			return nil, ErrUnsafe
		}
		result.Prefix = strings.TrimSuffix(candidates[0], "package.json")
		for name := range seen {
			if name != strings.TrimSuffix(result.Prefix, "/") && !strings.HasPrefix(name, result.Prefix) {
				return nil, ErrUnsafe
			}
		}
	}
	normalized := result.Entries[:0]
	byPath := make(map[string]string)
	for _, item := range result.Entries {
		if result.Prefix != "" {
			if item.Path == strings.TrimSuffix(result.Prefix, "/") {
				continue
			}
			item.Path = strings.TrimPrefix(item.Path, result.Prefix)
		}
		normalized = append(normalized, item)
		byPath[item.Path] = item.Type
	}
	result.Entries = normalized
	if byPath["package.json"] != "file" {
		return nil, ErrUnsafe
	}
	for _, item := range result.Entries {
		if item.Path == "package.json" && item.Size > ManifestBytes {
			return nil, ErrUnsafe
		}
	}
	for _, item := range result.Entries {
		parts := strings.Split(item.Path, "/")
		for i := 1; i < len(parts); i++ {
			if kind, ok := byPath[strings.Join(parts[:i], "/")]; ok && kind != "directory" {
				return nil, ErrUnsafe
			}
		}
	}
	keep = true
	return result, nil
}

func randomName(prefix string) (string, error) {
	var nonce [16]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		return "", ErrUnsafe
	}
	return prefix + hex.EncodeToString(nonce[:]), nil
}
func syncRoot(root *os.Root) error {
	dir, err := root.Open(".")
	if err != nil {
		return err
	}
	defer dir.Close()
	return dir.Sync()
}
func syncDirectories(ctx context.Context, root *os.Root, name string) error {
	if err := eachDirectory(ctx, root, name, func(item os.DirEntry) error {
		child := path.Join(name, item.Name())
		info, err := root.Lstat(child)
		if err != nil {
			return ErrUnsafe
		}
		if info.IsDir() {
			return syncDirectories(ctx, root, child)
		}
		return nil
	}); err != nil {
		return err
	}
	dir, err := root.OpenFile(name, os.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW, 0)
	if err != nil {
		return ErrUnsafe
	}
	defer dir.Close()
	return dir.Sync()
}
func publishDirectory(root *os.Root, old, new string) error {
	dir, err := root.Open(".")
	if err != nil {
		return err
	}
	defer dir.Close()
	if err := unix.Renameat2(int(dir.Fd()), old, int(dir.Fd()), new, unix.RENAME_NOREPLACE); err != nil {
		return ErrUnsafe
	}
	return dir.Sync()
}

type contextReader struct {
	ctx    context.Context
	reader io.Reader
}

func (r contextReader) Read(data []byte) (int, error) {
	if r.ctx.Err() != nil {
		return 0, r.ctx.Err()
	}
	return r.reader.Read(data)
}

func ExtractArchive(ctx context.Context, filename, output string) (Manifest, error) {
	archive, err := OpenArchive(ctx, filename)
	if err != nil {
		return Manifest{}, err
	}
	defer archive.Close()
	parent, err := os.OpenRoot(filepath.Dir(output))
	if err != nil {
		return Manifest{}, ErrUnsafe
	}
	defer parent.Close()
	name := filepath.Base(output)
	return extractArchiveAt(ctx, archive, parent, name)
}

// ExtractArchiveAt keeps both input and output pinned throughout validation,
// extraction and publication. Neither a helper nor a path replacement can
// switch the archive or destination after its checksum has been verified.
func ExtractArchiveAt(ctx context.Context, source *os.File, parent *os.Root, name string) (Manifest, error) {
	archive, err := OpenArchiveFile(ctx, source)
	if err != nil {
		return Manifest{}, err
	}
	defer archive.Close()
	return extractArchiveAt(ctx, archive, parent, name)
}

func extractArchiveAt(ctx context.Context, archive *Archive, parent *os.Root, name string) (Manifest, error) {
	if parent == nil || filepath.Base(name) != name {
		return Manifest{}, ErrUnsafe
	}
	if name == "." || name == ".." || name == string(filepath.Separator) {
		return Manifest{}, ErrUnsafe
	}
	if _, err := parent.Lstat(name); !errors.Is(err, os.ErrNotExist) {
		return Manifest{}, ErrUnsafe
	}
	stage, err := randomName(".package-stage-")
	if err != nil {
		return Manifest{}, err
	}
	if err := parent.Mkdir(stage, 0700); err != nil {
		return Manifest{}, ErrUnsafe
	}
	keep := false
	defer func() {
		if !keep {
			parent.RemoveAll(stage)
		}
	}()
	root, err := parent.OpenRoot(stage)
	if err != nil {
		return Manifest{}, ErrUnsafe
	}
	defer root.Close()
	var links []ZipEntry
	buffer := make([]byte, 32<<10)
	for _, item := range archive.Entries {
		if ctx.Err() != nil {
			return Manifest{}, ctx.Err()
		}
		if item.Type == "directory" {
			if root.MkdirAll(item.Path, 0755) != nil {
				return Manifest{}, ErrUnsafe
			}
			continue
		}
		if root.MkdirAll(path.Dir(item.Path), 0755) != nil {
			return Manifest{}, ErrUnsafe
		}
		stream, err := item.file.Open()
		if err != nil {
			return Manifest{}, ErrUnsafe
		}
		if item.Type == "symlink" {
			raw, err := io.ReadAll(io.LimitReader(contextReader{ctx, stream}, MaxPathBytes+1))
			closeErr := stream.Close()
			if err != nil || closeErr != nil || int64(len(raw)) != item.Size {
				return Manifest{}, ErrUnsafe
			}
			if err := safeLink(item.Path, string(raw)); err != nil {
				return Manifest{}, err
			}
			item.Original = string(raw)
			links = append(links, item)
			continue
		}
		mode := os.FileMode(0644)
		if item.Mode&0111 != 0 {
			mode = 0755
		}
		file, err := root.OpenFile(item.Path, os.O_WRONLY|os.O_CREATE|os.O_EXCL|unix.O_NOFOLLOW, mode)
		if err != nil {
			stream.Close()
			return Manifest{}, ErrUnsafe
		}
		count, copyErr := io.CopyBuffer(file, io.LimitReader(contextReader{ctx, stream}, item.Size+1), buffer)
		streamErr := stream.Close()
		syncErr := file.Sync()
		closeErr := file.Close()
		if copyErr != nil || streamErr != nil || syncErr != nil || closeErr != nil || count != item.Size {
			if ctx.Err() != nil {
				return Manifest{}, ctx.Err()
			}
			return Manifest{}, ErrUnsafe
		}
	}
	for _, item := range links {
		if root.Symlink(item.Original, item.Path) != nil {
			return Manifest{}, ErrUnsafe
		}
	}
	for _, item := range links {
		if _, err := root.Stat(item.Path); err != nil {
			return Manifest{}, ErrUnsafe
		}
	}
	file, err := root.OpenFile("package.json", os.O_RDONLY|unix.O_NOFOLLOW, 0)
	if err != nil {
		return Manifest{}, ErrUnsafe
	}
	raw, err := io.ReadAll(io.LimitReader(file, ManifestBytes+1))
	file.Close()
	if err != nil {
		return Manifest{}, ErrManifest
	}
	manifest, err := ParseManifest(raw)
	if err != nil {
		return Manifest{}, err
	}
	if syncDirectories(ctx, root, ".") != nil {
		return Manifest{}, ErrUnsafe
	}
	dir, err := root.Open(".")
	if err != nil {
		return Manifest{}, ErrUnsafe
	}
	err = dir.Chmod(0755)
	syncErr := dir.Sync()
	dir.Close()
	if err != nil || syncErr != nil {
		return Manifest{}, ErrUnsafe
	}
	root.Close()
	if err := publishDirectory(parent, stage, name); err != nil {
		return Manifest{}, err
	}
	keep = true
	return manifest, nil
}

type PackedArchive struct {
	Bytes  int64
	Digest string
}
type zipMeter struct {
	target io.Writer
	hash   io.Writer
	bytes  int64
}

func (w *zipMeter) Write(data []byte) (int, error) {
	if int64(len(data)) > CompressedBytes-w.bytes {
		return 0, ErrLimit
	}
	n, err := w.target.Write(data)
	if n > 0 {
		w.hash.Write(data[:n])
		w.bytes += int64(n)
	}
	return n, err
}

func PackArchive(ctx context.Context, tree *Tree, output string) (PackedArchive, error) {
	return packArchive(ctx, tree, output, 0600, false)
}

// PackArchiveToSpool publishes helper output for the owner of its pinned spool.
func PackArchiveToSpool(ctx context.Context, tree *Tree, output string) (PackedArchive, error) {
	return packArchive(ctx, tree, output, 0644, true)
}

func packArchive(ctx context.Context, tree *Tree, output string, mode os.FileMode, inheritOwner bool) (PackedArchive, error) {
	parent, err := os.OpenRoot(filepath.Dir(output))
	if err != nil {
		return PackedArchive{}, ErrUnsafe
	}
	defer parent.Close()
	temp, err := randomName(".package-zip-")
	if err != nil {
		return PackedArchive{}, err
	}
	file, err := parent.OpenFile(temp, os.O_WRONLY|os.O_CREATE|os.O_EXCL|unix.O_NOFOLLOW, 0600)
	if err != nil {
		return PackedArchive{}, ErrUnsafe
	}
	defer file.Close()
	published := false
	defer func() {
		if !published {
			parent.Remove(temp)
		}
	}()
	// The trusted capture helper can run as root against a host-owned spool.
	// Set ownership while the ZIP is still empty, before any lengthy writes or
	// publication, so interrupted captures remain collectable by that owner.
	if err := file.Chmod(mode); err != nil {
		return PackedArchive{}, ErrUnsafe
	}
	if inheritOwner && os.Geteuid() == 0 {
		directory, err := parent.Open(".")
		if err != nil {
			return PackedArchive{}, ErrUnsafe
		}
		var owner unix.Stat_t
		statErr := unix.Fstat(int(directory.Fd()), &owner)
		directory.Close()
		if statErr != nil || file.Chown(int(owner.Uid), int(owner.Gid)) != nil {
			return PackedArchive{}, ErrUnsafe
		}
	}
	hash := sha256.New()
	meter := &zipMeter{target: file, hash: hash}
	writer := zip.NewWriter(meter)
	entries := append([]contracts.DigestEntry(nil), tree.Entries...)
	buffer := make([]byte, 32<<10)
	sort.Slice(entries, func(i, j int) bool { return entries[i].Path < entries[j].Path })
	for _, entry := range entries {
		if ctx.Err() != nil {
			return PackedArchive{}, ctx.Err()
		}
		header := &zip.FileHeader{Name: entry.Path, Method: zip.Deflate, Modified: time.Date(1980, 1, 1, 0, 0, 0, 0, time.UTC)}
		mode := os.FileMode(entry.Mode)
		if entry.Type == "directory" {
			header.Name += "/"
			mode |= os.ModeDir
			header.Method = zip.Store
		}
		if entry.Type == "symlink" {
			mode |= os.ModeSymlink
		}
		header.SetMode(mode)
		part, err := writer.CreateHeader(header)
		if err != nil {
			return PackedArchive{}, ErrUnsafe
		}
		if entry.Type == "directory" {
			continue
		}
		if entry.Type == "symlink" {
			if _, err := io.WriteString(part, entry.Target); err != nil {
				return PackedArchive{}, err
			}
			continue
		}
		source, err := tree.openFile(entry.Path)
		if err != nil {
			return PackedArchive{}, err
		}
		count, copyErr := io.CopyBuffer(part, io.LimitReader(contextReader{ctx, source}, entry.Size+1), buffer)
		closeErr := source.Close()
		if copyErr != nil || closeErr != nil || count != entry.Size {
			if ctx.Err() != nil {
				return PackedArchive{}, ctx.Err()
			}
			if errors.Is(copyErr, ErrLimit) {
				return PackedArchive{}, ErrLimit
			}
			return PackedArchive{}, ErrUnsafe
		}
	}
	if err := writer.Close(); err != nil {
		return PackedArchive{}, err
	}
	if file.Sync() != nil || file.Close() != nil {
		return PackedArchive{}, ErrUnsafe
	}
	if parent.Rename(temp, filepath.Base(output)) != nil || syncRoot(parent) != nil {
		return PackedArchive{}, ErrUnsafe
	}
	published = true
	return PackedArchive{Bytes: meter.bytes, Digest: hex.EncodeToString(hash.Sum(nil))}, nil
}
