package workpackage

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"io"
	"os"
	"testing"

	"piwork/internal/contracts"
)

type byteReader struct{ source io.Reader }

func (r byteReader) Read(p []byte) (int, error) {
	if len(p) > 1 {
		p = p[:1]
	}
	return r.source.Read(p)
}
func golden(t *testing.T, name string) ([]byte, Verified) {
	t.Helper()
	data, err := os.ReadFile("testdata/" + name + ".work")
	if err != nil {
		t.Fatal(err)
	}
	verified, err := Read(context.Background(), bytes.NewReader(data), ReadOptions{})
	if err != nil {
		t.Fatal(name, err, Code(err))
	}
	return data, verified
}

func TestV1GoldenPackagesRoundTripByteForByte(t *testing.T) {
	var summaries []struct {
		Name   string
		Size   int64
		Digest string
	}
	raw, err := os.ReadFile("testdata/golden-summary.json")
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, &summaries); err != nil {
		t.Fatal(err)
	}
	for _, expected := range summaries {
		t.Run(expected.Name, func(t *testing.T) {
			data, verified := golden(t, expected.Name)
			if verified.Size != expected.Size || verified.Digest != expected.Digest || verified.EntryCount != 7 {
				t.Fatal(verified.Size, verified.Digest, verified.EntryCount, expected)
			}
			if expected.Name == "golden" && (expected.Size != 4201 || expected.Digest != "6e35ee29a5fc1b2de8d77832f773bf902f73f051851e6c7a4ad33b94fc7eb3e6") {
				t.Fatal("Current Go golden contract changed", expected)
			}
			streamed, err := Read(context.Background(), byteReader{bytes.NewReader(data)}, ReadOptions{})
			if err != nil || streamed.Digest != verified.Digest {
				t.Fatal("one byte stream", streamed.Digest, err)
			}
			var encoded bytes.Buffer
			err = Encode(context.Background(), verified.Spec, func(blob contracts.WorkBlob) (io.ReadCloser, error) {
				offset := verified.Offsets[string(blob.Digest)]
				return io.NopCloser(bytes.NewReader(data[offset : offset+int64(blob.Size)])), nil
			}, &encoded)
			if err != nil || !bytes.Equal(encoded.Bytes(), data) {
				t.Fatal("Current framing roundtrip differs", err, encoded.Len(), len(data))
			}
		})
	}
}
func TestCurrentManifestAndTreeValidationCases(t *testing.T) {
	_, verified := golden(t, "golden")
	blobs := map[string]contracts.WorkBlob{}
	for _, blob := range verified.Spec.Blobs {
		blobs[string(blob.Digest)] = blob
	}
	for _, kind := range []string{"manifest", "tree"} {
		raw, err := os.ReadFile("testdata/" + kind + "-cases.json")
		if err != nil {
			t.Fatal(err)
		}
		var cases []struct {
			Name, JSON string
			Code       *string
		}
		if err := json.Unmarshal(raw, &cases); err != nil {
			t.Fatal(err)
		}
		for _, test := range cases {
			t.Run(kind+"/"+test.Name, func(t *testing.T) {
				var err error
				if kind == "manifest" {
					_, err = DecodeManifest([]byte(test.JSON))
				} else {
					_, err = ValidateTree([]byte(test.JSON), blobs, DefaultLimits)
				}
				if test.Code == nil {
					if err != nil {
						t.Fatal("Current contract rejected valid fixture", err, Code(err))
					}
				} else if err == nil || Code(err) != *test.Code {
					t.Fatal("Current rejection mismatch", test.Code, Code(err), err)
				}
			})
		}
	}
}
func TestV1FramingRejectsTruncationTrailingHashAndUnsafeJSON(t *testing.T) {
	data, verified := golden(t, "golden")
	badMagic := append([]byte(nil), data...)
	badMagic[0] = 'X'
	badLength := append([]byte(nil), data...)
	binary.BigEndian.PutUint64(badLength[8:16], uint64(DefaultLimits.MetadataBytes+1))
	badHash := append([]byte(nil), data...)
	badHash[len(badHash)-1] ^= 1
	for _, test := range []struct {
		name  string
		bytes []byte
		code  string
	}{{"magic", badMagic, "PACKAGE_INVALID"}, {"header-short", data[:12], "PACKAGE_INVALID"}, {"body-short", data[:len(data)-1], "PACKAGE_INVALID"}, {"trailing", append(append([]byte(nil), data...), 0), "PACKAGE_INVALID"}, {"hash", badHash, "PACKAGE_INVALID"}, {"manifest-limit", badLength, "PACKAGE_LIMIT_EXCEEDED"}} {
		t.Run(test.name, func(t *testing.T) {
			_, err := Read(context.Background(), bytes.NewReader(test.bytes), ReadOptions{})
			if err == nil || Code(err) != test.code {
				t.Fatal(Code(err), err)
			}
		})
	}
	for _, raw := range [][]byte{[]byte(`{"formatVersion":1,"formatVersion":1}`), []byte(`{"\u0061":1,"a":2}`), []byte(`{"number":9007199254740992}`), {255}, []byte(`{"number":1.25}`)} {
		if _, err := DecodeManifest(raw); err == nil {
			t.Fatal("unsafe JSON accepted", raw)
		}
	}
	if _, err := Read(context.Background(), bytes.NewReader(data), ReadOptions{OnBlob: func(contracts.WorkBlob, io.Reader) error { return nil }}); err == nil {
		t.Fatal("unconsumed blob accepted")
	}
	_, err := Read(context.Background(), bytes.NewReader(data), ReadOptions{Limits: &Limits{PackageBytes: DefaultLimits.PackageBytes, RestoredBytes: 1, MetadataBytes: DefaultLimits.MetadataBytes, TotalMetadataBytes: DefaultLimits.TotalMetadataBytes, Entries: DefaultLimits.Entries, PathBytes: DefaultLimits.PathBytes, Depth: DefaultLimits.Depth}})
	if Code(err) != "PACKAGE_LIMIT_EXCEEDED" {
		t.Fatal("logical restoration bypassed limits", err)
	}
	manifest := verified.Spec
	manifest.Contexts = append(manifest.Contexts, manifest.Contexts[0])
	if err := Encode(context.Background(), manifest, nil, io.Discard); err == nil {
		t.Fatal("bad manifest encoded")
	}
}
func TestV1CancellationAndSourceHashFailureDoNotPublishSuccess(t *testing.T) {
	data, verified := golden(t, "golden")
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := Read(ctx, bytes.NewReader(data), ReadOptions{}); err == nil {
		t.Fatal("cancelled read accepted")
	}
	err := Encode(context.Background(), verified.Spec, func(blob contracts.WorkBlob) (io.ReadCloser, error) {
		if blob.Size == 0 {
			return io.NopCloser(bytes.NewReader(nil)), nil
		}
		return io.NopCloser(bytes.NewReader(bytes.Repeat([]byte{0}, int(blob.Size)))), nil
	}, io.Discard)
	if Code(err) != "PACKAGE_INVALID" {
		t.Fatal("bad source hash encoded successfully", err)
	}
}

func TestManifestRejectsForgedOwnerAuthority(t *testing.T) {
	_, verified := golden(t, "golden")
	raw, err := json.Marshal(verified.Spec)
	if err != nil {
		t.Fatal(err)
	}
	var object map[string]any
	if err := json.Unmarshal(raw, &object); err != nil {
		t.Fatal(err)
	}
	object["ownerId"] = "administrator"
	raw, _ = json.Marshal(object)
	if _, err := DecodeManifest(raw); err == nil {
		t.Fatal("forged owner authority accepted")
	}
}
