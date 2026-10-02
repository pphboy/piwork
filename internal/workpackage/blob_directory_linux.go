//go:build linux

package workpackage

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"

	"golang.org/x/sys/unix"
)

var blobDigestPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)
var blobCopyBuffers = sync.Pool{New: func() any { return make([]byte, 1<<20) }}

type BlobValue struct {
	Digest string `json:"digest"`
	Size   int64  `json:"size"`
}
type BlobDirectory struct {
	fd    int
	owner unix.Stat_t
}

// OpenDirectoryFD pins every absolute directory component without following
// links. It never creates directories or accepts an archive-derived pathname.
func OpenDirectoryFD(name string) (int, error) {
	if !filepath.IsAbs(name) || filepath.Clean(name) != name || strings.ContainsRune(name, 0) {
		return -1, invalid("directory")
	}
	fd, err := unix.Open("/", unix.O_RDONLY|unix.O_DIRECTORY|unix.O_CLOEXEC, 0)
	if err != nil {
		return -1, err
	}
	if name == "/" {
		return fd, nil
	}
	for _, part := range strings.Split(strings.TrimPrefix(name, "/"), "/") {
		next, err := unix.Openat(fd, part, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
		unix.Close(fd)
		if err != nil {
			return -1, err
		}
		fd = next
	}
	return fd, nil
}
func OpenBlobDirectory(name string) (*BlobDirectory, error) {
	fd, err := OpenDirectoryFD(name)
	if err != nil {
		return nil, err
	}
	var owner unix.Stat_t
	if err := unix.Fstat(fd, &owner); err != nil {
		unix.Close(fd)
		return nil, err
	}
	return &BlobDirectory{fd, owner}, nil
}
func (d *BlobDirectory) Close() error {
	if d.fd < 0 {
		return nil
	}
	fd := d.fd
	d.fd = -1
	return unix.Close(fd)
}
func (d *BlobDirectory) FD() int           { return d.fd }
func (d *BlobDirectory) Owner() (int, int) { return int(d.owner.Uid), int(d.owner.Gid) }
func (d *BlobDirectory) Read(digest string) (*os.File, error) {
	if !blobDigestPattern.MatchString(digest) || d.fd < 0 {
		return nil, invalid("blob.digest")
	}
	fd, err := unix.Openat(d.fd, digest, unix.O_RDONLY|unix.O_NOFOLLOW|unix.O_NONBLOCK|unix.O_CLOEXEC, 0)
	if err != nil {
		return nil, err
	}
	var info unix.Stat_t
	if unix.Fstat(fd, &info) != nil || info.Mode&unix.S_IFMT != unix.S_IFREG {
		unix.Close(fd)
		return nil, invalid("blob.file")
	}
	return os.NewFile(uintptr(fd), digest), nil
}
func (d *BlobDirectory) ReadMetadata(ctx context.Context, digest string) ([]byte, error) {
	file, err := d.Read(digest)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return nil, err
	}
	if info.Size() > DefaultLimits.MetadataBytes {
		return nil, limit("metadata")
	}
	raw, err := io.ReadAll(io.LimitReader(contextReader{ctx, file}, DefaultLimits.MetadataBytes+1))
	if err != nil {
		return nil, err
	}
	if int64(len(raw)) > DefaultLimits.MetadataBytes {
		return nil, limit("metadata")
	}
	hash := sha256.Sum256(raw)
	if hex.EncodeToString(hash[:]) != digest {
		return nil, invalid("blob.hash")
	}
	return raw, nil
}
func (d *BlobDirectory) Verify(ctx context.Context, digest string, size int64) error {
	if size < 0 || size > DefaultLimits.PackageBytes {
		return limit("blob.size")
	}
	source, err := d.Read(digest)
	if err != nil {
		return err
	}
	defer source.Close()
	hash := sha256.New()
	buffer := blobCopyBuffers.Get().([]byte)
	defer blobCopyBuffers.Put(buffer)
	n, err := io.CopyBuffer(hash, io.LimitReader(contextReader{ctx, source}, size+1), buffer)
	if err != nil {
		return err
	}
	if n != size || hex.EncodeToString(hash.Sum(nil)) != digest {
		return invalid("blob.hash")
	}
	return nil
}

// Put seals a private blob before atomically linking its content address. A
// pre-existing address is re-hashed, never overwritten or treated as trusted.
func (d *BlobDirectory) Put(ctx context.Context, source io.Reader, maximum int64) (BlobValue, error) {
	if maximum < 0 || maximum > DefaultLimits.PackageBytes {
		return BlobValue{}, limit("blob.size")
	}
	var nonce [16]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		return BlobValue{}, err
	}
	name := "partial-" + hex.EncodeToString(nonce[:])
	fd, err := unix.Openat(d.fd, name, unix.O_WRONLY|unix.O_CREAT|unix.O_EXCL|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0600)
	if err != nil {
		return BlobValue{}, err
	}
	file := os.NewFile(uintptr(fd), name)
	defer func() { file.Close(); unix.Unlinkat(d.fd, name, 0) }()
	hash := sha256.New()
	buffer := blobCopyBuffers.Get().([]byte)
	defer blobCopyBuffers.Put(buffer)
	n, err := io.CopyBuffer(io.MultiWriter(file, hash), io.LimitReader(contextReader{ctx, source}, maximum+1), buffer)
	if err != nil {
		return BlobValue{}, err
	}
	if n > maximum {
		return BlobValue{}, limit("blob.size")
	}
	if err := unix.Fchown(fd, int(d.owner.Uid), int(d.owner.Gid)); err != nil {
		return BlobValue{}, err
	}
	if err := file.Sync(); err != nil {
		return BlobValue{}, err
	}
	digest := hex.EncodeToString(hash.Sum(nil))
	if err := unix.Linkat(d.fd, name, d.fd, digest, 0); err != nil {
		if !errors.Is(err, unix.EEXIST) {
			return BlobValue{}, err
		}
		if err := d.Verify(ctx, digest, n); err != nil {
			return BlobValue{}, err
		}
	}
	if err := unix.Unlinkat(d.fd, name, 0); err != nil {
		return BlobValue{}, err
	}
	if err := unix.Fsync(d.fd); err != nil {
		return BlobValue{}, err
	}
	return BlobValue{digest, n}, nil
}
