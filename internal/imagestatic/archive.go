// Package imagestatic checks an immutable image archive without extracting or
// executing it. It is shared by Engine preflight and offline .work inspection.
package imagestatic

import (
	"archive/tar"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"path"
	"strings"
	"unicode/utf8"

	"piwork/internal/contracts"
)

const (
	MaxArchiveBytes       int64 = 100 << 30
	MaxRestoredBytes      int64 = 100 << 30
	MaxMetadataBytes      int64 = 64 << 20
	MaxTotalMetadataBytes int64 = 256 << 20
	MaxEntries                  = 1_000_000
	MaxPathBytes                = 4096
	MaxDepth                    = 128
)

var (
	ErrInvalid      = errors.New("image archive is invalid")
	ErrLimit        = errors.New("image archive exceeds its limit")
	ErrUnsupported  = errors.New("image archive format is unsupported")
	ErrIncompatible = errors.New("image native capabilities are incompatible")
)

type Identity struct {
	ID, OS, Architecture, Variant string
}

type member struct {
	offset, size int64
	digest       string
}

type archive struct {
	ctx           context.Context
	reader        io.ReaderAt
	files         map[string]member
	metadataBytes int64
}

type contextReader struct {
	ctx    context.Context
	reader io.Reader
}

func (r contextReader) Read(p []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.reader.Read(p)
}

func hashString(h []byte) string { return "sha256:" + hex.EncodeToString(h) }
func validDigest(s string) bool {
	if len(s) != 71 || !strings.HasPrefix(s, "sha256:") {
		return false
	}
	for _, c := range s[7:] {
		if c < '0' || c > '9' {
			if c < 'a' || c > 'f' {
				return false
			}
		}
	}
	return true
}
func validPath(s string) bool {
	if s == "" || len(s) > MaxPathBytes || !utf8.ValidString(s) || strings.ContainsAny(s, "\\\x00") {
		return false
	}
	parts := strings.Split(s, "/")
	if len(parts) > MaxDepth {
		return false
	}
	for _, p := range parts {
		if p == "" || p == "." || p == ".." {
			return false
		}
	}
	return true
}

// indexArchive reads only ordinary outer save-archive files/directories. It
// checks every byte, checksum, duplicate, padding and tail before selecting an
// image. All offsets remain within the caller's ReaderAt; no archive pathname
// is ever passed to the host filesystem.
func indexArchive(ctx context.Context, reader io.ReaderAt, size int64) (*archive, error) {
	if size > MaxArchiveBytes {
		return nil, ErrLimit
	}
	if reader == nil || size < 512 {
		return nil, ErrInvalid
	}
	if size%512 != 0 {
		return nil, ErrInvalid
	}
	a := &archive{ctx: ctx, reader: reader, files: map[string]member{}}
	names := map[string]bool{}
	var offset int64
	ended := false
	entries := 0
	var block [512]byte
	for offset < size {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if _, err := reader.ReadAt(block[:], offset); err != nil {
			return nil, ErrInvalid
		}
		offset += 512
		if bytes.Equal(block[:], make([]byte, 512)) {
			ended = true
			continue
		}
		if ended {
			return nil, ErrInvalid
		}
		entries++
		if entries > MaxEntries {
			return nil, ErrLimit
		}
		if block[156] != 0 && block[156] != tar.TypeReg && block[156] != tar.TypeDir {
			return nil, ErrUnsupported
		}
		h, err := tar.NewReader(bytes.NewReader(block[:])).Next()
		if err != nil || h.Size < 0 {
			return nil, ErrInvalid
		}
		name := h.Name
		if h.Typeflag == tar.TypeDir {
			name = strings.TrimSuffix(name, "/")
			if h.Size != 0 {
				return nil, ErrInvalid
			}
		}
		if !validPath(name) || names[name] {
			return nil, ErrInvalid
		}
		names[name] = true
		if h.Size > size-offset {
			return nil, ErrInvalid
		}
		padded := (h.Size + 511) / 512 * 512
		if padded > size-offset {
			return nil, ErrInvalid
		}
		if h.Typeflag != tar.TypeDir {
			hash := sha256.New()
			n, err := io.CopyBuffer(hash, contextReader{ctx, io.NewSectionReader(reader, offset, h.Size)}, make([]byte, 32<<10))
			if err != nil {
				return nil, err
			}
			if n != h.Size {
				return nil, ErrInvalid
			}
			a.files[name] = member{offset, h.Size, hashString(hash.Sum(nil))}
		}
		if padded != h.Size {
			padding := make([]byte, padded-h.Size)
			if _, err := reader.ReadAt(padding, offset+h.Size); err != nil || !bytes.Equal(padding, make([]byte, len(padding))) {
				return nil, ErrInvalid
			}
		}
		offset += padded
	}
	if !ended {
		return nil, ErrInvalid
	}
	// A file cannot also be an archive-directory ancestor.
	for name := range names {
		for parent := path.Dir(name); parent != "."; parent = path.Dir(parent) {
			if _, ok := a.files[parent]; ok {
				return nil, ErrInvalid
			}
		}
	}
	return a, nil
}

