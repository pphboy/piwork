package workcontext

import (
	"bytes"
	"context"
	"encoding/json"
	"path/filepath"

	"os"
	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/pipackage"
	"piwork/internal/safefs"
)

type PackageSource struct {
	Name, Directory string
	Metadata        contracts.PiPackageArtifactMetadata
}

// BuildWithPackages captures source artifacts into the same immutable context
// publication as Skills and configuration. Source selection/leases belong to
// the Core coordinator, rather than to this filesystem publisher.
func BuildWithPackages(store *corestore.Store, dataDirectory, workID, priorContextID string, reselectSkills bool, configuration contracts.WorkConfig, imageID, createdAt string, sources []PackageSource) (Published, error) {
	if priorContextID == "" || reselectSkills {
		skills, err := loadSelectedSkills(store, configuration.Skills)
		if err != nil {
			return Published{}, err
		}
		return buildWithSkills(store, dataDirectory, workID, configuration, imageID, createdAt, skills, sources)
	}
	skills, err := loadPriorSkills(store, dataDirectory, workID, priorContextID, configuration.Skills)
	if err != nil {
		return Published{}, err
	}
	return buildWithSkills(store, dataDirectory, workID, configuration, imageID, createdAt, skills, sources)
}

func Metadata(store *corestore.Store, workID, contextID string) (contracts.WorkContextMetadata, error) {
	var metadata contracts.WorkContextMetadata
	if !safefs.ValidFileName(workID) || !safefs.ValidFileName(contextID) {
		return metadata, ErrContext
	}
	works, err := store.OpenWorksRoot()
	if err != nil {
		return metadata, err
	}
	defer works.Close()
	work, err := works.OpenDirectory(workID)
	if err != nil {
		return metadata, err
	}
	defer work.Close()
	contexts, err := work.OpenDirectory("contexts")
	if err != nil {
		return metadata, err
	}
	defer contexts.Close()
	current, err := contexts.OpenPublishedDirectory(contextID)
	if err != nil {
		return metadata, err
	}
	defer current.Close()
	raw, err := current.ReadPublishedFile("metadata.json", 2<<20)
	if err != nil {
		return metadata, err
	}
	metadata, err = contracts.Decode[contracts.WorkContextMetadata](bytes.NewReader(raw), "WorkContextMetadataSchema", 2<<20)
	if err != nil || metadata.WorkId != workID || metadata.SnapshotId != contextID || metadata.Version != 1 || metadata.PackageContractVersion != 1 {
		return metadata, ErrContext
	}
	return metadata, nil
}

func LoadPackageSources(store *corestore.Store, dataDirectory, workID, contextID string, selection contracts.PiPackageSelection) ([]PackageSource, error) {
	if len(selection) == 0 {
		return []PackageSource{}, nil
	}
	metadata, err := Metadata(store, workID, contextID)
	if err != nil {
		return nil, err
	}
	result := make([]PackageSource, 0, len(selection))
	for _, item := range selection {
		var source *PackageSource
		for _, binding := range metadata.PackageBindings {
			if binding.Name != string(item.Name) {
				continue
			}
			if source != nil || binding.NameKey != contracts.PackageNameKey(binding.Name) || binding.Artifact.Name != item.Name {
				return nil, ErrContext
			}
			value := PackageSource{Name: binding.Name, Directory: filepath.Join(dataDirectory, "works", workID, "contexts", contextID, "packages", binding.NameKey), Metadata: binding.Artifact}
			source = &value
		}
		if source == nil {
			return nil, contracts.NewError("PI_PACKAGE_NOT_INSTALLED", "packages")
		}
		result = append(result, *source)
	}
	return result, nil
}

func writePackages(destination *safefs.Root, selection contracts.PiPackageSelection, sources []PackageSource) error {
	path, err := destination.Path("unused")
	if err != nil {
		return err
	}
	parent, err := os.OpenRoot(filepath.Dir(path))
	if err != nil {
		return err
	}
	defer parent.Close()
	for index, source := range sources {
		if selection[index].Name != source.Metadata.Name || source.Name != string(selection[index].Name) || !pipackage.ValidName(source.Name) {
			return ErrContext
		}
		root, err := os.OpenRoot(filepath.Dir(source.Directory))
		if err != nil {
			return err
		}
		tree, err := pipackage.OpenTreeAt(context.Background(), root, filepath.Base(source.Directory))
		root.Close()
		if err != nil {
			return err
		}
		metadata := source.Metadata
		validated, err := pipackage.ValidateArtifact(tree, string(metadata.SourceKind), metadata.ResolvedSource, metadata.PreparedEnvironment, string(metadata.ContentDigest))
		if err == nil {
			left, _ := json.Marshal(validated.Metadata)
			right, _ := json.Marshal(metadata)
			if !bytes.Equal(left, right) {
				err = ErrContext
			}
		}
		if err == nil {
			err = pipackage.CopyTreeAt(context.Background(), tree, parent, contracts.PackageNameKey(source.Name), true)
		}
		tree.Close()
		if err != nil {
			return err
		}
	}
	return destination.Sync()
}
