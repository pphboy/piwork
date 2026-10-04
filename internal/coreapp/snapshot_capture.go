package coreapp

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"path/filepath"
	"sort"

	"golang.org/x/sys/unix"
	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/imagestatic"
	"piwork/internal/pipackage"
	"piwork/internal/safefs"
	"piwork/internal/snapshottree"
	"piwork/internal/workpackage"
)

type snapshotDescriptor struct {
	Size  int64
	Kinds map[string]bool
}

func (a *Application) captureSnapshotPackage(ctx context.Context, job corestore.SnapshotJob, metadata snapshotMetadata, image string, root *safefs.Root) (workpackage.Verified, error) {
	blobs, err := workpackage.OpenBlobDirectory(filepath.Join(a.options.DataDirectory, "snapshots", "jobs", job.OperationID))
	if err != nil {
		return workpackage.Verified{}, err
	}
	defer blobs.Close()
	descriptors := map[string]snapshotDescriptor{}
	add := func(digest string, size int64, kind string) error {
		previous, ok := descriptors[digest]
		if ok && previous.Size != size {
			return snapshotInvalid("blob.size")
		}
		if !ok {
			previous = snapshotDescriptor{size, map[string]bool{}}
		}
		previous.Kinds[kind] = true
		descriptors[digest] = previous
		return nil
	}
	put := func(value []byte, kind string) (string, error) {
		blob, err := blobs.Put(ctx, bytes.NewReader(value), int64(len(value)))
		if err != nil {
			return "", err
		}
		return blob.Digest, add(blob.Digest, blob.Size, kind)
	}
	tree := func(digest string, size int64) error {
		if err := add(digest, size, "tree"); err != nil {
			return err
		}
		raw, err := blobs.ReadMetadata(ctx, digest)
		if err != nil {
			return err
		}
		var parsed workpackage.Tree
		_, err = contracts.ParseJSON(bytes.NewReader(raw), workpackage.DefaultLimits.MetadataBytes)
		if err == nil {
			err = json.Unmarshal(raw, &parsed)
		}
		if err != nil {
			return err
		}
		for _, entry := range parsed.Entries {
			if entry.Type == "file" {
				if err := add(string(entry.Blob), entry.Size, "file"); err != nil {
					return err
				}
			}
		}
		return nil
	}
	historyRequest, err := contracts.EncodeCanonicalJSON(struct {
		SourceWorkID string   `json:"sourceWorkId"`
		ContextIDs   []string `json:"contextIds"`
	}{metadata.Work.ID, snapshotSourceContexts(metadata.Identities)})
	if err != nil {
		return workpackage.Verified{}, err
	}
	if err := root.AtomicMaterialWrite("history-request.json", "history-request.tmp", historyRequest, 0600); err != nil {
		return workpackage.Verified{}, err
	}
	output, err := a.runSnapshotJobHelper(ctx, job, image, "verify-history", metadata.Volumes[0].Record.RuntimeName, "work-private")
	if err != nil {
		return workpackage.Verified{}, err
	}
	var history struct {
		HistoryPresent bool `json:"historyPresent"`
	}
	if strictMetadata(output, &history) != nil {
		var full map[string]any
		if strictMetadata(output, &full) != nil {
			return workpackage.Verified{}, snapshotInvalid("history.private")
		}
		present, ok := full["historyPresent"].(bool)
		if !ok {
			return workpackage.Verified{}, snapshotInvalid("history.private")
		}
		history.HistoryPresent = present
	}
	if string(metadata.ActiveContext) != "null" && !history.HistoryPresent {
		return workpackage.Verified{}, snapshotInvalid("history.private")
	}
	volumeTrees := map[string]string{}
	for _, volume := range metadata.Volumes {
		logical := "work-private"
		if volume.Record.Role == "workspace" {
			logical = "work-workspace"
		}
		raw, err := a.runSnapshotJobHelper(ctx, job, image, "capture", volume.Record.RuntimeName, logical)
		if err != nil {
			return workpackage.Verified{}, err
		}
		var captured snapshottree.Result
		if strictMetadata(raw, &captured) != nil {
			return workpackage.Verified{}, snapshotInvalid("helper.result")
		}
		if err := tree(captured.Tree, captured.Size); err != nil {
			return workpackage.Verified{}, err
		}
		volumeTrees[volume.Record.Role] = captured.Tree
	}
	spec := contracts.PortableWorkSpec{FormatVersion: 1, SnapshotKind: "cold-full", CreatedAt: job.CreatedAt, SourceName: metadata.Work.Name, ActiveContext: metadata.ActiveContext, DesiredContext: contracts.WorkLogicalKey(metadata.DesiredContext), Contexts: []contracts.PortableWorkContext{}, Services: metadata.Services, QuotaReservations: metadata.Quotas, Bindings: metadata.Bindings, Images: []contracts.PortableWorkImage{}, PiPackageArtifacts: []contracts.PortablePiPackageArtifact{}}
	artifacts := map[string]contracts.PortablePiPackageArtifact{}
	for _, source := range metadata.Contexts {
		skills, err := snapshottree.CaptureOwned(ctx, filepath.Join(source.Directory, "skills"), blobs, false)
		if err != nil {
			return workpackage.Verified{}, err
		}
		if err := tree(skills.Tree, skills.Size); err != nil {
			return workpackage.Verified{}, err
		}
		agents, err := put([]byte(source.Config.AgentsMd), "file")
		if err != nil {
			return workpackage.Verified{}, err
		}
		c := contracts.PortableWorkContext{Key: contracts.WorkLogicalKey(source.Key), CreatedAt: source.Metadata.CreatedAt, Configuration: source.Portable, ImageKey: contracts.WorkLogicalKey(source.ImageKey), SkillsTree: contracts.WorkBlobDigest(skills.Tree), AgentsBlob: contracts.WorkBlobDigest(agents)}
		c.PackageBindings = make([]struct {
			Name        contracts.PiPackageName `json:"name"`
			ArtifactKey contracts.Digest        `json:"artifactKey"`
		}, 0)
		for _, binding := range source.Metadata.PackageBindings {
			directory := filepath.Join(source.Directory, "packages", binding.NameKey)
			prepared, err := pipackage.OpenTree(ctx, directory)
			if err != nil {
				return workpackage.Verified{}, err
			}
			verified, err := pipackage.ValidateArtifact(prepared, string(binding.Artifact.SourceKind), binding.Artifact.ResolvedSource, binding.Artifact.PreparedEnvironment, string(binding.Artifact.ContentDigest))
			prepared.Close()
			if err != nil {
				return workpackage.Verified{}, err
			}
			if verified.Metadata.Name != contracts.PiPackageName(binding.Name) || !bytes.Equal(snapshotRaw(verified.Metadata), snapshotRaw(binding.Artifact)) {
				return workpackage.Verified{}, snapshotInvalid("context.packageBinding")
			}
			key := string(binding.Artifact.ContentDigest)
			if _, exists := artifacts[key]; !exists {
				captured, err := snapshottree.CaptureOwned(ctx, directory, blobs, true)
				if err != nil {
					return workpackage.Verified{}, err
				}
				if err := tree(captured.Tree, captured.Size); err != nil {
					return workpackage.Verified{}, err
				}
				artifact, err := snapshotConvert[contracts.PortablePiPackageArtifact](map[string]any{"key": key, "name": binding.Artifact.Name, "version": binding.Artifact.Version, "sourceKind": binding.Artifact.SourceKind, "resolvedSource": binding.Artifact.ResolvedSource, "preparedEnvironment": binding.Artifact.PreparedEnvironment, "resourceCounts": binding.Artifact.ResourceCounts, "contentDigest": key, "treeDigest": captured.Tree, "resourceInventory": verified.Inventory})
				if err != nil {
					return workpackage.Verified{}, err
				}
				artifacts[key] = artifact
			} else {
				previous := artifacts[key]
				if previous.Name != contracts.PiPackageName(binding.Name) || !bytes.Equal(snapshotRaw(previous.PreparedEnvironment), snapshotRaw(binding.Artifact.PreparedEnvironment)) {
					return workpackage.Verified{}, snapshotInvalid("piPackageArtifacts.collision")
				}
			}
			c.PackageBindings = append(c.PackageBindings, struct {
				Name        contracts.PiPackageName `json:"name"`
				ArtifactKey contracts.Digest        `json:"artifactKey"`
			}{contracts.PiPackageName(binding.Name), binding.Artifact.ContentDigest})
		}
		spec.Contexts = append(spec.Contexts, c)
	}
	for _, artifact := range artifacts {
		spec.PiPackageArtifacts = append(spec.PiPackageArtifacts, artifact)
	}
	sort.Slice(spec.PiPackageArtifacts, func(i, j int) bool { return spec.PiPackageArtifacts[i].Key < spec.PiPackageArtifacts[j].Key })
	for index, source := range metadata.Images {
		actual, err := a.engine.InspectImage(ctx, source.ID)
		if err != nil {
			return workpackage.Verified{}, err
		}
		filename := "image-" + source.Key + ".tar"
		archive, err := root.OpenFile(filename, unix.O_RDWR|unix.O_CREAT|unix.O_EXCL)
		if err != nil {
			return workpackage.Verified{}, err
		}
		size, saveErr := a.engine.SaveImage(ctx, source.ID, archive, imagestatic.MaxArchiveBytes)
		var captured imagestatic.CapturedPortableImage
		if saveErr == nil {
			captured, saveErr = imagestatic.CapturePortableImage(ctx, archive, size, imagestatic.Identity{ID: actual.ID, OS: actual.OS, Architecture: actual.Architecture, Variant: actual.Variant}, func(reader io.Reader, maximum int64) (imagestatic.CapturedBlob, error) {
				blob, err := blobs.Put(ctx, reader, maximum)
				return imagestatic.CapturedBlob{Digest: blob.Digest, Size: blob.Size}, err
			})
		}
		closeErr := archive.Close()
		removeErr := root.Remove(filename)
		if saveErr != nil {
			return workpackage.Verified{}, saveErr
		}
		if closeErr != nil {
			return workpackage.Verified{}, closeErr
		}
		if removeErr != nil {
			return workpackage.Verified{}, removeErr
		}
		entry := contracts.PortableWorkImage{Key: contracts.WorkLogicalKey(source.Key), ImageId: contracts.Digest(source.ID), Platform: contracts.WorkImagePlatform{Os: actual.OS, Architecture: actual.Architecture, Variant: snapshotVariant(actual.Variant)}, Config: contracts.WorkBlobDigest(captured.Config.Digest), Layers: []contracts.WorkBlobDigest{}}
		if err := add(captured.Config.Digest, captured.Config.Size, "image-config"); err != nil {
			return workpackage.Verified{}, err
		}
		for _, layer := range captured.Layers {
			entry.Layers = append(entry.Layers, contracts.WorkBlobDigest(layer.Digest))
			if err := add(layer.Digest, layer.Size, "image-layer"); err != nil {
				return workpackage.Verified{}, err
			}
		}
		spec.Images = append(spec.Images, entry)
		if index == 0 {
			spec.Compatibility.Os = actual.OS
			spec.Compatibility.Architecture = actual.Architecture
			spec.Compatibility.Variant = snapshotVariant(actual.Variant)
			spec.Compatibility.AgentProtocol = "v2"
			spec.Compatibility.WorkHistorySchema = 4
			spec.Compatibility.StorageLayout = 2
			spec.Compatibility.PiPackageContract = 1
		}
	}
	raw, err := contracts.EncodeCanonicalJSON(metadata.History)
	if err != nil {
		return workpackage.Verified{}, err
	}
	control, err := put(raw, "control-history")
	if err != nil {
		return workpackage.Verified{}, err
	}
	raw, err = contracts.EncodeCanonicalJSON(metadata.Identities)
	if err != nil {
		return workpackage.Verified{}, err
	}
	identities, err := put(raw, "identity-map")
	if err != nil {
		return workpackage.Verified{}, err
	}
	spec.History.Control = contracts.WorkBlobDigest(control)
	spec.History.SourceIdentityMap = contracts.WorkBlobDigest(identities)
	spec.Volumes = []json.RawMessage{snapshotRaw(workpackage.Volume{Role: "agent-private", Tree: contracts.WorkBlobDigest(volumeTrees["agent-private"]), ServiceRefKeys: []contracts.WorkLogicalKey{}}), snapshotRaw(workpackage.Volume{Role: "workspace", Tree: contracts.WorkBlobDigest(volumeTrees["workspace"]), ServiceRefKeys: metadata.Volumes[1].References})}
	kinds := []string{"file", "tree", "control-history", "identity-map", "image-config", "image-layer"}
	keys := []string{}
	for digest := range descriptors {
		keys = append(keys, digest)
	}
	sort.Strings(keys)
	for _, digest := range keys {
		descriptor := descriptors[digest]
		entry := contracts.WorkBlob{Digest: contracts.WorkBlobDigest(digest), Size: contracts.WorkByteSize(descriptor.Size), Kinds: []string{}}
		for _, kind := range kinds {
			if descriptor.Kinds[kind] {
				entry.Kinds = append(entry.Kinds, kind)
			}
		}
		spec.Blobs = append(spec.Blobs, entry)
	}
	file, err := root.OpenFile("package.work", unix.O_RDWR|unix.O_CREAT|unix.O_EXCL)
	if err != nil {
		return workpackage.Verified{}, err
	}
	defer file.Close()
	open := func(blob contracts.WorkBlob) (io.ReadCloser, error) { return blobs.Read(string(blob.Digest)) }
	if err := workpackage.Encode(ctx, spec, open, file); err != nil {
		return workpackage.Verified{}, err
	}
	if err := file.Sync(); err != nil {
		return workpackage.Verified{}, err
	}
	info, err := file.Stat()
	if err != nil {
		return workpackage.Verified{}, err
	}
	verified, err := workpackage.Read(ctx, io.NewSectionReader(file, 0, info.Size()), workpackage.ReadOptions{})
	if err != nil {
		return verified, err
	}
	if err := workpackage.ValidatePackageContent(ctx, verified, verified.Open(file)); err != nil {
		return verified, err
	}
	if err := workpackage.ValidateImages(ctx, verified, file); err != nil {
		return verified, err
	}
	return verified, nil
}
func snapshotSourceContexts(identities contracts.WorkSourceIdentityMap) []string {
	out := []string{}
	for _, entry := range identities.Contexts {
		out = append(out, string(entry.SourceId))
	}
	return out
}

func snapshotVariant(value string) json.RawMessage {
	if value == "" {
		return snapshotRaw(nil)
	}
	return snapshotRaw(value)
}
