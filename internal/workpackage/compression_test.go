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
	"os"
	"os/exec"
	"regexp"
	"syscall"
	"testing"

	"piwork/internal/contracts"
)

func compressedFixture(t *testing.T) (contracts.PortableWorkSpec, map[string][]byte, []byte) {
	t.Helper()
	raw, original := golden(t, "golden")
	data := fixtureBlobs(raw, original)
	spec, open, cleanup, err := PrepareV2(context.Background(), original.Spec, func(b contracts.WorkBlob) (io.ReadCloser, error) {
		return io.NopCloser(bytes.NewReader(data[string(b.Digest)])), nil
	}, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer cleanup()
	stored := map[string][]byte{}
	for _, b := range spec.Blobs {
		r, err := open(b)
		if err != nil {
			t.Fatal(err)
		}
		v, err := io.ReadAll(r)
		r.Close()
		if err != nil {
			t.Fatal(err)
		}
		stored[string(b.Digest)] = v
	}
	var out bytes.Buffer
	if err := Encode(context.Background(), spec, func(b contracts.WorkBlob) (io.ReadCloser, error) {
		return io.NopCloser(bytes.NewReader(stored[string(b.Digest)])), nil
	}, &out); err != nil {
		t.Fatal(err)
	}
	return spec, stored, out.Bytes()
}
func uncheckedPackage(t *testing.T, spec contracts.PortableWorkSpec, stored map[string][]byte) []byte {
	t.Helper()
	m, err := contracts.EncodeCanonicalJSON(spec)
	if err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	out.WriteString(MagicV2)
	var n [8]byte
	binary.BigEndian.PutUint64(n[:], uint64(len(m)))
	out.Write(n[:])
	out.Write(m)
	for _, b := range spec.Blobs {
		out.Write(stored[string(b.Digest)])
	}
	return out.Bytes()
}
func TestV2MixedPackageRoundTripAndStandardZstd(t *testing.T) {
	spec, stored, raw := compressedFixture(t)
	verified, err := Read(context.Background(), byteReader{bytes.NewReader(raw)}, ReadOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if verified.Size != int64(len(raw)) || verified.Spec.FormatVersion != 2 {
		t.Fatal("physical identity")
	}
	rawCount, zstdCount := 0, 0
	for _, b := range spec.Blobs {
		r, err := verified.Open(bytes.NewReader(raw))(b)
		if err != nil {
			t.Fatal(err)
		}
		value, err := io.ReadAll(r)
		r.Close()
		if err != nil || len(value) != int(b.Size) {
			t.Fatal("original bytes", err)
		}
		if b.Encoding.Value == "raw" {
			rawCount++
			continue
		}
		zstdCount++
		if path, err := exec.LookPath("zstd"); err == nil {
			cmd := exec.Command(path, "-q", "-d", "-c")
			cmd.Stdin = bytes.NewReader(stored[string(b.Digest)])
			result, err := cmd.Output()
			if err != nil || !bytes.Equal(result, value) {
				t.Fatal("standard decoder", err)
			}
			cmd = exec.Command(path, "-q", "-3", "-c")
			cmd.Stdin = bytes.NewReader(value)
			frame, err := cmd.Output()
			if err != nil {
				t.Fatal(err)
			}
			other := b
			other.StoredSize = contracts.Supplied(contracts.WorkByteSize(len(frame)))
			decoded, err := openDecoded(bytes.NewReader(frame), other)
			if err != nil {
				t.Fatal(err)
			}
			result, err = io.ReadAll(decoded)
			decoded.Close()
			if err != nil || !bytes.Equal(result, value) {
				t.Fatal("standard encoder", err)
			}
		}
	}
	if rawCount == 0 || zstdCount == 0 {
		t.Fatal("fixture must exercise both encodings")
	}
}
func TestV2RejectsInvalidFrameAndManifestBoundaries(t *testing.T) {
	for _, kind := range []string{"truncated", "trailing", "skippable", "second-frame", "hash", "length", "missing-encoding", "unknown-encoding", "raw-size"} {
		t.Run(kind, func(t *testing.T) {
			spec, stored, _ := compressedFixture(t)
			for i, b := range spec.Blobs {
				if b.Encoding.Value != "zstd" {
					continue
				}
				key := string(b.Digest)
				frame := append([]byte(nil), stored[key]...)
				switch kind {
				case "truncated":
					frame = frame[:len(frame)-1]
				case "trailing":
					frame = append(frame, 0)
				case "skippable":
					frame = append(frame, 0x50, 0x2a, 0x4d, 0x18, 0, 0, 0, 0)
				case "second-frame":
					frame = append(frame, frame...)
				case "hash":
					frame[len(frame)-1] ^= 1
				case "length":
					b.Size++
				case "missing-encoding":
					b.Encoding = contracts.Field[string]{}
				case "unknown-encoding":
					b.Encoding = contracts.Supplied("gzip")
				case "raw-size":
					b.Encoding = contracts.Supplied("raw")
				}
				b.StoredSize = contracts.Supplied(contracts.WorkByteSize(len(frame)))
				stored[key] = frame
				spec.Blobs[i] = b
				break
			}
			if _, err := Read(context.Background(), bytes.NewReader(uncheckedPackage(t, spec, stored)), ReadOptions{}); err == nil {
				t.Fatal("accepted invalid input")
			}
		})
	}
}
func TestV2DecodedBudgetAndCancellation(t *testing.T) {
	_, _, raw := compressedFixture(t)
	limits := DefaultLimits
	limits.PackageBytes = int64(len(raw)) + 1
	if _, err := Read(context.Background(), bytes.NewReader(raw), ReadOptions{Limits: &limits}); Code(err) != "PACKAGE_LIMIT_EXCEEDED" {
		t.Fatal("decoded budget", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := Read(ctx, bytes.NewReader(raw), ReadOptions{}); err == nil {
		t.Fatal("cancelled read")
	}
}

func TestV2RejectsWindowAndRawOutputExcess(t *testing.T) {
	// Window descriptor 0x80 declares 64 MiB, above the portable 8 MiB cap.
	frame := []byte{0x28, 0xb5, 0x2f, 0xfd, 0, 0x80, 1, 0, 0}
	b := contracts.WorkBlob{Encoding: contracts.Supplied("zstd"), StoredSize: contracts.Supplied(contracts.WorkByteSize(len(frame)))}
	if _, err := openDecoded(bytes.NewReader(frame), b); Code(err) != "PACKAGE_LIMIT_EXCEEDED" {
		t.Fatal("window", err)
	}
	b.Encoding = contracts.Supplied("raw")
	b.Size = 1
	r, err := openDecoded(bytes.NewReader([]byte{1, 2}), b)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = io.ReadAll(r); err == nil {
		t.Fatal("excess output accepted")
	}
	r.Close()
}

func TestV2PublicGoldenAndVersionIsolation(t *testing.T) {
	data, err := os.ReadFile("testdata/golden-v2.work")
	if err != nil {
		t.Fatal(err)
	}
	inspection, inspectErr := Inspect(context.Background(), bytes.NewReader(data), int64(len(data)))
	if inspectErr != nil || !inspection.IntegrityVerified {
		t.Fatal("public fixture must pass offline inspect", inspectErr)
	}
	v, err := Read(context.Background(), bytes.NewReader(data), ReadOptions{})
	if err != nil || v.Spec.FormatVersion != 2 {
		t.Fatal(err)
	}
	data[6] = '1'
	if _, err = Read(context.Background(), bytes.NewReader(data), ReadOptions{}); err == nil {
		t.Fatal("version disagreement")
	}
	raw, old := golden(t, "golden")
	_ = raw
	old.Spec.Blobs[0].Encoding = contracts.Supplied("raw")
	if err = ValidateManifest(old.Spec); err == nil {
		t.Fatal("V1 accepted V2 field")
	}
}

func TestV2PreparationFailureCleansOnlyOwnCandidates(t *testing.T) {
	raw, v := golden(t, "golden")
	data := fixtureBlobs(raw, v)
	for _, cancelled := range []bool{false, true} {
		directory := t.TempDir()
		sentinel := directory + "/keep"
		if err := os.WriteFile(sentinel, []byte("sentinel"), 0600); err != nil {
			t.Fatal(err)
		}
		ctx, cancel := context.WithCancel(context.Background())
		if cancelled {
			cancel()
		}
		defer cancel()
		calls := 0
		_, _, cleanup, err := PrepareV2(ctx, v.Spec, func(b contracts.WorkBlob) (io.ReadCloser, error) {
			calls++
			if !cancelled && calls == 2 {
				return nil, io.ErrUnexpectedEOF
			}
			return io.NopCloser(bytes.NewReader(data[string(b.Digest)])), nil
		}, directory)
		cleanup()
		if err == nil {
			t.Fatal("failed preparation accepted")
		}
		entries, err := os.ReadDir(directory)
		if err != nil || len(entries) != 1 || entries[0].Name() != "keep" {
			t.Fatal("candidate ownership cleanup", entries, err)
		}
	}
}

func TestDecodedSourceUsesCapturedStorageWhenReencoding(t *testing.T) {
	_, _, raw := compressedFixture(t)
	original, err := Read(context.Background(), bytes.NewReader(raw), ReadOptions{})
	if err != nil {
		t.Fatal(err)
	}
	// Source storage belongs to the source package, independent of destination wire metadata.
	legacy := original.Spec
	legacy.FormatVersion = 1
	legacy.Blobs = append([]contracts.WorkBlob(nil), legacy.Blobs...)
	for i := range legacy.Blobs {
		legacy.Blobs[i].Encoding = contracts.Field[string]{}
		legacy.Blobs[i].StoredSize = contracts.Field[contracts.WorkByteSize]{}
	}
	var out bytes.Buffer
	if err = Encode(context.Background(), legacy, original.Open(bytes.NewReader(raw)), &out); err != nil {
		t.Fatal(err)
	}
	decoded, err := Read(context.Background(), bytes.NewReader(out.Bytes()), ReadOptions{})
	if err != nil || decoded.Spec.FormatVersion != 1 {
		t.Fatal(err)
	}
	next, open, cleanup, err := PrepareV2(context.Background(), original.Spec, original.Open(bytes.NewReader(raw)), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer cleanup()
	out.Reset()
	if err = Encode(context.Background(), next, open, &out); err != nil {
		t.Fatal(err)
	}
	if _, err = Read(context.Background(), bytes.NewReader(out.Bytes()), ReadOptions{}); err != nil {
		t.Fatal(err)
	}
}

type diskFullWriter struct{ remaining int }

func (w *diskFullWriter) Write(p []byte) (int, error) {
	if len(p) > w.remaining {
		n := w.remaining
		w.remaining = 0
		return n, syscall.ENOSPC
	}
	w.remaining -= len(p)
	return len(p), nil
}
func TestV2PreservesDiskFailureDuringBodyEncoding(t *testing.T) {
	spec, stored, _ := compressedFixture(t)
	manifest, err := contracts.EncodeCanonicalJSON(spec)
	if err != nil {
		t.Fatal(err)
	}
	sink := &diskFullWriter{remaining: 16 + len(manifest) + 10}
	err = Encode(context.Background(), spec, func(b contracts.WorkBlob) (io.ReadCloser, error) {
		return io.NopCloser(bytes.NewReader(stored[string(b.Digest)])), nil
	}, sink)
	if !errors.Is(err, syscall.ENOSPC) {
		t.Fatal("lost storage failure", err)
	}
}

func TestV2WriterRejectsDecodedBudgetBeforeWriting(t *testing.T) {
	spec, _, _ := compressedFixture(t)
	for i := range spec.Blobs {
		if spec.Blobs[i].Encoding.Value == "zstd" {
			spec.Blobs[i].Size = contracts.WorkByteSize(DefaultLimits.PackageBytes + 1)
			break
		}
	}
	var out bytes.Buffer
	err := Encode(context.Background(), spec, func(contracts.WorkBlob) (io.ReadCloser, error) {
		t.Fatal("oversized source opened")
		return nil, io.ErrUnexpectedEOF
	}, &out)
	if Code(err) != "PACKAGE_LIMIT_EXCEEDED" || out.Len() != 0 {
		t.Fatal("decoded budget not enforced before writing", err, out.Len())
	}
}

func TestFuturePackageMagicReportsUnsupported(t *testing.T) {
	_, _, raw := compressedFixture(t)
	raw[6] = '3'
	if _, err := Read(context.Background(), bytes.NewReader(raw), ReadOptions{}); Code(err) != "PACKAGE_FORMAT_UNSUPPORTED" {
		t.Fatal("future package", err)
	}
	raw[0] = 'X'
	if _, err := Read(context.Background(), bytes.NewReader(raw), ReadOptions{}); Code(err) != "PACKAGE_INVALID" {
		t.Fatal("invalid magic", err)
	}
}

func TestFrozenIndependentZstdFrame(t *testing.T) {
	// zstd CLI 1.5.7, -3 -T1 -c, stdin containing this exact synthetic value.
	original := bytes.Repeat([]byte("portable-work-zstd-reference\n"), 10000)
	frame, err := os.ReadFile("testdata/reference-zstd-1.5.7.frame")
	if err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256(original)
	blob := contracts.WorkBlob{Digest: contracts.WorkBlobDigest(hex.EncodeToString(hash[:])), Size: contracts.WorkByteSize(len(original)), Encoding: contracts.Supplied("zstd"), StoredSize: contracts.Supplied(contracts.WorkByteSize(len(frame)))}
	source, err := openDecoded(bytes.NewReader(frame), blob)
	if err != nil {
		t.Fatal(err)
	}
	defer source.Close()
	actual, err := io.ReadAll(source)
	if err != nil || !bytes.Equal(actual, original) {
		t.Fatal("independent standard frame", err)
	}
}

// The blob opener returns the entire source item, not an unbounded package stream.
func TestEncoderRejectsOverlongSources(t *testing.T) {
	for _, kind := range []string{"v1-raw", "v2-raw", "v2-zstd"} {
		t.Run(kind, func(t *testing.T) {
			var spec contracts.PortableWorkSpec
			var sources map[string][]byte
			if kind == "v1-raw" {
				raw, v := golden(t, "golden")
				spec = v.Spec
				sources = fixtureBlobs(raw, v)
			} else {
				spec, sources, _ = compressedFixture(t)
			}
			target := ""
			for _, b := range spec.Blobs {
				if b.Size > 0 && (kind == "v1-raw" || kind == "v2-raw" && b.Encoding.Value == "raw" || kind == "v2-zstd" && b.Encoding.Value == "zstd") {
					target = string(b.Digest)
					break
				}
			}
			if target == "" {
				t.Fatal("fixture does not exercise requested encoding")
			}
			err := Encode(context.Background(), spec, func(b contracts.WorkBlob) (io.ReadCloser, error) {
				data := sources[string(b.Digest)]
				if string(b.Digest) == target {
					data = append(append([]byte(nil), data...), 0xff)
				}
				return io.NopCloser(bytes.NewReader(data)), nil
			}, io.Discard)
			if err == nil || Code(err) != "PACKAGE_INVALID" {
				t.Fatal("overlong source was accepted", err)
			}
		})
	}
}

type sourceEndError struct{ err error }

func (r sourceEndError) Read([]byte) (int, error) { return 0, r.err }
func TestEncoderPreservesSourceEOFProbeError(t *testing.T) {
	raw, v := golden(t, "golden")
	sources := fixtureBlobs(raw, v)
	sentinel := errors.New("source EOF probe failed")
	err := Encode(context.Background(), v.Spec, func(b contracts.WorkBlob) (io.ReadCloser, error) {
		return io.NopCloser(io.MultiReader(bytes.NewReader(sources[string(b.Digest)]), sourceEndError{sentinel})), nil
	}, io.Discard)
	if !errors.Is(err, sentinel) {
		t.Fatal("EOF probe failure was hidden", err)
	}
}

func TestPublishedTreeExamplesMatchReader(t *testing.T) {
	for _, name := range []string{"README.md", "README.zh-CN.md"} {
		t.Run(name, func(t *testing.T) {
			text, err := os.ReadFile("../../openspec/specs/portable-work/" + name)
			if err != nil {
				t.Fatal(err)
			}
			fences := regexp.MustCompile("(?s)```json\\n(.*?)\\n```").FindAllSubmatch(text, -1)
			empty := sha256.Sum256(nil)
			digest := hex.EncodeToString(empty[:])
			blobs := map[string]contracts.WorkBlob{digest: {Digest: contracts.WorkBlobDigest(digest), Size: 0, Kinds: []string{"file"}}}
			count := 0
			for _, fence := range fences {
				var shape map[string]json.RawMessage
				if err = json.Unmarshal(fence[1], &shape); err != nil {
					t.Fatal("published JSON", err)
				}
				if _, ok := shape["version"]; !ok {
					continue
				}
				count++
				tree, err := ValidateTree(fence[1], blobs, DefaultLimits)
				if err != nil {
					t.Fatal("published tree", err)
				}
				if len(tree.Tree.Entries) != 4 || tree.FileBytes != 0 {
					t.Fatal("tree example changed", tree.FileBytes, len(tree.Tree.Entries))
				}
			}
			if count != 1 {
				t.Fatal("expected one complete tree example", count)
			}
		})
	}
}
