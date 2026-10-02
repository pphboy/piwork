package workpackage

import (
	"bytes"
	"encoding/json"
	"reflect"
	"strings"
	"unicode/utf8"

	"piwork/internal/contracts"
)

func ValidateContents(spec contracts.PortableWorkSpec, metadata map[string]json.RawMessage, limits Limits) (restored, entries int64, returned error) {
	blobs := map[string]contracts.WorkBlob{}
	for _, blob := range spec.Blobs {
		blobs[string(blob.Digest)] = blob
	}
	uses := map[string]map[string]bool{}
	use := func(digest string, kind string) {
		if uses[digest] == nil {
			uses[digest] = map[string]bool{}
		}
		uses[digest][kind] = true
	}
	trees := map[string]ValidTree{}
	addBytes := func(n int64) error {
		if n < 0 || n > limits.RestoredBytes-restored {
			return limit("restoredBytes")
		}
		restored += n
		return nil
	}
	useTree := func(digest string) error {
		use(digest, "tree")
		tree, ok := trees[digest]
		if !ok {
			var err error
			tree, err = ValidateTree(metadata[digest], blobs, limits)
			if err != nil {
				return err
			}
			trees[digest] = tree
		}
		if int64(len(tree.Tree.Entries)) > limits.Entries-entries {
			return limit("entries")
		}
		entries += int64(len(tree.Tree.Entries))
		if err := addBytes(tree.FileBytes); err != nil {
			return err
		}
		for _, entry := range tree.Tree.Entries {
			if entry.Type == "file" {
				use(string(entry.Blob), "file")
			}
		}
		return nil
	}
	for _, volume := range Volumes(spec) {
		if err := useTree(string(volume.Tree)); err != nil {
			return restored, entries, err
		}
	}
	artifacts := map[string]contracts.PortablePiPackageArtifact{}
	for _, artifact := range spec.PiPackageArtifacts {
		artifacts[string(artifact.Key)] = artifact
	}
	for _, c := range spec.Contexts {
		if err := useTree(string(c.SkillsTree)); err != nil {
			return restored, entries, err
		}
		use(string(c.AgentsBlob), "file")
		if err := addBytes(int64(blobs[string(c.AgentsBlob)].Size)); err != nil {
			return restored, entries, err
		}
		for _, binding := range c.PackageBindings {
			artifact, ok := artifacts[string(binding.ArtifactKey)]
			if !ok {
				return restored, entries, invalid("piPackageArtifacts.binding")
			}
			if err := useTree(string(artifact.TreeDigest)); err != nil {
				return restored, entries, err
			}
			if err := ValidatePackageTree(trees[string(artifact.TreeDigest)], artifact); err != nil {
				return restored, entries, err
			}
		}
	}
	use(string(spec.History.Control), "control-history")
	use(string(spec.History.SourceIdentityMap), "identity-map")
	if _, _, err := ValidateHistory(spec, metadata[string(spec.History.Control)], metadata[string(spec.History.SourceIdentityMap)]); err != nil {
		return restored, entries, err
	}
	usedImages := map[string]bool{}
	for _, c := range spec.Contexts {
		usedImages[string(c.ImageKey)] = true
	}
	for _, service := range spec.Services {
		for _, revision := range service.Revisions {
			if key, ok := nullableText(revision.ImageKey); ok {
				usedImages[key] = true
			}
		}
	}
	layers := map[string]bool{}
	for _, image := range spec.Images {
		if !usedImages[string(image.Key)] {
			return restored, entries, invalid("unusedImage")
		}
		use(string(image.Config), "image-config")
		value, err := parseJSON(metadata[string(image.Config)], limits.MetadataBytes)
		if err != nil {
			return restored, entries, err
		}
		config, ok := value.(map[string]any)
		if !ok {
			return restored, entries, invalid("image.config")
		}
		variant := any(nil)
		if v, exists := config["variant"]; exists {
			variant = v
		}
		var wanted any
		_ = json.Unmarshal(image.Platform.Variant, &wanted)
		root, ok := config["rootfs"].(map[string]any)
		if !ok || config["os"] != image.Platform.Os || config["architecture"] != image.Platform.Architecture || !reflect.DeepEqual(variant, wanted) || root["type"] != "layers" {
			return restored, entries, invalid("image.config")
		}
		diffIDs, ok := root["diff_ids"].([]any)
		if !ok || len(diffIDs) != len(image.Layers) {
			return restored, entries, invalid("image.config")
		}
		for i, layer := range image.Layers {
			if diffIDs[i] != "sha256:"+string(layer) {
				return restored, entries, invalid("image.config")
			}
			use(string(layer), "image-layer")
			layers[string(layer)] = true
		}
	}
	for digest := range layers {
		if err := addBytes(int64(blobs[digest].Size)); err != nil {
			return restored, entries, err
		}
	}
	for _, blob := range spec.Blobs {
		used := uses[string(blob.Digest)]
		if len(used) != len(blob.Kinds) {
			return restored, entries, invalid("blobClosure")
		}
		for _, kind := range blob.Kinds {
			if !used[kind] {
				return restored, entries, invalid("blobClosure")
			}
		}
	}
	return restored, entries, nil
}

