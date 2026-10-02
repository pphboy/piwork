package imagestatic

import (
	"compress/gzip"
	"context"
	"io"
)

type CapturedBlob struct {
	Digest string
	Size   int64
}
type CapturedPortableImage struct {
	Identity Identity
	Config   CapturedBlob
	Layers   []CapturedBlob
}
type StoreBlob func(io.Reader, int64) (CapturedBlob, error)

// CapturePortableImage normalizes a verified Engine Docker/OCI save archive
// into original config bytes and uncompressed V1 layers, without extraction.
func CapturePortableImage(ctx context.Context, source io.ReaderAt, size int64, expected Identity, put StoreBlob) (CapturedPortableImage, error) {
	result := CapturedPortableImage{Identity: expected, Layers: []CapturedBlob{}}
	a, err := indexArchive(ctx, source, size)
	if err != nil {
		return result, err
	}
	config, layers, err := a.selectImage(expected)
	if err != nil {
		return result, err
	}
	var configMember member
	found := false
	for _, m := range a.files {
		if m.digest == expected.ID {
			configMember = m
			found = true
			break
		}
	}
	if !found || configMember.size > MaxMetadataBytes {
		return result, ErrInvalid
	}
	result.Config, err = put(a.section(configMember), configMember.size)
	if err != nil {
		return result, err
	}
	if "sha256:"+result.Config.Digest != expected.ID || result.Config.Size != configMember.size {
		return result, ErrInvalid
	}
	var total int64
	for i, layer := range layers {
		reader := a.section(layer.member)
		var compressed *gzip.Reader
		if layer.gzip {
			compressed, err = gzip.NewReader(reader)
			if err != nil {
				return result, ErrInvalid
			}
			reader = compressed
		}
		blob, err := put(reader, MaxRestoredBytes-total)
		if compressed != nil {
			closeErr := compressed.Close()
			if err == nil {
				err = closeErr
			}
		}
		if err != nil {
			return result, err
		}
		if blob.Size < 0 || blob.Size > MaxRestoredBytes-total || "sha256:"+blob.Digest != config.RootFS.DiffIDs[i] {
			return result, ErrInvalid
		}
		total += blob.Size
		result.Layers = append(result.Layers, blob)
	}
	return result, nil
}
