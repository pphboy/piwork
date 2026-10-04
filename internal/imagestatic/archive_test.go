package imagestatic

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"errors"
	"testing"
)

type tarFile struct {
	name string
	data []byte
	mode int64
	kind byte
	link string
}

func makeTar(t *testing.T, files ...tarFile) []byte {
	t.Helper()
	var b bytes.Buffer
	w := tar.NewWriter(&b)
	for _, f := range files {
		kind := f.kind
		if kind == 0 {
			kind = tar.TypeReg
		}
		size := int64(len(f.data))
		if kind != tar.TypeReg {
			size = 0
		}
		if err := w.WriteHeader(&tar.Header{Name: f.name, Size: size, Mode: f.mode, Typeflag: kind, Linkname: f.link}); err != nil {
			t.Fatal(err)
		}
		if kind == tar.TypeReg {
			if _, err := w.Write(f.data); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}
func jsonBytes(t *testing.T, v any) []byte {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return b
}
func digestBytes(b []byte) string { d := sha256.Sum256(b); return hashString(d[:]) }

// A synthetic ELF allows hostile-header tests independent of a host compiler.
// This is only an inspection fixture, never claimed to be runnable Go code.
func minimalELF(machine uint16) []byte {
	b := make([]byte, 128)
	copy(b, "\x7fELF")
	b[4] = 2
	b[5] = 1
	b[6] = 1
	binary.LittleEndian.PutUint16(b[16:], 2)
	binary.LittleEndian.PutUint16(b[18:], machine)
	binary.LittleEndian.PutUint32(b[20:], 1)
	binary.LittleEndian.PutUint64(b[24:], 0x400000)
	binary.LittleEndian.PutUint64(b[32:], 64)
	binary.LittleEndian.PutUint16(b[52:], 64)
	binary.LittleEndian.PutUint16(b[54:], 56)
	binary.LittleEndian.PutUint16(b[56:], 1)
	binary.LittleEndian.PutUint32(b[64:], 1)
	binary.LittleEndian.PutUint32(b[68:], 5)
	binary.LittleEndian.PutUint64(b[80:], 0x400000)
	binary.LittleEndian.PutUint64(b[96:], 128)
	binary.LittleEndian.PutUint64(b[104:], 128)
	return b
}
func nativeLayer(t *testing.T) []byte {
	return makeTar(t, tarFile{name: PackageHelperPath, data: minimalELF(62), mode: 0755}, tarFile{name: ServiceMCPPath, data: minimalELF(62), mode: 0755})
}
func makeImage(t *testing.T, oci, compressed bool, layers [][]byte, alter func(*imageConfig)) ([]byte, Identity) {
	t.Helper()
	var config imageConfig
	config.OS = "linux"
	config.Architecture = "amd64"
	config.RootFS.Type = "layers"
	config.Config.Labels = map[string]string{"io.piwork.agent.protocol": "v2", "io.piwork.package-helper.contract": "2", "io.piwork.service-mcp.contract": "1", "io.piwork.work-history.schema": "4", "io.piwork.run-model.contract": "1", "io.piwork.work-feedback.contract": "1"}
	config.Config.Entrypoint = []string{"node", "/workspace/apps/agentd/dist/main.js"}
	config.Config.User = "10001:10001"
	for _, l := range layers {
		config.RootFS.DiffIDs = append(config.RootFS.DiffIDs, digestBytes(l))
	}
	if alter != nil {
		alter(&config)
	}
	cfg := jsonBytes(t, config)
	id := Identity{digestBytes(cfg), config.OS, config.Architecture, config.Variant}
	if !oci {
		var files []tarFile
		var names []string
		for i, l := range layers {
			name := string(rune('a'+i)) + "/layer.tar"
			names = append(names, name)
			files = append(files, tarFile{name: name, data: l, mode: 0644})
		}
		files = append(files, tarFile{name: "config.json", data: cfg, mode: 0644}, tarFile{name: "manifest.json", data: jsonBytes(t, []dockerManifest{{Config: "config.json", Layers: names}}), mode: 0644})
		return makeTar(t, files...), id
	}
	var files []tarFile
	var descs []descriptor
	for _, l := range layers {
		mediaType := "application/vnd.oci.image.layer.v1.tar"
		data := l
		if compressed {
			var b bytes.Buffer
			z := gzip.NewWriter(&b)
			z.Write(l)
			z.Close()
			data = b.Bytes()
			mediaType += "+gzip"
		}
		d := descriptor{MediaType: mediaType, Digest: digestBytes(data), Size: int64(len(data))}
		descs = append(descs, d)
		files = append(files, tarFile{name: "blobs/sha256/" + d.Digest[7:], data: data, mode: 0644})
	}
	configDescriptor := descriptor{MediaType: "application/vnd.oci.image.config.v1+json", Digest: id.ID, Size: int64(len(cfg))}
	manifest := jsonBytes(t, map[string]any{"schemaVersion": 2, "config": configDescriptor, "layers": descs})
	manifestDescriptor := descriptor{MediaType: "application/vnd.oci.image.manifest.v1+json", Digest: digestBytes(manifest), Size: int64(len(manifest)), Platform: &platform{OS: config.OS, Architecture: config.Architecture, Variant: config.Variant}}
	files = append(files, tarFile{name: "blobs/sha256/" + id.ID[7:], data: cfg, mode: 0644}, tarFile{name: "blobs/sha256/" + manifestDescriptor.Digest[7:], data: manifest, mode: 0644}, tarFile{name: "index.json", data: jsonBytes(t, map[string]any{"schemaVersion": 2, "manifests": []descriptor{manifestDescriptor}}), mode: 0644}, tarFile{name: "oci-layout", data: []byte(`{"imageLayoutVersion":"1.0.0"}`), mode: 0644})
	return makeTar(t, files...), id
}
func inspectTest(t *testing.T, data []byte, id Identity) error {
	t.Helper()
	_, err := InspectNativeAgent(context.Background(), bytes.NewReader(data), int64(len(data)), id)
	return err
}

func TestImmutableDockerAndOCINativeInspection(t *testing.T) {
	for _, test := range []struct {
		name      string
		oci, gzip bool
	}{{"docker", false, false}, {"oci", true, false}, {"oci-gzip", true, true}} {
		t.Run(test.name, func(t *testing.T) {
			data, id := makeImage(t, test.oci, test.gzip, [][]byte{nativeLayer(t)}, nil)
			if err := inspectTest(t, data, id); err != nil {
				t.Fatal(err)
			}
			id.ID = "sha256:" + stringsRepeat("0", 64)
			if err := inspectTest(t, data, id); !errors.Is(err, ErrInvalid) {
				t.Fatal(err)
			}
		})
	}
}
func stringsRepeat(s string, n int) string {
	var b bytes.Buffer
	for i := 0; i < n; i++ {
		b.WriteString(s)
	}
	return b.String()
}

func TestWhiteoutsMergedBeforeNewLayerEntries(t *testing.T) {
	base := nativeLayer(t)
	for _, test := range []struct {
		name    string
		entries []tarFile
		pass    bool
	}{
		{"leaf-deleted", []tarFile{{name: "usr/local/bin/.wh.piwork-package-helper"}}, false},
		{"directory-deleted", []tarFile{{name: "usr/local/.wh.bin"}}, false},
		{"opaque-directory", []tarFile{{name: "usr/local/bin/.wh..wh..opq"}}, false},
		{"opaque-root", []tarFile{{name: ".wh..wh..opq"}}, false},
		{"leaf-replaced-before-whiteout", []tarFile{{name: PackageHelperPath, data: minimalELF(62), mode: 0755}, {name: "usr/local/bin/.wh.piwork-package-helper"}}, true},
		{"opaque-with-both-new-files-first", []tarFile{{name: PackageHelperPath, data: minimalELF(62), mode: 0755}, {name: ServiceMCPPath, data: minimalELF(62), mode: 0755}, {name: "usr/local/bin/.wh..wh..opq"}}, true},
		{"parent-symlink", []tarFile{{name: "usr/local/bin", kind: tar.TypeSymlink, link: "/tmp/elsewhere"}}, false},
		{"parent-file", []tarFile{{name: "usr/local/bin", data: []byte("file"), mode: 0644}}, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			data, id := makeImage(t, false, false, [][]byte{base, makeTar(t, test.entries...)}, nil)
			err := inspectTest(t, data, id)
			if test.pass && err != nil {
				t.Fatal(err)
			}
			if !test.pass && !errors.Is(err, ErrIncompatible) {
				t.Fatal(err)
			}
		})
	}
	// Removing the old implementation in a later layer removes its incompatibility.
	old := makeTar(t, tarFile{name: "workspace/apps/package-helper/dist/main.js", data: []byte("#!/usr/bin/env node"), mode: 0755})
	removed := makeTar(t, tarFile{name: "workspace/apps/.wh.package-helper"})
	data, id := makeImage(t, false, false, [][]byte{base, old}, nil)
	if err := inspectTest(t, data, id); !errors.Is(err, ErrIncompatible) {
		t.Fatal(err)
	}
	data, id = makeImage(t, false, false, [][]byte{base, old, removed}, nil)
	if err := inspectTest(t, data, id); err != nil {
		t.Fatal(err)
	}
}

func TestFalseCapabilitiesAndELFPlatformRefused(t *testing.T) {
	for _, test := range []struct {
		name  string
		files []tarFile
		alter func(*imageConfig)
	}{
		{"ts-launcher", []tarFile{{name: PackageHelperPath, data: []byte("#!/usr/bin/env node\n"), mode: 0755}, {name: ServiceMCPPath, data: minimalELF(62), mode: 0755}}, nil},
		{"missing-file", []tarFile{{name: ServiceMCPPath, data: minimalELF(62), mode: 0755}}, nil},
		{"non-executable", []tarFile{{name: PackageHelperPath, data: minimalELF(62), mode: 0644}, {name: ServiceMCPPath, data: minimalELF(62), mode: 0755}}, nil},
		{"wrong-elf-platform", []tarFile{{name: PackageHelperPath, data: minimalELF(183), mode: 0755}, {name: ServiceMCPPath, data: minimalELF(62), mode: 0755}}, nil},
		{"symlink-launcher", []tarFile{{name: PackageHelperPath, kind: tar.TypeSymlink, link: "/workspace/helper.js"}, {name: ServiceMCPPath, data: minimalELF(62), mode: 0755}}, nil},
		{"hardlink-launcher", []tarFile{{name: PackageHelperPath, kind: tar.TypeLink, link: ServiceMCPPath}, {name: ServiceMCPPath, data: minimalELF(62), mode: 0755}}, nil},
		{"wrong-label", nil, func(c *imageConfig) { c.Config.Labels["io.piwork.package-helper.contract"] = "1" }},
	} {
		t.Run(test.name, func(t *testing.T) {
			l := nativeLayer(t)
			if test.files != nil {
				l = makeTar(t, test.files...)
			}
			data, id := makeImage(t, false, false, [][]byte{l}, test.alter)
			if err := inspectTest(t, data, id); !errors.Is(err, ErrIncompatible) {
				t.Fatal(err)
			}
		})
	}
}

func TestBoundedELFHeaderAndDynamicDependencies(t *testing.T) {
	base := minimalELF(62)
	if !inspectELF(bytes.NewReader(base), int64(len(base)), "amd64") {
		t.Fatal("valid synthetic static ELF rejected")
	}
	for _, alter := range []func([]byte){func(b []byte) { binary.LittleEndian.PutUint64(b[32:], ^uint64(0)) }, func(b []byte) { binary.LittleEndian.PutUint16(b[56:], 65535) }, func(b []byte) { binary.LittleEndian.PutUint64(b[96:], 1<<63) }, func(b []byte) { binary.LittleEndian.PutUint32(b[64:], 3) }, func(b []byte) { b[5] = 2 }} {
		b := append([]byte(nil), base...)
		alter(b)
		if inspectELF(bytes.NewReader(b), int64(len(b)), "amd64") {
			t.Fatal("hostile ELF accepted")
		}
	}
	// Second program segment has a DT_NEEDED dependency; no dynamic table
	// allocation uses its claimed length. A DT_NULL-only PIE is permitted.
	b := make([]byte, 192)
	copy(b, base)
	binary.LittleEndian.PutUint16(b[56:], 2)
	binary.LittleEndian.PutUint32(b[120:], 2)
	binary.LittleEndian.PutUint64(b[128:], 176)
	binary.LittleEndian.PutUint64(b[152:], 16)
	binary.LittleEndian.PutUint64(b[176:], 1)
	if inspectELF(bytes.NewReader(b), int64(len(b)), "amd64") {
		t.Fatal("DT_NEEDED accepted")
	}
	binary.LittleEndian.PutUint64(b[176:], 0)
	if !inspectELF(bytes.NewReader(b), int64(len(b)), "amd64") {
		t.Fatal("dependency-free dynamic table rejected")
	}
}

func TestArchiveBoundsIdentityAndTail(t *testing.T) {
	data, id := makeImage(t, false, false, [][]byte{nativeLayer(t)}, nil)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := InspectNativeAgent(ctx, bytes.NewReader(data), int64(len(data)), id); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	if _, err := InspectNativeAgent(context.Background(), bytes.NewReader(nil), MaxArchiveBytes+512, id); !errors.Is(err, ErrLimit) {
		t.Fatal(err)
	}
	for _, bad := range [][]byte{data[:len(data)-1], append(append([]byte(nil), data...), bytes.Repeat([]byte{'x'}, 512)...)} {
		if err := inspectTest(t, bad, id); !errors.Is(err, ErrInvalid) {
			t.Fatal(err)
		}
	}
	corrupt := append([]byte(nil), data...)
	corrupt[0] ^= 1
	if err := inspectTest(t, corrupt, id); !errors.Is(err, ErrInvalid) {
		t.Fatal(err)
	}
	data, id = makeImage(t, false, false, [][]byte{nativeLayer(t)}, func(c *imageConfig) { c.RootFS.DiffIDs[0] = "sha256:" + stringsRepeat("0", 64) })
	if err := inspectTest(t, data, id); !errors.Is(err, ErrInvalid) {
		t.Fatal(err)
	}
	for _, badPath := range []string{"../escape", "/absolute", "usr//local/bin/file", "usr/local/../bin/file", "usr\\local"} {
		l := makeTar(t, tarFile{name: badPath, data: []byte("x")})
		data, id = makeImage(t, false, false, [][]byte{nativeLayer(t), l}, nil)
		if err := inspectTest(t, data, id); !errors.Is(err, ErrInvalid) {
			t.Fatalf("%s: %v", badPath, err)
		}
	}
	// A valid PAX long name in an irrelevant image branch is safe, but still
	// counted/bounded before the standard tar parser interprets it.
	long := stringsRepeat("a", 200)
	l := makeTar(t, tarFile{name: "opt/" + long, data: []byte("x"), mode: 0644})
	data, id = makeImage(t, false, false, [][]byte{nativeLayer(t), l}, nil)
	if err := inspectTest(t, data, id); err != nil {
		t.Fatal(err)
	}
}