func ValidateHistory(spec contracts.PortableWorkSpec, historyRaw, identityRaw []byte) (history contracts.WorkControlHistory, identities contracts.WorkSourceIdentityMap, returned error) {
	history, err := decodeMetadata[contracts.WorkControlHistory](historyRaw, "WorkControlHistorySchema")
	if err != nil {
		return history, identities, err
	}
	identities, err = decodeMetadata[contracts.WorkSourceIdentityMap](identityRaw, "WorkSourceIdentityMapSchema")
	if err != nil {
		return history, identities, err
	}
	if history.Work.Name != spec.SourceName {
		return history, identities, invalid("history.work")
	}
	contextKeys, serviceKeys := map[string]bool{}, map[string]bool{}
	for _, c := range spec.Contexts {
		contextKeys[string(c.Key)] = true
	}
	for _, s := range spec.Services {
		serviceKeys[string(s.Key)] = true
	}
	checkIdentities := func(items []struct {
		SourceId contracts.ResourceId     `json:"sourceId"`
		Key      contracts.WorkLogicalKey `json:"key"`
	}, keys map[string]bool) bool {
		if len(items) != len(keys) {
			return false
		}
		seen := map[string]bool{}
		for i, item := range items {
			if i > 0 && items[i-1].SourceId >= item.SourceId || seen[string(item.Key)] || !keys[string(item.Key)] {
				return false
			}
			seen[string(item.Key)] = true
		}
		return true
	}
	if !checkIdentities(identities.Contexts, contextKeys) || !checkIdentities(identities.Services, serviceKeys) {
		return history, identities, invalid("history.identities")
	}
	seenContexts := map[string]bool{}
	for i, revision := range history.ConfigurationRevisions {
		key := string(revision.ContextKey)
		if i > 0 && history.ConfigurationRevisions[i-1].Revision >= revision.Revision || seenContexts[key] || !contextKeys[key] {
			return history, identities, invalid("history.context")
		}
		seenContexts[key] = true
	}
	if len(seenContexts) != len(contextKeys) {
		return history, identities, invalid("history.context")
	}
	operations := map[string]contracts.ArchivedWorkOperation{}
	serviceIDs := map[string]bool{}
	for _, item := range identities.Services {
		serviceIDs[string(item.SourceId)] = true
	}
	for i, operation := range history.Operations {
		if i > 0 && history.Operations[i-1].Id >= operation.Id {
			return history, identities, invalid("history.operations")
		}
		if operation.WorkId != identities.SourceWorkId {
			return history, identities, invalid("history.scope")
		}
		if service, ok := nullableText(operation.ServiceId); ok && !serviceIDs[service] {
			return history, identities, invalid("history.scope")
		}
		operations[string(operation.Id)] = operation
	}
	operationKeys := map[string]bool{}
	if len(identities.Operations) != len(operations) {
		return history, identities, invalid("history.operationMap")
	}
	for i, item := range identities.Operations {
		if i > 0 && identities.Operations[i-1].SourceId >= item.SourceId || operationKeys[string(item.Key)] {
			return history, identities, invalid("history.operationMap")
		}
		if _, ok := operations[string(item.SourceId)]; !ok {
			return history, identities, invalid("history.operationMap")
		}
		operationKeys[string(item.Key)] = true
	}
	principals := map[string]string{}
	var previous []string
	for _, record := range history.Idempotency {
		parts := []string{string(record.PrincipalKey), record.WorkScope, record.OperationKind, record.IdempotencyKey}
		if previous != nil {
			different := -1
			for i := range parts {
				if parts[i] != previous[i] {
					different = i
					break
				}
			}
			if different < 0 || bytes.Compare([]byte(previous[different]), []byte(parts[different])) >= 0 {
				return history, identities, invalid("history.idempotencyOrder")
			}
		}
		previous = parts
		key := string(record.PrincipalKey)
		if kind, ok := principals[key]; ok && kind != record.PrincipalKind {
			return history, identities, invalid("history.principal")
		}
		principals[key] = record.PrincipalKind
		operation, ok := operations[string(record.OperationId)]
		if !ok || operation.Kind != record.OperationKind || record.ResourceId != identities.SourceWorkId && !serviceIDs[string(record.ResourceId)] {
			return history, identities, invalid("history.idempotencyReference")
		}
	}
	return history, identities, nil
}

