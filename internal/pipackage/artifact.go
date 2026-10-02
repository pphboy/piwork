package pipackage

import (
	"bytes"
	"encoding/json"
	"piwork/internal/contracts"
	"regexp"
	"strings"
)

var privateSource = regexp.MustCompile(`://[^/]*@`)
var ErrEnvironment = &InputError{"PI_PACKAGE_ENVIRONMENT_MISMATCH"}

type Artifact struct {
	Metadata      contracts.PiPackageArtifactMetadata `json:"metadata"`
	Inventory     Inventory                           `json:"inventory"`
	EntryCount    int                                 `json:"entryCount"`
	RestoredBytes int64                               `json:"restoredBytes"`
}

func ValidateEnvironment(raw []byte) (contracts.PiPackagePreparedEnvironment, error) {
	result, err := contracts.Decode[contracts.PiPackagePreparedEnvironment](bytes.NewReader(raw), "PiPackagePreparedEnvironmentSchema", ManifestBytes)
	if err != nil {
		return result, ErrManifest
	}
	return result, nil
}
func AssertEnvironment(expected, actual contracts.PiPackagePreparedEnvironment) error {
	left, err := json.Marshal(expected)
	if err != nil {
		return ErrEnvironment
	}
	right, err := json.Marshal(actual)
	if err != nil {
		return ErrEnvironment
	}
	if _, err := ValidateEnvironment(left); err != nil {
		return ErrEnvironment
	}
	if _, err := ValidateEnvironment(right); err != nil {
		return ErrEnvironment
	}
	// variant has nullable JSON storage; compare values, never JSON whitespace.
	var x, y any
	if json.Unmarshal(expected.Variant, &x) != nil || json.Unmarshal(actual.Variant, &y) != nil || x != y || expected.Os != actual.Os || expected.Architecture != actual.Architecture || expected.NodeAbi != actual.NodeAbi || expected.PiSdkVersion != actual.PiSdkVersion {
		return ErrEnvironment
	}
	return nil
}
func ValidateArtifact(tree *Tree, sourceKind, resolvedSource string, environment contracts.PiPackagePreparedEnvironment, expectedDigest string) (Artifact, error) {
	if sourceKind != "npm" && sourceKind != "git" && sourceKind != "local" && sourceKind != "zip" {
		return Artifact{}, ErrSource
	}
	if resolvedSource == "" || jsLength(resolvedSource) > 4096 || strings.ContainsRune(resolvedSource, 0) || privateSource.MatchString(resolvedSource) {
		return Artifact{}, ErrSource
	}
	raw, err := json.Marshal(environment)
	if err != nil {
		return Artifact{}, ErrManifest
	}
	if _, err = ValidateEnvironment(raw); err != nil {
		return Artifact{}, err
	}
	if err = tree.ValidateDependencies(); err != nil {
		return Artifact{}, err
	}
	inventory, err := InspectResources(tree.Manifest, tree.Entries)
	if err != nil {
		return Artifact{}, err
	}
	digest, err := tree.Digest()
	if err != nil {
		return Artifact{}, err
	}
	if expectedDigest != "" && expectedDigest != digest {
		return Artifact{}, ErrManifest
	}
	version, _ := json.Marshal(tree.Manifest.Version)
	return Artifact{Metadata: contracts.PiPackageArtifactMetadata{
		Name: contracts.PiPackageName(tree.Manifest.Name), Version: version, SourceKind: contracts.PiPackageSourceKind(sourceKind), ResolvedSource: resolvedSource, PreparedEnvironment: environment,
		ResourceCounts: contracts.PiPackageResourceCounts{Extensions: int64(len(inventory.Extensions)), Skills: int64(len(inventory.Skills)), Prompts: int64(len(inventory.Prompts)), Themes: int64(len(inventory.Themes))}, ContentDigest: contracts.Digest(digest),
	}, Inventory: inventory, EntryCount: len(tree.Entries), RestoredBytes: tree.RestoredBytes}, nil
}
