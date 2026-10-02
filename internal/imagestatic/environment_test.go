package imagestatic

import (
	"archive/tar"
	"bytes"
	"context"
	"testing"
)

func TestFinalImageEnvironmentIsBoundedAndHonorsWhiteoutsAndParentReplacement(t *testing.T) {
	environment := makeTar(t, tarFile{name: nodeVersionPath, data: []byte("#define NODE_MODULE_VERSION 137\n"), mode: 0644}, tarFile{name: sdkManifestPath, data: []byte(`{"name":"@earendil-works/pi-coding-agent","version":"0.86.1"}`), mode: 0644})
	for _, scenario := range []struct {
		name      string
		last      []byte
		available bool
	}{{"ordinary", nil, true}, {"whiteout-sdk", makeTar(t, tarFile{name: "workspace/node_modules/@earendil-works/pi-coding-agent/.wh.package.json", mode: 0644}), false}, {"replace-parent", makeTar(t, tarFile{name: "usr/local/include/node", kind: tar.TypeSymlink, link: "/outside", mode: 0777}), false}, {"invalid-abi", makeTar(t, tarFile{name: nodeVersionPath, data: []byte("#define NODE_MODULE_VERSION unsafe"), mode: 0644}), false}} {
		t.Run(scenario.name, func(t *testing.T) {
			layers := [][]byte{nativeLayer(t), environment}
			if scenario.last != nil {
				layers = append(layers, scenario.last)
			}
			archive, id := makeImage(t, false, false, layers, nil)
			caps, err := InspectNativeAgent(context.Background(), bytes.NewReader(archive), int64(len(archive)), id)
			if err != nil {
				t.Fatal(err)
			}
			if (caps.Environment != nil) != scenario.available {
				t.Fatal(caps.Environment)
			}
			if caps.Environment != nil && (caps.Environment.NodeAbi != "137" || caps.Environment.PiSdkVersion != "0.86.1") {
				t.Fatal(caps.Environment)
			}
		})
	}
}
