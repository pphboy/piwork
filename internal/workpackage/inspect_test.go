package workpackage

import (
	"archive/tar"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"sort"
	"testing"

	"piwork/internal/contracts"
	"piwork/internal/imagestatic"
)

func hashBytes(raw []byte) string { hash := sha256.Sum256(raw); return hex.EncodeToString(hash[:]) }
func fixtureBlobs(data []byte, verified Verified) map[string][]byte {
	result := map[string][]byte{}
	for _, blob := range verified.Spec.Blobs {
		at := verified.Offsets[string(blob.Digest)]
		result[string(blob.Digest)] = data[at : at+int64(blob.Size)]
	}
	return result
}
func encodeFixture(t *testing.T, spec contracts.PortableWorkSpec, data map[string][]byte) []byte {
	t.Helper()
	var buffer bytes.Buffer
	if err := Encode(context.Background(), spec, func(blob contracts.WorkBlob) (io.ReadCloser, error) {
		return io.NopCloser(bytes.NewReader(data[string(blob.Digest)])), nil
	}, &buffer); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}
func appendFixtureBlob(spec *contracts.PortableWorkSpec, data map[string][]byte, raw []byte, kind string) string {
	digest := hashBytes(raw)
	data[digest] = raw
	spec.Blobs = append(spec.Blobs, contracts.WorkBlob{Digest: contracts.WorkBlobDigest(digest), Size: contracts.WorkByteSize(len(raw)), Kinds: []string{kind}})
	sort.Slice(spec.Blobs, func(i, j int) bool { return spec.Blobs[i].Digest < spec.Blobs[j].Digest })
	return digest
}
func syntheticELF() []byte {
	raw := make([]byte, 128)
	copy(raw, "\x7fELF")
	raw[4], raw[5], raw[6] = 2, 1, 1
	binary.LittleEndian.PutUint16(raw[16:], 2)
	binary.LittleEndian.PutUint16(raw[18:], 62)
	binary.LittleEndian.PutUint32(raw[20:], 1)
	binary.LittleEndian.PutUint64(raw[24:], 0x400000)
	binary.LittleEndian.PutUint64(raw[32:], 64)
	binary.LittleEndian.PutUint16(raw[52:], 64)
	binary.LittleEndian.PutUint16(raw[54:], 56)
	binary.LittleEndian.PutUint16(raw[56:], 1)
	binary.LittleEndian.PutUint32(raw[64:], 1)
	binary.LittleEndian.PutUint32(raw[68:], 5)
	binary.LittleEndian.PutUint64(raw[80:], 0x400000)
	binary.LittleEndian.PutUint64(raw[96:], 128)
	binary.LittleEndian.PutUint64(raw[104:], 128)
	return raw
}

// Test archive content is never executed and does not claim Go provenance.
func fixtureLayer(t *testing.T, entries map[string][]byte) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := tar.NewWriter(&buffer)
	var names []string
	for name := range entries {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		raw := entries[name]
		if err := writer.WriteHeader(&tar.Header{Name: name, Mode: 0755, Size: int64(len(raw))}); err != nil {
			t.Fatal(err)
		}
		if _, err := writer.Write(raw); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}