func (a *archive) lookup(name string) (member, error) {
	if !validPath(name) {
		return member{}, ErrInvalid
	}
	m, ok := a.files[name]
	if !ok {
		return member{}, ErrInvalid
	}
	return m, nil
}
func (a *archive) section(m member) io.Reader {
	return contextReader{a.ctx, io.NewSectionReader(a.reader, m.offset, m.size)}
}
func (a *archive) metadata(name string, output any) (member, error) {
	m, err := a.lookup(name)
	if err != nil {
		return member{}, err
	}
	if m.size > MaxMetadataBytes || m.size > MaxTotalMetadataBytes-a.metadataBytes {
		return member{}, ErrLimit
	}
	a.metadataBytes += m.size
	value, err := contracts.ParseJSON(a.section(m), MaxMetadataBytes)
	if err != nil {
		return member{}, ErrInvalid
	}
	data, err := json.Marshal(value)
	if err != nil {
		return member{}, ErrInvalid
	}
	if err := json.Unmarshal(data, output); err != nil {
		return member{}, ErrInvalid
	}
	return m, nil
}

type dockerManifest struct {
	Config string
	Layers []string
}
type platform struct {
	OS           string `json:"os"`
	Architecture string `json:"architecture"`
	Variant      string `json:"variant"`
}
type descriptor struct {
	MediaType string          `json:"mediaType"`
	Digest    string          `json:"digest"`
	Size      int64           `json:"size"`
	URLs      json.RawMessage `json:"urls,omitempty"`
	Platform  *platform       `json:"platform,omitempty"`
}
type imageConfig struct {
	OS           string `json:"os"`
	Architecture string `json:"architecture"`
	Variant      string `json:"variant"`
	RootFS       struct {
		Type    string   `json:"type"`
		DiffIDs []string `json:"diff_ids"`
	} `json:"rootfs"`
	Config struct {
		Labels     map[string]string `json:"Labels"`
		Entrypoint []string          `json:"Entrypoint"`
		User       string            `json:"User"`
	} `json:"config"`
}
type layer struct {
	member member
	gzip   bool
}

func (a *archive) descriptor(d descriptor, types ...string) (string, member, error) {
	if !validDigest(d.Digest) || d.Size < 0 || len(d.URLs) != 0 {
		return "", member{}, ErrInvalid
	}
	supported := false
	for _, t := range types {
		if d.MediaType == t {
			supported = true
		}
	}
	if !supported {
		return "", member{}, ErrUnsupported
	}
	name := "blobs/sha256/" + d.Digest[7:]
	m, err := a.lookup(name)
	if err != nil || m.size != d.Size || m.digest != d.Digest {
		return "", member{}, ErrInvalid
	}
	return name, m, nil
}

