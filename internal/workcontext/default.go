// Package workcontext publishes immutable, Work-owned Agent context trees.
package workcontext

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"time"

	"github.com/google/uuid"
	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/safefs"
	"piwork/internal/skillartifact"
)

var ErrContext = errors.New("Work context could not be published safely")
var imageIdentity = regexp.MustCompile(`^sha256:[a-f0-9]{64}$`)

type Published struct {
	ID                string
	Directory         string
	ConfigurationJSON string
	ImageID           string
}

// BuildDefault captures the selected, immutable managed Skill artifacts,
// AGENTS.md, and pinned image identity. Package bindings join this same
// publication boundary when their Core coordinator is available.
func BuildDefault(store *corestore.Store, dataDirectory, workID string, configuration contracts.WorkConfig, imageID, createdAt string) (Published, error) {
	if store == nil {
		return Published{}, ErrContext
	}
	selected, err := loadSelectedSkills(store, configuration.Skills)
	if err != nil {
		return Published{}, ErrContext
	}
	return buildWithSkills(store, dataDirectory, workID, configuration, imageID, createdAt, selected, nil)
}

// BuildPreservingSkills changes another Work configuration field without
// silently reselecting Core catalog content for the existing Skill names.
func BuildPreservingSkills(store *corestore.Store, dataDirectory, workID, priorContextID string, configuration contracts.WorkConfig, imageID, createdAt string) (Published, error) {
	selected, err := loadPriorSkills(store, dataDirectory, workID, priorContextID, configuration.Skills)
	if err != nil {
		return Published{}, ErrContext
	}
	packages, err := LoadPackageSources(store, dataDirectory, workID, priorContextID, configuration.Packages)
	if err != nil {
		return Published{}, err
	}
	return buildWithSkills(store, dataDirectory, workID, configuration, imageID, createdAt, selected, packages)
}

func buildWithSkills(store *corestore.Store, dataDirectory, workID string, configuration contracts.WorkConfig, imageID, createdAt string, selected []skillartifact.Snapshot, sources []PackageSource) (Published, error) {
	return buildCaptured(store, dataDirectory, workID, "", configuration, imageID, createdAt, selected, sources)
}

// BuildImported uses verified package material, without reselecting a catalog.
func BuildImported(store *corestore.Store, dataDirectory, workID, contextID, skillsDirectory string, configuration contracts.WorkConfig, imageID, createdAt string, sources []PackageSource) (Published, error) {
	if !safefs.ValidFileName(contextID) {
		return Published{}, ErrContext
	}
	selected := make([]skillartifact.Snapshot, 0, len(configuration.Skills))
	for _, name := range configuration.Skills {
		item, err := skillartifact.Scan(filepath.Join(skillsDirectory, string(name)), string(name))
		if err != nil {
			return Published{}, err
		}
		selected = append(selected, item)
	}
	return buildCaptured(store, dataDirectory, workID, contextID, configuration, imageID, createdAt, selected, sources)
}

