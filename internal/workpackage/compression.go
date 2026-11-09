package workpackage

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"hash"
	"io"
	"os"
	"path/filepath"

	"github.com/klauspost/compress/zstd"
	"piwork/internal/contracts"
)

const MagicV2 = "PIWORK2\n"
const MaxDecodeWindow = 8 << 20

func storedSize(b contracts.WorkBlob) int64 {
	if b.StoredSize.Present {
		return int64(b.StoredSize.Value)
	}
	return int64(b.Size)
}

// frameReader exposes exactly one ordinary frame. The library owns decoding;
// this reader only enforces the portable framing subset and its boundaries.
type frameReader struct {
	source               *bufio.Reader
	prefix               *bytes.Reader
	remaining            int64
	last, checksum, done bool
}

func newFrameReader(source io.Reader, size int64, original int64) (*frameReader, error) {
	r := bufio.NewReaderSize(source, 32<<10)
	n := int64(zstd.HeaderMaxSize)
	if size < n {
		n = size
	}
	p, err := r.Peek(int(n))
	if err != nil && err != io.EOF {
		return nil, invalid("zstd.header")
	}
	var h zstd.Header
	if h.Decode(p) != nil || h.Skippable || h.DictionaryID != 0 {
		return nil, invalid("zstd.header")
	}
	window := h.WindowSize
	if h.SingleSegment {
		window = h.FrameContentSize
	}
	if window > MaxDecodeWindow {
		return nil, limit("zstd.window")
	}
	if h.HasFCS && h.FrameContentSize != uint64(original) {
		return nil, invalid("zstd.size")
	}
	header := make([]byte, h.HeaderSize)
	if _, err = io.ReadFull(r, header); err != nil {
		return nil, invalid("zstd.header")
	}
	return &frameReader{source: r, prefix: bytes.NewReader(header), checksum: h.HasCheckSum}, nil
}
func (r *frameReader) Read(p []byte) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}
	if r.prefix.Len() > 0 {
		return r.prefix.Read(p)
	}
	if r.remaining > 0 {
		if int64(len(p)) > r.remaining {
			p = p[:r.remaining]
		}
		n, err := r.source.Read(p)
		r.remaining -= int64(n)
		if err == io.EOF {
			if r.remaining > 0 {
				err = io.ErrUnexpectedEOF
			} else {
				err = nil
			}
		}
		return n, err
	}
	if r.last {
		if r.checksum {
			r.checksum = false
			r.remaining = 4
			return r.Read(p)
		}
		if !r.done {
			r.done = true
			if _, err := r.source.ReadByte(); err != io.EOF {
				return 0, invalid("zstd.trailing")
			}
		}
		return 0, io.EOF
	}
	var h [3]byte
	if _, err := io.ReadFull(r.source, h[:]); err != nil {
		return 0, invalid("zstd.block")
	}
	v := uint32(h[0]) | uint32(h[1])<<8 | uint32(h[2])<<16
	r.last = v&1 != 0
	kind := (v >> 1) & 3
	if kind == 3 {
		return 0, invalid("zstd.block")
	}
	r.remaining = int64(v >> 3)
	if kind == 1 {
		r.remaining = 1
	}
	r.prefix = bytes.NewReader(h[:])
	return r.Read(p)
}

type decodedBlob struct {
	reader    io.Reader
	decoder   *zstd.Decoder
	remaining int64
	hash      hash.Hash
	digest    string
	verified  bool
}

func openDecoded(source io.Reader, b contracts.WorkBlob) (*decodedBlob, error) {
	var decoder *zstd.Decoder
	if b.Encoding.Value == "zstd" {
		frame, err := newFrameReader(source, storedSize(b), int64(b.Size))
		if err != nil {
			return nil, err
		}
		decoder, err = zstd.NewReader(frame, zstd.WithDecoderConcurrency(1), zstd.WithDecoderMaxWindow(MaxDecodeWindow), zstd.WithDecoderMaxMemory(MaxDecodeWindow))
		if err != nil {
			return nil, invalid("zstd")
		}
		source = decoder
	}
	return &decodedBlob{reader: source, decoder: decoder, remaining: int64(b.Size), hash: sha256.New(), digest: string(b.Digest)}, nil
}
func (r *decodedBlob) Read(p []byte) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}
	if r.verified {
		return 0, io.EOF
	}
	if r.remaining == 0 {
		var extra [1]byte
		n, err := r.reader.Read(extra[:])
		if n != 0 || err != io.EOF {
			if err != nil && err != io.EOF {
				if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
					return 0, err
				}
				return 0, invalid("blob.decode")
			}
			return 0, invalid("blob.length")
		}
		if hex.EncodeToString(r.hash.Sum(nil)) != r.digest {
			return 0, invalid("blobHash")
		}
		r.verified = true
		return 0, io.EOF
	}
	if int64(len(p)) > r.remaining {
		p = p[:r.remaining]
	}
	n, err := r.reader.Read(p)
	if err != nil && err != io.EOF && !errors.Is(err, context.Canceled) && !errors.Is(err, context.DeadlineExceeded) {
		err = invalid("blob.decode")
	}
	r.remaining -= int64(n)
	r.hash.Write(p[:n])
	if err == io.EOF {
		if r.remaining > 0 {
			return n, invalid("blob.length")
		}
		err = nil
	}
	return n, err
}
func (r *decodedBlob) Close() error {
	if r.decoder != nil {
		r.decoder.Close()
	}
	return nil
}

