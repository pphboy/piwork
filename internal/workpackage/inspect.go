package workpackage

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"sort"

	"piwork/internal/contracts"
	"piwork/internal/imagestatic"
	"piwork/internal/pipackage"
)

type Inspection struct {
	FormatVersion       float64           `json:"formatVersion"`
	SnapshotKind        string            `json:"snapshotKind"`
	Platform            any               `json:"platform"`
	Digest              string            `json:"digest"`
	Size                int64             `json:"size"`
	RestoredBytes       int64             `json:"restoredBytes"`
	Counts              InspectionCounts  `json:"counts"`
	Packages            []PackageIdentity `json:"packages"`
	BindingRequirements struct {
		Models  any                 `json:"models"`
		Secrets []SecretRequirement `json:"secrets"`
	} `json:"bindingRequirements"`
	IntegrityVerified     bool   `json:"integrityVerified"`
	InstallationValidated bool   `json:"installationValidated"`
	Warning               string `json:"warning"`
}
type InspectionCounts struct {
	Contexts int64 `json:"contexts"`
	Services int64 `json:"services"`
	Images   int64 `json:"images"`
	Packages int64 `json:"packages"`
	Entries  int64 `json:"entries"`
	Blobs    int64 `json:"blobs"`
}
type PackageIdentity struct {
	Name    string          `json:"name"`
	Version json.RawMessage `json:"version"`
}
type SecretRequirement struct {
	Key string `json:"key"`
}

func (verified Verified) Open(reader io.ReaderAt) OpenBlob {
	return func(blob contracts.WorkBlob) (io.ReadCloser, error) {
		offset, ok := verified.Offsets[string(blob.Digest)]
		if !ok || int64(blob.Size) > verified.Size-offset {
			return nil, invalid("blob.offset")
		}
		return io.NopCloser(io.NewSectionReader(reader, offset, int64(blob.Size))), nil
	}
}

// Inspect requires a pinned, stable source. It never reads installation state,
// calls a network endpoint, invokes an executable, or opens Work SQLite files.
func Inspect(ctx context.Context, source io.ReaderAt, size int64) (Inspection, error) {
	if source == nil || size < 0 || size > DefaultLimits.PackageBytes {
		return Inspection{}, limit("packageBytes")
	}
	verified, err := Read(ctx, io.NewSectionReader(source, 0, size), ReadOptions{})
	if err != nil {
		return Inspection{}, err
	}
	if err := ValidatePackageContent(ctx, verified, verified.Open(source)); err != nil {
		return Inspection{}, err
	}
	if err := ValidateImages(ctx, verified, source); err != nil {
		return Inspection{}, err
	}
	return SafeSummary(verified), nil
}

func ValidateImages(ctx context.Context, verified Verified, source io.ReaderAt) error {
	return inspectImages(ctx, verified, source, nil)
}

// ImageEnvironments obtains ABI/SDK facts from the final original image tree.
func ImageEnvironments(ctx context.Context, verified Verified, source io.ReaderAt) (map[string]contracts.PiPackagePreparedEnvironment, error) {
	result := map[string]contracts.PiPackagePreparedEnvironment{}
	err := inspectImages(ctx, verified, source, result)
	return result, err
}
func inspectImages(ctx context.Context, verified Verified, source io.ReaderAt, environments map[string]contracts.PiPackagePreparedEnvironment) error {
	agents := map[string]bool{}
	for _, c := range verified.Spec.Contexts {
		agents[string(c.ImageKey)] = true
	}
	blobs := map[string]contracts.WorkBlob{}
	for _, blob := range verified.Spec.Blobs {
		blobs[string(blob.Digest)] = blob
	}
	for _, image := range verified.Spec.Images {
		layers := make([]imagestatic.PortableLayer, 0, len(image.Layers))
		for _, digest := range image.Layers {
			blob := blobs[string(digest)]
			offset, ok := verified.Offsets[string(digest)]
			if !ok {
				return invalid("image.layer")
			}
			layers = append(layers, imagestatic.PortableLayer{Reader: io.NewSectionReader(source, offset, int64(blob.Size)), Size: int64(blob.Size)})
		}
		variant, _ := nullableText(image.Platform.Variant)
		capabilities, err := imagestatic.InspectPortableImage(ctx, verified.Metadata[string(image.Config)], layers, imagestatic.Identity{ID: string(image.ImageId), OS: image.Platform.Os, Architecture: image.Platform.Architecture, Variant: variant}, agents[string(image.Key)])
		if err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			if errors.Is(err, imagestatic.ErrLimit) {
				return limit("image")
			}
			if errors.Is(err, imagestatic.ErrIncompatible) || errors.Is(err, imagestatic.ErrUnsupported) {
				return incompatible("image.capabilities")
			}
			return invalid("image")
		}
		if environments != nil && capabilities.Environment != nil {
			environments[string(image.Key)] = *capabilities.Environment
		}
	}
	return nil
}