// Relative package links are stricter than opaque user workspace symlinks.
func ValidatePackageTree(tree ValidTree, artifact contracts.PortablePiPackageArtifact) error {
	paths := map[string]TreeEntry{}
	for _, entry := range tree.Tree.Entries {
		path, err := DecodePath(entry.SegmentsBase64, DefaultLimits)
		if err != nil {
			return err
		}
		if !validPackagePathBytes(path) {
			return invalid("piPackageArtifacts.pathUtf8")
		}
		paths[string(path)] = entry
	}
	if paths["package.json"].Type != "file" {
		return invalid("piPackageArtifacts.manifest")
	}
	resolve := func(path string) (TreeEntry, error) {
		parts := strings.Split(path, "/")
		for hops := 0; hops < 41; hops++ {
			current := []string{}
			restarted := false
			for i, part := range parts {
				if part == "" || part == "." {
					continue
				}
				if part == ".." {
					if len(current) == 0 {
						return TreeEntry{}, invalid("piPackageArtifacts.symlinkEscape")
					}
					current = current[:len(current)-1]
					continue
				}
				current = append(current, part)
				entry, ok := paths[strings.Join(current, "/")]
				if !ok {
					return TreeEntry{}, invalid("piPackageArtifacts.symlinkMissing")
				}
				if entry.Type != "symlink" {
					continue
				}
				target, err := DecodeBase64(entry.TargetBase64)
				if err != nil {
					return TreeEntry{}, err
				}
				if !validPackagePathBytes(target) || len(target) == 0 || target[0] == '/' {
					return TreeEntry{}, invalid("piPackageArtifacts.symlinkTarget")
				}
				parts = append(append(append([]string{}, current[:len(current)-1]...), strings.Split(string(target), "/")...), parts[i+1:]...)
				restarted = true
				break
			}
			if !restarted {
				entry, ok := paths[strings.Join(current, "/")]
				if !ok {
					return TreeEntry{}, invalid("piPackageArtifacts.symlinkMissing")
				}
				return entry, nil
			}
		}
		return TreeEntry{}, invalid("piPackageArtifacts.symlinkCycle")
	}
	for path, entry := range paths {
		if entry.Type == "symlink" {
			if _, err := resolve(path); err != nil {
				return err
			}
		}
	}
	inventory := artifact.ResourceInventory
	for _, items := range [][]string{inventory.Extensions, inventory.Skills, inventory.Prompts, inventory.Themes} {
		for _, path := range items {
			if !safeInventoryPath(path) {
				return invalid("piPackageArtifacts.inventoryPath")
			}
			for _, part := range strings.Split(path, "/") {
				if part == "." || part == ".." {
					return invalid("piPackageArtifacts.inventoryPath")
				}
			}
			entry, err := resolve(path)
			if err != nil {
				return err
			}
			if entry.Type != "file" {
				return invalid("piPackageArtifacts.inventoryFile")
			}
		}
	}
	return nil
}
func validPackagePathBytes(path []byte) bool {
	return utf8.Valid(path) && bytes.IndexByte(path, 0) < 0 && bytes.IndexByte(path, '\\') < 0
}