// PrepareV2 uses the caller's job directory; cleanup removes only candidates
// created by this invocation. Original blobs remain under their existing owner.
func PrepareV2(ctx context.Context, spec contracts.PortableWorkSpec, open OpenBlob, directory string) (contracts.PortableWorkSpec, OpenBlob, func(), error) {
	spec.Blobs = append([]contracts.WorkBlob(nil), spec.Blobs...)
	paths := map[string]string{}
	cleanup := func() {
		for _, p := range paths {
			_ = os.Remove(p)
		}
	}
	fail := func(err error) (contracts.PortableWorkSpec, OpenBlob, func(), error) {
		cleanup()
		return contracts.PortableWorkSpec{}, nil, func() {}, err
	}
	encoder, err := zstd.NewWriter(nil, zstd.WithEncoderConcurrency(1), zstd.WithWindowSize(MaxDecodeWindow), zstd.WithEncoderLevel(zstd.SpeedDefault))
	if err != nil {
		return fail(err)
	}
	defer encoder.Close()
	buffer := make([]byte, 1<<20)
	for i, b := range spec.Blobs {
		b.Encoding = contracts.Supplied("raw")
		b.StoredSize = contracts.Supplied(b.Size)
		if b.Size > 0 {
			source, err := open(b)
			if err != nil {
				return fail(err)
			}
			candidate, err := os.CreateTemp(directory, "compressed-*.tmp")
			if err != nil {
				source.Close()
				return fail(err)
			}
			paths[string(b.Digest)] = candidate.Name()
			encoder.Reset(candidate)
			hash := sha256.New()
			n, err := io.CopyBuffer(encoder, io.TeeReader(io.LimitReader(contextReader{ctx, source}, int64(b.Size)+1), hash), buffer)
			closeErr := source.Close()
			finishErr := encoder.Close()
			if err == nil {
				err = closeErr
			}
			if err == nil {
				err = finishErr
			}
			if err == nil && (n != int64(b.Size) || hex.EncodeToString(hash.Sum(nil)) != string(b.Digest)) {
				err = invalid("blob.source")
			}
			info, statErr := candidate.Stat()
			syncErr := candidate.Sync()
			fileErr := candidate.Close()
			if err == nil {
				err = statErr
			}
			if err == nil {
				err = syncErr
			}
			if err == nil {
				err = fileErr
			}
			if err != nil {
				return fail(err)
			}
			if info.Size() < int64(b.Size) {
				b.Encoding = contracts.Supplied("zstd")
				b.StoredSize = contracts.Supplied(contracts.WorkByteSize(info.Size()))
			} else {
				if err := os.Remove(candidate.Name()); err != nil {
					return fail(err)
				}
				delete(paths, string(b.Digest))
			}
		}
		spec.Blobs[i] = b
	}
	spec.FormatVersion = 2
	stored := func(b contracts.WorkBlob) (io.ReadCloser, error) {
		if p, ok := paths[string(b.Digest)]; ok {
			return os.Open(filepath.Clean(p))
		}
		return open(b)
	}
	return spec, stored, cleanup, nil
}

func frameMagic(version float64) string {
	if version == 2 {
		return MagicV2
	}
	return Magic
}
func writeHeader(sink io.Writer, spec contracts.PortableWorkSpec, manifest []byte) error {
	var h [16]byte
	copy(h[:8], frameMagic(spec.FormatVersion))
	binary.BigEndian.PutUint64(h[8:], uint64(len(manifest)))
	if err := writeExact(sink, h[:]); err != nil {
		return err
	}
	return writeExact(sink, manifest)
}