func nativeFixture(t *testing.T, base string, layers [][]byte, labels map[string]string) []byte {
	t.Helper()
	raw, verified := golden(t, base)
	data := fixtureBlobs(raw, verified)
	spec := verified.Spec
	image := &spec.Images[0]
	old := map[string]bool{string(image.Config): true}
	for _, layer := range image.Layers {
		old[string(layer)] = true
	}
	var kept []contracts.WorkBlob
	for _, blob := range spec.Blobs {
		if !old[string(blob.Digest)] {
			kept = append(kept, blob)
		}
	}
	spec.Blobs = kept
	image.Layers = nil
	var diffIDs []string
	for _, layer := range layers {
		digest := appendFixtureBlob(&spec, data, layer, "image-layer")
		image.Layers = append(image.Layers, contracts.WorkBlobDigest(digest))
		diffIDs = append(diffIDs, "sha256:"+digest)
	}
	config, err := json.Marshal(map[string]any{"os": "linux", "architecture": "amd64", "rootfs": map[string]any{"type": "layers", "diff_ids": diffIDs}, "config": map[string]any{"Labels": labels}})
	if err != nil {
		t.Fatal(err)
	}
	digest := appendFixtureBlob(&spec, data, config, "image-config")
	image.Config = contracts.WorkBlobDigest(digest)
	image.ImageId = contracts.Digest("sha256:" + digest)
	return encodeFixture(t, spec, data)
}
func nativeLabels() map[string]string {
	return map[string]string{"io.piwork.agent.protocol": "v2", "io.piwork.package-helper.contract": "2", "io.piwork.service-mcp.contract": "1"}
}
func TestOfflineInspectionChecksActualNativeImageAndKeepsSummarySafe(t *testing.T) {
	layer := fixtureLayer(t, map[string][]byte{imagestatic.PackageHelperPath: syntheticELF(), imagestatic.ServiceMCPPath: syntheticELF(), "workspace/user-data/private-key": []byte("SECRET-CONTENT")})
	raw := nativeFixture(t, "golden-pi-package", [][]byte{layer}, nativeLabels())
	summary, err := Inspect(context.Background(), bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		t.Fatal(err, Code(err))
	}
	if !summary.IntegrityVerified || summary.InstallationValidated || summary.Counts.Packages != 1 || len(summary.Packages) != 1 {
		t.Fatal(summary)
	}
	jsonBytes, err := json.Marshal(summary)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(jsonBytes, []byte("SECRET-CONTENT")) || bytes.Contains(jsonBytes, []byte("private-key")) || bytes.Contains(jsonBytes, []byte("sourceWorkId")) || bytes.Contains(jsonBytes, []byte("Contexts")) {
		t.Fatal("private or incompatible summary", string(jsonBytes))
	}
	for _, test := range []struct {
		name   string
		layers [][]byte
		labels map[string]string
	}{
		{"missing-label", [][]byte{layer}, map[string]string{}},
		{"TS-launcher", [][]byte{fixtureLayer(t, map[string][]byte{imagestatic.PackageHelperPath: []byte("#!/usr/bin/env node"), imagestatic.ServiceMCPPath: syntheticELF()})}, nativeLabels()},
		{"whiteout", [][]byte{layer, fixtureLayer(t, map[string][]byte{"usr/local/bin/.wh.piwork-package-helper": {}})}, nativeLabels()},
		{"legacy-branch", [][]byte{layer, fixtureLayer(t, map[string][]byte{"workspace/apps/package-helper/dist/main.js": []byte("code")})}, nativeLabels()},
	} {
		t.Run(test.name, func(t *testing.T) {
			raw := nativeFixture(t, "golden", test.layers, test.labels)
			_, err := Inspect(context.Background(), bytes.NewReader(raw), int64(len(raw)))
			if err == nil || Code(err) != "PACKAGE_INCOMPATIBLE" {
				t.Fatal(Code(err), err)
			}
		})
	}
}
func TestPackageContentDigestAndTargetAreCheckedIndependently(t *testing.T) {
	raw, verified := golden(t, "golden-pi-package")
	if err := ValidatePackageContent(context.Background(), verified, verified.Open(bytes.NewReader(raw))); err != nil {
		t.Fatal(err)
	}
	platform := contracts.WorkImagePlatform{Os: "linux", Architecture: "amd64", Variant: json.RawMessage("null")}
	environment := verified.Spec.PiPackageArtifacts[0].PreparedEnvironment
	imageKey := string(verified.Spec.Contexts[0].ImageKey)
	if err := ValidateTarget(verified.Spec, platform, map[string]contracts.PiPackagePreparedEnvironment{imageKey: environment}); err != nil {
		t.Fatal(err)
	}
	for _, change := range []func(*contracts.PiPackagePreparedEnvironment){func(e *contracts.PiPackagePreparedEnvironment) { e.NodeAbi = "136" }, func(e *contracts.PiPackagePreparedEnvironment) { e.PiSdkVersion = "0.86.1" }, func(e *contracts.PiPackagePreparedEnvironment) { e.Architecture = "arm64" }} {
		actual := environment
		change(&actual)
		if err := ValidateTarget(verified.Spec, platform, map[string]contracts.PiPackagePreparedEnvironment{imageKey: actual}); Code(err) != "PACKAGE_INCOMPATIBLE" {
			t.Fatal(err)
		}
	}
	// A forged declared identity cannot hide behind a valid framing/blob hash.
	verified.Spec.PiPackageArtifacts[0].ContentDigest = contracts.Digest("sha256:" + string(bytes.Repeat([]byte{'0'}, 64)))
	if err := ValidatePackageContent(context.Background(), verified, verified.Open(bytes.NewReader(raw))); Code(err) != "PACKAGE_INVALID" {
		t.Fatal(err)
	}
}

type shortWriter struct{}

func (shortWriter) Write(raw []byte) (int, error) { return len(raw) - 1, nil }
func TestEncoderRejectsShortHeaderWrites(t *testing.T) {
	_, verified := golden(t, "golden")
	if err := Encode(context.Background(), verified.Spec, nil, shortWriter{}); !errors.Is(err, io.ErrShortWrite) {
		t.Fatal(err)
	}
}