// Target validation is separate from offline integrity. The caller supplies
// independently captured target image environments, never a client summary.
func ValidateTarget(spec contracts.PortableWorkSpec, platform contracts.WorkImagePlatform, environments map[string]contracts.PiPackagePreparedEnvironment) error {
	var actualVariant, wantedVariant any
	if json.Unmarshal(platform.Variant, &actualVariant) != nil || json.Unmarshal(spec.Compatibility.Variant, &wantedVariant) != nil || platform.Os != spec.Compatibility.Os || platform.Architecture != spec.Compatibility.Architecture || actualVariant != wantedVariant {
		return incompatible("platform")
	}
	artifacts := map[string]contracts.PortablePiPackageArtifact{}
	for _, artifact := range spec.PiPackageArtifacts {
		artifacts[string(artifact.Key)] = artifact
	}
	for _, c := range spec.Contexts {
		for _, binding := range c.PackageBindings {
			artifact := artifacts[string(binding.ArtifactKey)]
			actual, ok := environments[string(c.ImageKey)]
			if !ok || pipackage.AssertEnvironment(artifact.PreparedEnvironment, actual) != nil {
				return incompatible("piPackageArtifacts.environment")
			}
		}
	}
	return nil
}

func SafeSummary(verified Verified) Inspection {
	spec := verified.Spec
	result := Inspection{FormatVersion: spec.FormatVersion, SnapshotKind: spec.SnapshotKind, Platform: spec.Compatibility, Digest: verified.Digest, Size: verified.Size, RestoredBytes: verified.RestoredBytes, Packages: []PackageIdentity{}, IntegrityVerified: true, InstallationValidated: false, Warning: "This package contains complete private Work content and may include credentials. Import does not execute it."}
	result.Counts.Contexts, result.Counts.Services, result.Counts.Images = int64(len(spec.Contexts)), int64(len(spec.Services)), int64(len(spec.Images))
	result.Counts.Packages, result.Counts.Entries, result.Counts.Blobs = int64(len(spec.PiPackageArtifacts)), verified.EntryCount, int64(len(spec.Blobs))
	for _, artifact := range spec.PiPackageArtifacts {
		result.Packages = append(result.Packages, PackageIdentity{string(artifact.Name), artifact.Version})
	}
	sort.Slice(result.Packages, func(i, j int) bool {
		a, b := result.Packages[i], result.Packages[j]
		if a.Name != b.Name {
			return a.Name < b.Name
		}
		av, _ := nullableText(a.Version)
		bv, _ := nullableText(b.Version)
		return av < bv
	})
	result.BindingRequirements.Models = spec.Bindings.Models
	result.BindingRequirements.Secrets = []SecretRequirement{}
	for _, secret := range spec.Bindings.Secrets {
		result.BindingRequirements.Secrets = append(result.BindingRequirements.Secrets, SecretRequirement{string(secret.Key)})
	}
	return result
}
