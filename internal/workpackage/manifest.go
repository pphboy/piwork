package workpackage

import (
	"bytes"
	"encoding/json"
	"slices"
	"strings"
	"time"
	"unicode/utf16"

	"piwork/internal/contracts"
	"piwork/internal/servicedefinition"
)

var blobKinds = []string{"file", "tree", "control-history", "identity-map", "image-config", "image-layer"}

type Volume struct {
	Role           string                     `json:"role"`
	Tree           contracts.WorkBlobDigest   `json:"tree"`
	ServiceRefKeys []contracts.WorkLogicalKey `json:"serviceRefKeys"`
}

func Volumes(spec contracts.PortableWorkSpec) []Volume {
	result := make([]Volume, len(spec.Volumes))
	for i, raw := range spec.Volumes {
		_ = json.Unmarshal(raw, &result[i])
	}
	return result
}
func nullableText(raw json.RawMessage) (string, bool) {
	var value string
	if string(raw) == "null" || json.Unmarshal(raw, &value) != nil {
		return "", false
	}
	return value, true
}
func sorted[T any](items []T, key func(T) string) bool {
	for i := 1; i < len(items); i++ {
		if key(items[i-1]) >= key(items[i]) {
			return false
		}
	}
	return true
}
func sortedStrings(items []string) bool {
	for i := 1; i < len(items); i++ {
		a, b := utf16.Encode([]rune(items[i-1])), utf16.Encode([]rune(items[i]))
		if slices.Compare(a, b) >= 0 {
			return false
		}
	}
	return true
}
func DecodeManifest(raw []byte) (contracts.PortableWorkSpec, error) {
	var spec contracts.PortableWorkSpec
	value, err := parseJSON(raw, DefaultLimits.MetadataBytes)
	if err != nil {
		return spec, err
	}
	if fields, ok := value.(map[string]any); ok {
		if version, exists := fields["formatVersion"]; exists && version != int64(1) {
			return spec, &ValidationError{"PACKAGE_FORMAT_UNSUPPORTED", "formatVersion"}
		}
	}
	if err := contracts.Validate("PortableWorkSpecSchema", value); err != nil {
		return spec, invalid("manifest")
	}
	if err := json.Unmarshal(raw, &spec); err != nil {
		return spec, invalid("manifest")
	}
	return spec, validateManifestRelations(spec)
}
func ValidateManifest(spec contracts.PortableWorkSpec) error {
	raw, err := json.Marshal(spec)
	if err != nil {
		return invalid("manifest")
	}
	_, err = DecodeManifest(raw)
	return err
}
func validateManifestRelations(spec contracts.PortableWorkSpec) error {
	if _, err := time.Parse(time.RFC3339Nano, spec.CreatedAt); err != nil {
		return invalid("createdAt")
	}
	contexts := map[string]contracts.PortableWorkContext{}
	services := map[string]contracts.PortableWorkService{}
	images := map[string]contracts.PortableWorkImage{}
	blobs := map[string]contracts.WorkBlob{}
	artifacts := map[string]contracts.PortablePiPackageArtifact{}
	for _, entry := range spec.Contexts {
		contexts[string(entry.Key)] = entry
	}
	for _, entry := range spec.Services {
		services[string(entry.Key)] = entry
	}
	for _, entry := range spec.Images {
		images[string(entry.Key)] = entry
	}
	for _, entry := range spec.Blobs {
		blobs[string(entry.Digest)] = entry
	}
	for _, entry := range spec.PiPackageArtifacts {
		artifacts[string(entry.Key)] = entry
	}
	if !sorted(spec.Contexts, func(c contracts.PortableWorkContext) string { return string(c.Key) }) || !sorted(spec.Services, func(s contracts.PortableWorkService) string { return string(s.Key) }) || !sorted(spec.Images, func(i contracts.PortableWorkImage) string { return string(i.Key) }) || !sorted(spec.PiPackageArtifacts, func(p contracts.PortablePiPackageArtifact) string { return string(p.Key) }) || !sorted(spec.Bindings.Models, func(m struct {
		Key          contracts.WorkLogicalKey                     `json:"key"`
		Provider     string                                       `json:"provider"`
		Model        string                                       `json:"model"`
		BaseUrl      json.RawMessage                              `json:"baseUrl"`
		Api          contracts.Field[contracts.ModelApi]          `json:"api,omitzero"`
		Capabilities contracts.Field[contracts.ModelCapabilities] `json:"capabilities,omitzero"`
	}) string {
		return string(m.Key)
	}) {
		return invalid("sortedKeys")
	}
	for i, secret := range spec.Bindings.Secrets {
		if i > 0 && spec.Bindings.Secrets[i-1].Key >= secret.Key {
			return invalid("secrets")
		}
	}
	if !sorted(spec.Blobs, func(b contracts.WorkBlob) string { return string(b.Digest) }) {
		return invalid("blobs")
	}
	for _, blob := range spec.Blobs {
		previous := -1
		for _, kind := range blob.Kinds {
			position := slices.Index(blobKinds, kind)
			if position <= previous {
				return invalid("blob.kinds")
			}
			previous = position
		}
	}
	ref := func(digest contracts.WorkBlobDigest, kind string) bool {
		blob, ok := blobs[string(digest)]
		return ok && slices.Contains(blob.Kinds, kind)
	}
	if !ref(spec.History.Control, "control-history") || !ref(spec.History.SourceIdentityMap, "identity-map") {
		return invalid("history.blob")
	}
	volumes := Volumes(spec)
	if len(volumes) != 2 || len(volumes[0].ServiceRefKeys) != 0 {
		return invalid("volumes")
	}
	for _, volume := range volumes {
		if !ref(volume.Tree, "tree") {
			return invalid("volume.tree")
		}
	}
	for i, key := range volumes[1].ServiceRefKeys {
		if i > 0 && volumes[1].ServiceRefKeys[i-1] >= key {
			return invalid("volumes.workspaceReferences")
		}
		if _, ok := services[string(key)]; !ok {
			return invalid("volumes.workspaceReferences")
		}
	}
	if _, ok := contexts[string(spec.DesiredContext)]; !ok {
		return invalid("context")
	}
	if active, ok := nullableText(spec.ActiveContext); ok {
		if _, ok := contexts[active]; !ok {
			return invalid("context")
		}
	}
	if len(spec.QuotaReservations) != len(spec.Services)+1 || spec.QuotaReservations[0].SubjectKind != "agent" || spec.QuotaReservations[0].SubjectKey != "agentd" {
		return invalid("quotaReservations")
	}
	for i, service := range spec.Services {
		row := spec.QuotaReservations[i+1]
		if row.SubjectKind != "service" || row.SubjectKey != service.Key {
			return invalid("quotaReservations.service")
		}
	}
	for _, artifact := range spec.PiPackageArtifacts {
		if artifact.Key != artifact.ContentDigest {
			return invalid("piPackageArtifacts.key")
		}
		inventory := artifact.ResourceInventory
		counts := artifact.ResourceCounts
		for _, item := range []struct {
			paths []string
			count int64
		}{{inventory.Extensions, counts.Extensions}, {inventory.Skills, counts.Skills}, {inventory.Prompts, counts.Prompts}, {inventory.Themes, counts.Themes}} {
			if len(item.paths) != int(item.count) || !sortedStrings(item.paths) {
				return invalid("piPackageArtifacts.inventory")
			}
		}
	}
	usedArtifacts := map[string]bool{}
	usedModels := map[string]bool{}
	for _, c := range spec.Contexts {
		if _, ok := images[string(c.ImageKey)]; !ok {
			return invalid("context.image")
		}
		model := string(c.Configuration.ModelBindingKey)
		found := false
		for _, m := range spec.Bindings.Models {
			found = found || string(m.Key) == model
		}
		if !found {
			return invalid("context.model")
		}
		usedModels[model] = true
		if !ref(c.SkillsTree, "tree") || !ref(c.AgentsBlob, "file") {
			return invalid("context.blob")
		}
		resources := c.Configuration.Resources
		if resources.AgentCpuMillis > resources.CpuMillis || resources.AgentMemoryBytes > resources.MemoryBytes {
			return invalid("context.resources")
		}
		if len(c.PackageBindings) != len(c.Configuration.Packages) {
			return invalid("context.packageBindings")
		}
		seenPackages := map[string]bool{}
		for i, binding := range c.PackageBindings {
			artifact, ok := artifacts[string(binding.ArtifactKey)]
			if !ok || binding.Name != c.Configuration.Packages[i].Name || artifact.Name != binding.Name || seenPackages[string(binding.Name)] {
				return invalid("context.packageBindings")
			}
			seenPackages[string(binding.Name)] = true
			usedArtifacts[string(binding.ArtifactKey)] = true
			if !ref(artifact.TreeDigest, "tree") {
				return invalid("piPackageArtifacts.tree")
			}
		}
		serverIDs := map[string]bool{}
		for _, server := range c.Configuration.McpServers {
			if serverIDs[string(server.ServerId)] {
				return invalid("mcp.serverId")
			}
			serverIDs[string(server.ServerId)] = true
			if server.RequiredServiceKey.Present {
				if _, ok := services[string(server.RequiredServiceKey.Value)]; !ok {
					return invalid("mcp.requiredServiceKey")
				}
			}
			for _, ref := range server.SecretRefs.Value {
				found := false
				for _, secret := range spec.Bindings.Secrets {
					if secret.Key != ref.BindingKey {
						continue
					}
					for _, use := range secret.Uses {
						key, has := nullableText(use.Key)
						found = found || use.ContextKey == c.Key && use.ServerId == server.ServerId && has == ref.Key.Present && (!has || key == string(ref.Key.Value))
					}
				}
				if !found {
					return invalid("mcp.secretRefs")
				}
			}
		}
	}
	if len(usedArtifacts) != len(artifacts) || len(usedModels) != len(spec.Bindings.Models) {
		return invalid("unusedBindings")
	}
	for _, secret := range spec.Bindings.Secrets {
		for _, use := range secret.Uses {
			c, ok := contexts[string(use.ContextKey)]
			if !ok {
				return invalid("secret.uses")
			}
			found := false
			for _, server := range c.Configuration.McpServers {
				if server.ServerId != use.ServerId {
					continue
				}
				for _, ref := range server.SecretRefs.Value {
					key, has := nullableText(use.Key)
					found = found || ref.BindingKey == secret.Key && has == ref.Key.Present && (!has || key == string(ref.Key.Value))
				}
			}
			if !found {
				return invalid("secret.uses")
			}
		}
	}
	names := map[string]bool{}
	for _, service := range spec.Services {
		if names[service.Name] {
			return invalid("service.name")
		}
		names[service.Name] = true
		var applied *int64
		if err := json.Unmarshal(service.AppliedRevision, &applied); err != nil {
			return invalid("service.head")
		}
		desiredFound, appliedFound := false, applied == nil
		for i, revision := range service.Revisions {
			if i > 0 && service.Revisions[i-1].Revision >= revision.Revision {
				return invalid("service.revisions")
			}
			desiredFound = desiredFound || revision.Revision == service.DesiredRevision
			appliedFound = appliedFound || applied != nil && revision.Revision == *applied
			if revision.Definition.Name != service.Name {
				return invalid("service.revision")
			}
			if key, ok := nullableText(revision.ImageKey); ok {
				if _, exists := images[key]; !exists {
					return invalid("service.image")
				}
			}
			raw, err := json.Marshal(revision.Definition)
			if err != nil {
				return invalid("service.definition")
			}
			if _, err := servicedefinition.Normalize(raw); err != nil {
				return invalid("service.definition")
			}
		}
		if !desiredFound || !appliedFound {
			return invalid("service.head")
		}
	}
	for _, image := range spec.Images {
		if string(image.ImageId) != "sha256:"+string(image.Config) {
			return invalid("image.identity")
		}
		own, has := nullableText(image.Platform.Variant)
		wanted, whas := nullableText(spec.Compatibility.Variant)
		if image.Platform.Os != spec.Compatibility.Os || image.Platform.Architecture != spec.Compatibility.Architecture || own != wanted || has != whas {
			return invalid("image.platform")
		}
		if !ref(image.Config, "image-config") {
			return invalid("image.config")
		}
		for _, layer := range image.Layers {
			if !ref(layer, "image-layer") {
				return invalid("image.layer")
			}
		}
	}
	return nil
}

func decodeMetadata[T any](raw []byte, schema string) (T, error) {
	value, err := contracts.Decode[T](bytes.NewReader(raw), schema, DefaultLimits.MetadataBytes)
	if err != nil {
		return value, invalid(strings.TrimSuffix(schema, "Schema"))
	}
	return value, nil
}
