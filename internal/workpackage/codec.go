// Package workpackage owns the unchanged, language-independent .work V1 format.
package workpackage

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"unicode/utf8"

	"piwork/internal/contracts"
)

const Magic = "PIWORK1\n"

type Limits struct {
	PackageBytes, RestoredBytes, MetadataBytes, TotalMetadataBytes, Entries, PathBytes int64
	Depth                                                                              int
}

var DefaultLimits = Limits{100 << 30, 100 << 30, 64 << 20, 256 << 20, 1000000, 4096, 128}

type ValidationError struct{ Code, Field string }

func (err *ValidationError) Error() string { return "Work package validation failed" }
func invalid(field string) error           { return &ValidationError{"PACKAGE_INVALID", field} }
func limit(field string) error             { return &ValidationError{"PACKAGE_LIMIT_EXCEEDED", field} }
func incompatible(field string) error      { return &ValidationError{"PACKAGE_INCOMPATIBLE", field} }

type ReadOptions struct {
	Limits *Limits
	OnBlob func(contracts.WorkBlob, io.Reader) error
}
type Verified struct {
	Spec                            contracts.PortableWorkSpec
	Digest                          string
	Size, RestoredBytes, EntryCount int64
	Metadata                        map[string]json.RawMessage
	Offsets                         map[string]int64
}
type contextReader struct {
	ctx    context.Context
	source io.Reader
}

func (r contextReader) Read(buffer []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.source.Read(buffer)
}
func allIntegers(value any) bool {
	switch value := value.(type) {
	case float64:
		return false
	case map[string]any:
		for _, child := range value {
			if !allIntegers(child) {
				return false
			}
		}
	case []any:
		for _, child := range value {
			if !allIntegers(child) {
				return false
			}
		}
	}
	return true
}
func parseJSON(raw []byte, maximum int64) (any, error) {
	value, err := contracts.ParseJSON(bytes.NewReader(raw), maximum)
	if err != nil {
		return nil, invalid("json")
	}
	if !allIntegers(value) {
		return nil, invalid("integer")
	}
	return value, nil
}

func Read(ctx context.Context, source io.Reader, options ReadOptions) (result Verified, returned error) {
	limits := DefaultLimits
	if options.Limits != nil {
		limits = *options.Limits
	}
	if limits.PackageBytes < 16 || limits.MetadataBytes < 1 || limits.TotalMetadataBytes < 1 {
		return result, limit("limits")
	}
	hash := sha256.New()
	reader := io.TeeReader(contextReader{ctx, source}, hash)
	var header [16]byte
	if _, err := io.ReadFull(reader, header[:]); err != nil {
		return result, invalid("truncated")
	}
	if string(header[:8]) != Magic {
		return result, invalid("magic")
	}
	length := binary.BigEndian.Uint64(header[8:])
	if length > uint64(limits.MetadataBytes) {
		return result, limit("manifest")
	}
	if length > uint64(limits.PackageBytes-16) {
		return result, limit("packageBytes")
	}
	raw := make([]byte, int(length))
	if _, err := io.ReadFull(reader, raw); err != nil {
		return result, invalid("truncated")
	}
	spec, err := DecodeManifest(raw)
	if err != nil {
		return result, err
	}
	result.Spec = spec
	expected := int64(16 + length)
	metadataBytes := int64(length)
	agents := map[string]bool{}
	for _, c := range spec.Contexts {
		agents[string(c.AgentsBlob)] = true
	}
	collect := map[string]bool{}
	for _, blob := range spec.Blobs {
		if int64(blob.Size) > limits.PackageBytes-expected {
			return result, limit("packageBytes")
		}
		expected += int64(blob.Size)
		digest := string(blob.Digest)
		if metadataBlob(blob) || agents[digest] {
			if int64(blob.Size) > limits.MetadataBytes {
				return result, limit("metadata")
			}
			if int64(blob.Size) > limits.TotalMetadataBytes-metadataBytes {
				return result, limit("totalMetadataBytes")
			}
			metadataBytes += int64(blob.Size)
			collect[digest] = true
		}
		if agents[digest] && blob.Size > 256<<10 {
			return result, limit("agentsMd")
		}
	}
	result.Metadata = map[string]json.RawMessage{}
	result.Offsets = map[string]int64{}
	buffer := make([]byte, 1<<20)
	offset := int64(16 + length)
	for _, blob := range spec.Blobs {
		if err := ctx.Err(); err != nil {
			return result, err
		}
		digest := string(blob.Digest)
		result.Offsets[digest] = offset
		offset += int64(blob.Size)
		limited := &io.LimitedReader{R: reader, N: int64(blob.Size)}
		blobHash := sha256.New()
		var metadata bytes.Buffer
		sink := io.Writer(blobHash)
		if collect[digest] {
			sink = io.MultiWriter(blobHash, &metadata)
		}
		chunks := io.TeeReader(limited, sink)
		if options.OnBlob != nil {
			err = options.OnBlob(blob, chunks)
		} else {
			_, err = io.CopyBuffer(io.Discard, chunks, buffer)
		}
		if err != nil {
			return result, err
		}
		if limited.N != 0 {
			return result, invalid("truncatedOrUnconsumedBlob")
		}
		if hex.EncodeToString(blobHash.Sum(nil)) != digest {
			return result, invalid("blobHash")
		}
		if agents[digest] && !utf8.Valid(metadata.Bytes()) {
			return result, invalid("agentsUtf8")
		}
		if metadataBlob(blob) {
			if _, err := parseJSON(metadata.Bytes(), limits.MetadataBytes); err != nil {
				return result, err
			}
			result.Metadata[digest] = append([]byte(nil), metadata.Bytes()...)
		}
	}
	var extra [1]byte
	n, err := reader.Read(extra[:])
	if n != 0 || err != io.EOF {
		if ctx.Err() != nil {
			return result, ctx.Err()
		}
		return result, invalid("trailingBytes")
	}
	result.Size = expected
	result.Digest = hex.EncodeToString(hash.Sum(nil))
	result.RestoredBytes, result.EntryCount, err = ValidateContents(spec, result.Metadata, limits)
	return result, err
}
func metadataBlob(blob contracts.WorkBlob) bool {
	for _, kind := range blob.Kinds {
		if kind == "tree" || kind == "control-history" || kind == "identity-map" || kind == "image-config" {
			return true
		}
	}
	return false
}