func (a *archive) selectImage(expected Identity) (imageConfig, []layer, error) {
	var configName string
	var layers []layer
	if _, ok := a.files["oci-layout"]; ok {
		var layout struct {
			Version string `json:"imageLayoutVersion"`
		}
		if _, err := a.metadata("oci-layout", &layout); err != nil {
			return imageConfig{}, nil, err
		}
		if layout.Version != "1.0.0" {
			return imageConfig{}, nil, ErrUnsupported
		}
		var index struct {
			SchemaVersion int          `json:"schemaVersion"`
			Manifests     []descriptor `json:"manifests"`
		}
		if _, err := a.metadata("index.json", &index); err != nil {
			return imageConfig{}, nil, err
		}
		if index.SchemaVersion != 2 || len(index.Manifests) != 1 {
			return imageConfig{}, nil, ErrInvalid
		}
		d := index.Manifests[0]
		name, _, err := a.descriptor(d, "application/vnd.oci.image.manifest.v1+json", "application/vnd.docker.distribution.manifest.v2+json")
		if err != nil {
			return imageConfig{}, nil, err
		}
		if d.Platform != nil && (d.Platform.OS != expected.OS || d.Platform.Architecture != expected.Architecture || d.Platform.Variant != expected.Variant) {
			return imageConfig{}, nil, ErrInvalid
		}
		var manifest struct {
			SchemaVersion int          `json:"schemaVersion"`
			Config        descriptor   `json:"config"`
			Layers        []descriptor `json:"layers"`
		}
		if _, err := a.metadata(name, &manifest); err != nil {
			return imageConfig{}, nil, err
		}
		if manifest.SchemaVersion != 2 || len(manifest.Layers) > MaxEntries {
			return imageConfig{}, nil, ErrInvalid
		}
		configName, _, err = a.descriptor(manifest.Config, "application/vnd.oci.image.config.v1+json", "application/vnd.docker.container.image.v1+json")
		if err != nil {
			return imageConfig{}, nil, err
		}
		for _, d := range manifest.Layers {
			_, m, err := a.descriptor(d, "application/vnd.oci.image.layer.v1.tar", "application/vnd.oci.image.layer.v1.tar+gzip", "application/vnd.docker.image.rootfs.diff.tar", "application/vnd.docker.image.rootfs.diff.tar.gzip")
			if err != nil {
				return imageConfig{}, nil, err
			}
			layers = append(layers, layer{m, strings.HasSuffix(d.MediaType, "gzip")})
		}
		if _, ok := a.files["manifest.json"]; ok {
			var compatibility []dockerManifest
			if _, err := a.metadata("manifest.json", &compatibility); err != nil {
				return imageConfig{}, nil, err
			}
			if len(compatibility) != 1 || len(compatibility[0].Layers) != len(layers) {
				return imageConfig{}, nil, ErrInvalid
			}
			cm, err := a.lookup(compatibility[0].Config)
			if err != nil || cm.digest != manifest.Config.Digest {
				return imageConfig{}, nil, ErrInvalid
			}
			for i, name := range compatibility[0].Layers {
				m, err := a.lookup(name)
				if err != nil || m.digest != layers[i].member.digest {
					return imageConfig{}, nil, ErrInvalid
				}
			}
		}
	} else {
		var manifest []dockerManifest
		if _, err := a.metadata("manifest.json", &manifest); err != nil {
			return imageConfig{}, nil, err
		}
		if len(manifest) != 1 || len(manifest[0].Layers) > MaxEntries {
			return imageConfig{}, nil, ErrInvalid
		}
		configName = manifest[0].Config
		for _, name := range manifest[0].Layers {
			m, err := a.lookup(name)
			if err != nil {
				return imageConfig{}, nil, err
			}
			layers = append(layers, layer{member: m})
		}
	}
	var config imageConfig
	cm, err := a.metadata(configName, &config)
	if err != nil {
		return imageConfig{}, nil, err
	}
	if cm.digest != expected.ID || config.OS != expected.OS || config.Architecture != expected.Architecture || config.Variant != expected.Variant || config.RootFS.Type != "layers" || len(config.RootFS.DiffIDs) != len(layers) {
		return imageConfig{}, nil, ErrInvalid
	}
	for _, d := range config.RootFS.DiffIDs {
		if !validDigest(d) {
			return imageConfig{}, nil, ErrInvalid
		}
	}
	return config, layers, nil
}
