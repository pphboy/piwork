package imagestatic

import (
	"archive/tar"
	"bytes"
	"context"
	"errors"
	"testing"
)

func TestNativeFileHelperStaticCapabilityRejectsLegacyAndDeletedEntries(t *testing.T) {
	for _, fixture := range []struct {
		name   string
		layers [][]byte
		label  string
		valid  bool
	}{
		{"native", [][]byte{makeTar(t, tarFile{name: FileHelperPath, data: minimalELF(62), mode: 0555})}, "1", true},
		{"python", [][]byte{makeTar(t, tarFile{name: FileHelperPath, data: []byte("#!/usr/bin/python3\n"), mode: 0555})}, "1", false},
		{"missing-label", [][]byte{makeTar(t, tarFile{name: FileHelperPath, data: minimalELF(62), mode: 0555})}, "", false},
		{"whiteout", [][]byte{makeTar(t, tarFile{name: FileHelperPath, data: minimalELF(62), mode: 0555}), makeTar(t, tarFile{name: "usr/local/bin/.wh.piwork-file-helper", mode: 0600})}, "1", false},
		{"symlink", [][]byte{makeTar(t, tarFile{name: FileHelperPath, kind: tar.TypeSymlink, link: "python3", mode: 0555})}, "1", false},
		{"legacy-source", [][]byte{makeTar(t, tarFile{name: FileHelperPath, data: minimalELF(62), mode: 0555}, tarFile{name: "opt/piwork/file-helper/main.py", data: []byte("pass"), mode: 0644})}, "1", false},
		{"node-runtime", [][]byte{makeTar(t, tarFile{name: FileHelperPath, data: minimalELF(62), mode: 0555}, tarFile{name: "usr/local/bin/node", data: minimalELF(62), mode: 0555})}, "1", false},
	} {
		t.Run(fixture.name, func(t *testing.T) {
			data, id := makeImage(t, true, true, fixture.layers, func(config *imageConfig) {
				config.Config.Labels = map[string]string{"piwork.file_protocol": fixture.label}
				config.Config.Entrypoint = []string{"/" + FileHelperPath}
			})
			capability, err := InspectNativeHelper(context.Background(), bytes.NewReader(data), int64(len(data)), id, "file")
			if fixture.valid {
				if err != nil || !capability.FileHelper || capability.FileHelperSHA256 == "" {
					t.Fatal(capability, err)
				}
			} else if !errors.Is(err, ErrIncompatible) {
				t.Fatal("unsupported helper accepted", capability, err)
			}
		})
	}
}
