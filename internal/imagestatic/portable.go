package imagestatic

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"io"
	"strings"

	"piwork/internal/contracts"
)

// PortableLayer is an uncompressed V1 layer in an already bounded source.
// It is inspected in place; no pathname is extracted or passed to Docker.
type PortableLayer struct {
	Reader io.ReaderAt
	Size   int64
}

func InspectPortableImage(ctx context.Context, raw []byte, layers []PortableLayer, expected Identity, agent bool) (Capabilities, error) {
	if !validDigest(expected.ID) || expected.OS != "linux" || expected.Architecture == "" {
		return Capabilities{}, ErrInvalid
	}
	if int64(len(raw)) > MaxMetadataBytes || len(layers) > MaxEntries {
		return Capabilities{}, ErrLimit
	}
	hash := sha256.Sum256(raw)
	if hashString(hash[:]) != expected.ID {
		return Capabilities{}, ErrInvalid
	}
	parsed, err := contracts.ParseJSON(bytes.NewReader(raw), MaxMetadataBytes)
	if err != nil {
		return Capabilities{}, ErrInvalid
	}
	canonical, err := json.Marshal(parsed)
	if err != nil {
		return Capabilities{}, ErrInvalid
	}
	var config imageConfig
	if json.Unmarshal(canonical, &config) != nil || config.OS != expected.OS || config.Architecture != expected.Architecture || config.Variant != expected.Variant || config.RootFS.Type != "layers" || len(config.RootFS.DiffIDs) != len(layers) {
		return Capabilities{}, ErrInvalid
	}
	if agent && (config.Config.Labels["io.piwork.agent.protocol"] != "v2" || config.Config.Labels["io.piwork.package-helper.contract"] != "2" || config.Config.Labels["io.piwork.service-mcp.contract"] != "1") {
		return Capabilities{}, ErrIncompatible
	}
	state, budget := newLayerState(), &layerBudget{}
	for i, source := range layers {
		if source.Reader == nil || source.Size < 0 || source.Size > MaxArchiveBytes || !validDigest(config.RootFS.DiffIDs[i]) {
			return Capabilities{}, ErrInvalid
		}
		a := archive{ctx: ctx, reader: source.Reader}
		if err := a.applyLayer(layer{member: member{size: source.Size}}, config.RootFS.DiffIDs[i], expected.Architecture, state, budget); err != nil {
			return Capabilities{}, err
		}
	}
	result := Capabilities{Identity: expected}
	if !agent {
		return result, nil
	}
	for name := range state.nodes {
		for _, prefix := range forbiddenPrefixes {
			if name == prefix || strings.HasPrefix(name, prefix+"/") {
				return Capabilities{}, ErrIncompatible
			}
		}
	}
	if !state.nativeFile(PackageHelperPath) || !state.nativeFile(ServiceMCPPath) {
		return Capabilities{}, ErrIncompatible
	}
	result.PackageHelper, result.ServiceMCP = true, true
	result.Environment = state.packageEnvironment(expected)
	result.PackageHelperSHA256 = state.nodes[PackageHelperPath].digest
	result.ServiceMCPSHA256 = state.nodes[ServiceMCPPath].digest
	return result, nil
}
