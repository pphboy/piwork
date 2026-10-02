package workpackage

import (
	"context"
	"encoding/json"
	"io"
	"reflect"

	"piwork/internal/contracts"
	"piwork/internal/pipackage"
)

// ValidatePackageContent checks manifest identity, inventory and the shared
// prepared-artifact digest. Dependency and SDK source bytes remain opaque.
func ValidatePackageContent(ctx context.Context, verified Verified, open OpenBlob) error {
	blobs := map[string]contracts.WorkBlob{}
	for _, blob := range verified.Spec.Blobs {
		blobs[string(blob.Digest)] = blob
	}
	for _, artifact := range verified.Spec.PiPackageArtifacts {
		valid, err := ValidateTree(verified.Metadata[string(artifact.TreeDigest)], blobs, DefaultLimits)
		if err != nil {
			return err
		}
		if err := ValidatePackageTree(valid, artifact); err != nil {
			return err
		}
		entries := make([]contracts.DigestEntry, 0, len(valid.Tree.Entries)-1)
		var manifestEntry *TreeEntry
		for _, entry := range valid.Tree.Entries[1:] {
			name, err := DecodePath(entry.SegmentsBase64, DefaultLimits)
			if err != nil {
				return err
			}
			item := contracts.DigestEntry{Path: string(name), Type: entry.Type, Mode: uint32(entry.Mode), Size: entry.Size}
			if entry.Type == "hardlink" {
				return invalid("piPackageArtifacts.hardlink")
			}
			if entry.Type == "symlink" {
				target, err := DecodeBase64(entry.TargetBase64)
				if err != nil {
					return err
				}
				item.Target = string(target)
			}
			if entry.Type == "file" {
				blob := blobs[string(entry.Blob)]
				item.Open = func() (io.ReadCloser, error) {
					if err := ctx.Err(); err != nil {
						return nil, err
					}
					source, err := open(blob)
					if err != nil {
						return nil, err
					}
					return contextBlobReader{contextReader{ctx, source}, source}, nil
				}
			}
			if string(name) == "package.json" {
				copy := entry
				manifestEntry = &copy
			}
			entries = append(entries, item)
		}
		if manifestEntry == nil || manifestEntry.Type != "file" || manifestEntry.Size > pipackage.ManifestBytes {
			return invalid("piPackageArtifacts.manifest")
		}
		source, err := open(blobs[string(manifestEntry.Blob)])
		if err != nil {
			return err
		}
		raw, readErr := io.ReadAll(io.LimitReader(contextReader{ctx, source}, pipackage.ManifestBytes+1))
		closeErr := source.Close()
		if readErr != nil {
			return readErr
		}
		if closeErr != nil {
			return closeErr
		}
		if int64(len(raw)) != manifestEntry.Size {
			return invalid("piPackageArtifacts.manifest")
		}
		manifest, err := pipackage.ParseManifest(raw)
		if err != nil {
			return invalid("piPackageArtifacts.manifest")
		}
		var version *string
		if json.Unmarshal(artifact.Version, &version) != nil || manifest.Name != string(artifact.Name) || !reflect.DeepEqual(manifest.Version, version) {
			return invalid("piPackageArtifacts.manifestIdentity")
		}
		inventory, err := pipackage.InspectResources(manifest, entries)
		if err != nil {
			return invalid("piPackageArtifacts.inventory")
		}
		for i, paths := range [][]string{inventory.Extensions, inventory.Skills, inventory.Prompts, inventory.Themes} {
			wanted := [][]string{artifact.ResourceInventory.Extensions, artifact.ResourceInventory.Skills, artifact.ResourceInventory.Prompts, artifact.ResourceInventory.Themes}[i]
			counts := []int64{artifact.ResourceCounts.Extensions, artifact.ResourceCounts.Skills, artifact.ResourceCounts.Prompts, artifact.ResourceCounts.Themes}
			if !reflect.DeepEqual(paths, wanted) || int64(len(paths)) != counts[i] {
				return invalid("piPackageArtifacts.inventory")
			}
		}
		digest, err := contracts.PiPackageDigest(entries)
		if err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			return invalid("piPackageArtifacts.contentDigest")
		}
		if digest != string(artifact.ContentDigest) || digest != string(artifact.Key) {
			return invalid("piPackageArtifacts.contentDigest")
		}
	}
	return nil
}

type contextBlobReader struct {
	contextReader
	io.Closer
}