type OpenBlob func(contracts.WorkBlob) (io.ReadCloser, error)

// Sources are provisional until their declared length and hash have matched.
// Publication belongs to the caller and must occur only after Encode succeeds.
func Encode(ctx context.Context, spec contracts.PortableWorkSpec, open OpenBlob, sink io.Writer) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := ValidateManifest(spec); err != nil {
		return err
	}
	manifest, err := contracts.EncodeCanonicalJSON(spec)
	if err != nil {
		return invalid("manifest")
	}
	if int64(len(manifest)) > DefaultLimits.MetadataBytes {
		return limit("manifest")
	}
	size := int64(len(manifest) + 16)
	for _, blob := range spec.Blobs {
		if int64(blob.Size) > DefaultLimits.PackageBytes-size {
			return limit("packageBytes")
		}
		size += int64(blob.Size)
	}
	var header [16]byte
	copy(header[:8], Magic)
	binary.BigEndian.PutUint64(header[8:], uint64(len(manifest)))
	if err := writeExact(sink, header[:]); err != nil {
		return err
	}
	if err := writeExact(sink, manifest); err != nil {
		return err
	}
	buffer := make([]byte, 1<<20)
	for _, blob := range spec.Blobs {
		if err := ctx.Err(); err != nil {
			return err
		}
		source, err := open(blob)
		if err != nil {
			return err
		}
		hash := sha256.New()
		n, copyErr := io.CopyBuffer(io.MultiWriter(sink, hash), io.LimitReader(contextReader{ctx, source}, int64(blob.Size)+1), buffer)
		closeErr := source.Close()
		if copyErr != nil {
			return copyErr
		}
		if closeErr != nil {
			return closeErr
		}
		if n != int64(blob.Size) {
			return invalid("blobLength")
		}
		if hex.EncodeToString(hash.Sum(nil)) != string(blob.Digest) {
			return invalid("blobHash")
		}
	}
	return nil
}
func writeExact(sink io.Writer, data []byte) error {
	n, err := sink.Write(data)
	if err == nil && n != len(data) {
		return io.ErrShortWrite
	}
	return err
}
func Code(err error) string {
	var typed *ValidationError
	if errors.As(err, &typed) {
		return typed.Code
	}
	return "PACKAGE_INVALID"
}
