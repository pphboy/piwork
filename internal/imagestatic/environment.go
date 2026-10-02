package imagestatic

import (
	"archive/tar"
	"bytes"
	"encoding/json"
	"path"
	"piwork/internal/contracts"
	"regexp"
)

const nodeVersionPath = "usr/local/include/node/node_version.h"
const sdkManifestPath = "workspace/node_modules/@earendil-works/pi-coding-agent/package.json"

var nodeABI = regexp.MustCompile(`(?m)^\s*#\s*define\s+NODE_MODULE_VERSION\s+([0-9]+)\s*$`)
var sdkVersion = regexp.MustCompile(`^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?$`)

// Inspect the final, hashed image tree. No executable or image label supplies
// the package environment; whiteouts and replaced parents have already applied.
func (s *layerState) packageEnvironment(identity Identity) *contracts.PiPackagePreparedEnvironment {
	read := func(name string) []byte {
		n, ok := s.nodes[name]
		if !ok || n.kind != tar.TypeReg {
			return nil
		}
		for p := path.Dir(name); p != "."; p = path.Dir(p) {
			if s.nodes[p].kind != tar.TypeDir {
				return nil
			}
		}
		return n.data
	}
	abi := nodeABI.FindSubmatch(read(nodeVersionPath))
	if len(abi) != 2 {
		return nil
	}
	parsed, err := contracts.ParseJSON(bytes.NewReader(read(sdkManifestPath)), 1<<20)
	if err != nil {
		return nil
	}
	object, ok := parsed.(map[string]any)
	if !ok {
		return nil
	}
	version, ok := object["version"].(string)
	if !ok || !sdkVersion.MatchString(version) {
		return nil
	}
	var variant json.RawMessage = json.RawMessage(`null`)
	if identity.Variant != "" {
		variant, _ = json.Marshal(identity.Variant)
	}
	return &contracts.PiPackagePreparedEnvironment{Os: identity.OS, Architecture: identity.Architecture, Variant: variant, NodeAbi: string(abi[1]), PiSdkVersion: version}
}