func buildCaptured(store *corestore.Store, dataDirectory, workID, targetContextID string, configuration contracts.WorkConfig, imageID, createdAt string, selected []skillartifact.Snapshot, sources []PackageSource) (Published, error) {
	var output Published
	if store == nil || !safefs.ValidFileName(workID) || !imageIdentity.MatchString(imageID) || len(configuration.Skills) > 128 || len(sources) != len(configuration.Packages) || len(selected) != len(configuration.Skills) {
		return output, ErrContext
	}
	if _, err := time.Parse(time.RFC3339Nano, createdAt); err != nil {
		return output, ErrContext
	}
	configJSON, err := json.Marshal(configuration)
	if err != nil {
		return output, ErrContext
	}
	if _, err := contracts.Decode[contracts.WorkConfig](bytes.NewReader(configJSON), "WorkConfigSchema", 2<<20); err != nil {
		return output, ErrContext
	}
	works, err := store.OpenWorksRoot()
	if err != nil {
		return output, ErrContext
	}
	defer works.Close()
	work, err := works.OpenDirectory(workID)
	if err != nil {
		return output, ErrContext
	}
	defer work.Close()
	contexts, err := work.OpenDirectory("contexts")
	if err != nil {
		return output, ErrContext
	}
	defer contexts.Close()
	id, err := uuid.NewRandom()
	if err != nil {
		return output, ErrContext
	}
	contextID, stageName := "context-"+id.String(), "stage-"+id.String()
	if targetContextID != "" {
		contextID = targetContextID
	}
	stage, err := contexts.OpenDirectory(stageName)
	if err != nil {
		return output, ErrContext
	}
	stagePath := filepath.Join(dataDirectory, "works", workID, "contexts", stageName)
	stageOpen := true
	defer func() {
		if stageOpen {
			stage.Close()
		}
	}()
	published := false
	defer func() {
		if !published {
			if stageOpen {
				stage.Close()
				stageOpen = false
			}
			_ = contexts.RemoveTree(stageName)
		}
	}()
	skills, err := stage.OpenDirectory("skills")
	if err != nil {
		return output, ErrContext
	}
	if err := writeSelectedSkills(skills, selected, id.String()); err != nil {
		skills.Close()
		return output, ErrContext
	}
	if skills.Sync() != nil {
		skills.Close()
		return output, ErrContext
	}
	skills.Close()
	packages, err := stage.OpenDirectory("packages")
	if err != nil {
		return output, ErrContext
	}
	if packages.Sync() != nil {
		packages.Close()
		return output, ErrContext
	}
	if err := writePackages(packages, configuration.Packages, sources); err != nil {
		packages.Close()
		return output, err
	}
	packages.Close()
	metadata := contracts.WorkContextMetadata{Version: 1, SnapshotId: contextID, WorkId: workID, ImageIdentity: contracts.Digest(imageID), Skills: []struct {
		Name     string `json:"name"`
		Identity string `json:"identity"`
	}{}, PackageContractVersion: 1,
		PackageBindings: []struct {
			Name     string                              `json:"name"`
			NameKey  string                              `json:"nameKey"`
			Artifact contracts.PiPackageArtifactMetadata `json:"artifact"`
		}{}, CreatedAt: contracts.Timestamp(createdAt)}
	for _, skill := range selected {
		metadata.Skills = append(metadata.Skills, struct {
			Name     string `json:"name"`
			Identity string `json:"identity"`
		}{Name: skill.Name, Identity: skill.Identity})
	}
	for _, source := range sources {
		metadata.PackageBindings = append(metadata.PackageBindings, struct {
			Name     string                              `json:"name"`
			NameKey  string                              `json:"nameKey"`
			Artifact contracts.PiPackageArtifactMetadata `json:"artifact"`
		}{Name: source.Name, NameKey: contracts.PackageNameKey(source.Name), Artifact: source.Metadata})
	}
	if stage.AtomicMaterialWrite("AGENTS.md", "agents-"+id.String()+".tmp", []byte(configuration.AgentsMd), 0644) != nil ||
		writeJSON(stage, "config.json", configuration, id.String()) != nil || writeJSON(stage, "metadata.json", metadata, id.String()) != nil || stage.Sync() != nil {
		return output, ErrContext
	}
	if err := sealDefaultStage(stagePath, selected); err != nil {
		return output, ErrContext
	}
	stage.Close()
	stageOpen = false
	if err := contexts.RenameNoReplace(stageName, contextID); err != nil {
		return output, ErrContext
	}
	published = true
	return Published{ID: contextID, Directory: filepath.Join(dataDirectory, "works", workID, "contexts", contextID), ConfigurationJSON: string(configJSON), ImageID: imageID}, nil
}

// RemoveUnaccepted removes a newly generated Work's context tree after its
// acceptance loses a conflict or fails. The Work ID is never reused.
func RemoveUnaccepted(store *corestore.Store, workID string) error {
	if store == nil || !safefs.ValidFileName(workID) {
		return ErrContext
	}
	works, err := store.OpenWorksRoot()
	if err != nil {
		return ErrContext
	}
	defer works.Close()
	if err := works.RemoveTree(workID); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return ErrContext
	}
	return nil
}

// RemoveCandidate removes one context that was built before a configuration
// Save transaction but lost its revision race or failed validation at commit.
// Other published contexts for the Work remain untouched.
func RemoveCandidate(store *corestore.Store, workID, contextID string) error {
	if store == nil || !safefs.ValidFileName(workID) || !safefs.ValidFileName(contextID) {
		return ErrContext
	}
	works, err := store.OpenWorksRoot()
	if err != nil {
		return ErrContext
	}
	defer works.Close()
	work, err := works.OpenDirectory(workID)
	if err != nil {
		return ErrContext
	}
	defer work.Close()
	contexts, err := work.OpenDirectory("contexts")
	if err != nil {
		return ErrContext
	}
	defer contexts.Close()
	if err := contexts.RemoveTree(contextID); err != nil {
		return ErrContext
	}
	return nil
}

func writeJSON(root *safefs.Root, name string, value any, id string) error {
	raw, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	raw = append(raw, '\n')
	return root.AtomicMaterialWrite(name, "publish-"+id+".tmp", raw, 0644)
}

func sealDefaultStage(directory string, selected []skillartifact.Snapshot) error {
	for _, skill := range selected {
		for _, file := range skill.Files {
			name := filepath.Join(directory, "skills", skill.Name, filepath.FromSlash(file.Path))
			if err := os.Chmod(name, 0444); err != nil {
				return err
			}
		}
	}
	for _, name := range []string{"AGENTS.md", "config.json", "metadata.json"} {
		if err := os.Chmod(filepath.Join(directory, name), 0444); err != nil {
			return err
		}
	}
	directories := []string{"skills", "packages", ""}
	for _, skill := range selected {
		for _, child := range skill.Directories {
			directories = append(directories, filepath.Join("skills", skill.Name, filepath.FromSlash(child)))
		}
		directories = append(directories, filepath.Join("skills", skill.Name))
	}
	for _, name := range directories {
		if err := os.Chmod(filepath.Join(directory, name), 0755); err != nil {
			return err
		}
	}
	return nil
}
