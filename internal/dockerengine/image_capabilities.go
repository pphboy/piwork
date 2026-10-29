package dockerengine

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"sync"
	"time"

	"piwork/internal/corestore"
	"piwork/internal/diagnostics"
	"piwork/internal/imagestatic"
	"piwork/internal/pipackage"
	"piwork/internal/preparationcache"
	"piwork/internal/safefs"
)

// validStoredCapabilities treats persisted data as untrusted derived state. A
// malformed or incomplete entry is a miss and must be inspected again.
func validStoredCapabilities(value imagestatic.Capabilities, identity imagestatic.Identity, kind string) bool {
	if value.Identity != identity {
		return false
	}
	validDigest := imageIDPattern.MatchString
	if value.Environment != nil {
		raw, err := json.Marshal(value.Environment)
		if err != nil {
			return false
		}
		env, err := pipackage.ValidateEnvironment(raw)
		if err != nil || env.Os != identity.OS || env.Architecture != identity.Architecture {
			return false
		}
		var variant *string
		if json.Unmarshal(env.Variant, &variant) != nil {
			return false
		}
		if variant == nil && identity.Variant != "" || variant != nil && *variant != identity.Variant {
			return false
		}
	}
	switch kind {
	case "agent":
		return (value.WorkHistorySchema == 4 || value.WorkHistorySchema == 5) && value.PackageHelper && value.ServiceMCP && validDigest(value.PackageHelperSHA256) && validDigest(value.ServiceMCPSHA256)
	case "file":
		return value.FileHelper && validDigest(value.FileHelperSHA256)
	case "snapshot":
		return value.SnapshotHelper && validDigest(value.SnapshotHelperSHA256)
	default:
		return false
	}
}

var ErrImageIncompatible = errors.New("image native capabilities are incompatible")
var ErrInspectionStorage = errors.New("image inspection storage is unavailable")

// ImageInspector owns no Docker containers, volumes or networks. It streams
// Engine save bytes into an anonymous fd in an installation-owned private root,
// then checks the archive without running any image code. Core supplies its
// locked installation root/subdirectory and retains ownership of both handles.
type ImageInspector struct {
	engine         *Engine
	root           *safefs.Root
	prefix         string
	gate           chan struct{}
	registry       InspectionRegistry
	cache          *preparationcache.Cache[imageInspectionKey, imagestatic.Capabilities]
	mu             sync.Mutex
	pins           []string
	scope          string
	generation     uint64
	revisions      map[imageInspectionKey]uint64
	knownAgentKeys map[string]corestore.PreparationKey
}

type imageInspectionKey struct {
	imageID, kind string
	version       int
	scope         string
	generation    uint64
}

func cloneCapabilities(value imagestatic.Capabilities) imagestatic.Capabilities {
	if value.Environment != nil {
		environment := *value.Environment
		environment.Variant = append([]byte(nil), environment.Variant...)
		value.Environment = &environment
	}
	return value
}

type InspectionRegistry interface {
	InstallationID() string
	BeginImageInspection(context.Context, string, string) error
	CompleteImageInspection(context.Context, string) error
	RecoverImageInspections(context.Context) error
}

// Each capability contract can evolve without invalidating unrelated kinds.
const (
	agentInspectionRuleVersion    = 1
	fileInspectionRuleVersion     = 1
	snapshotInspectionRuleVersion = 1
)

func inspectionRuleVersion(kind string) int {
	switch kind {
	case "agent":
		return agentInspectionRuleVersion
	case "file":
		return fileInspectionRuleVersion
	case "snapshot":
		return snapshotInspectionRuleVersion
	default:
		return 0
	}
}

func NewImageInspector(ctx context.Context, engine *Engine, root *safefs.Root, registry InspectionRegistry) (*ImageInspector, error) {
	return NewImageInspectorWithLifecycle(ctx, ctx, engine, root, registry)
}

// lifecycle must be Core's lifetime, never a single preparation attempt.
func NewImageInspectorWithLifecycle(ctx, lifecycle context.Context, engine *Engine, root *safefs.Root, registry InspectionRegistry) (*ImageInspector, error) {
	if registry == nil {
		return nil, ErrSpecification
	}
	installationID := registry.InstallationID()
	if engine == nil || root == nil || !identityPattern.MatchString(installationID) || root.CheckPrivate() != nil {
		return nil, ErrSpecification
	}
	h := sha256.Sum256([]byte(installationID))
	prefix := "image-inspection-" + hex.EncodeToString(h[:16])
	if err := root.RecoverAnonymousPlaceholders(prefix); err != nil {
		return nil, ErrInspectionStorage
	}
	if err := registry.RecoverImageInspections(ctx); err != nil {
		return nil, ErrInspectionStorage
	}
	return &ImageInspector{engine: engine, root: root, prefix: prefix, gate: make(chan struct{}, 1), registry: registry, revisions: make(map[imageInspectionKey]uint64), knownAgentKeys: make(map[string]corestore.PreparationKey),
		cache: preparationcache.New[imageInspectionKey](lifecycle, preparationcache.Options[imagestatic.Capabilities]{Clone: cloneCapabilities, Phase: "image-inspection"})}, nil
}

func (i *ImageInspector) Close(ctx context.Context) error {
	if err := i.cache.Close(ctx); err != nil {
		return err
	}
	// All anonymous fds have been closed. Settle any metadata cleanup whose
	// response failed earlier; no active inspection can be erased here.
	if ctx.Err() == nil {
		if err := i.root.RecoverAnonymousPlaceholders(i.prefix); err != nil {
			return ErrInspectionStorage
		}
		if err := i.registry.RecoverImageInspections(ctx); err != nil {
			return ErrInspectionStorage
		}
	}
	return nil
}

func (i *ImageInspector) InspectionsActive() bool { return i.cache.Stats().Flights != 0 }

func (i *ImageInspector) PreparationStats() preparationcache.Stats { return i.cache.Stats() }

func (i *ImageInspector) PinAgentImages(ids ...string) error {
	for _, id := range ids {
		if !imageIDPattern.MatchString(id) {
			return ErrSpecification
		}
	}
	i.mu.Lock()
	defer i.mu.Unlock()
	i.pins = append([]string(nil), ids...)
	return i.pinLocked()
}

func (i *ImageInspector) pinLocked() error {
	keys := make([]imageInspectionKey, 0, len(i.pins))
	for _, id := range i.pins {
		keys = append(keys, imageInspectionKey{imageID: id, kind: "agent", version: 1, scope: i.scope, generation: i.generation})
	}
	return i.cache.Pin(keys...)
}
func (i *ImageInspector) InspectNativeAgent(ctx context.Context, imageID string) (result imagestatic.Capabilities, returned error) {
	return i.inspectNative(ctx, imageID, "agent")
}

// InvalidateNativeAgent is used when another preparation path independently
// observes that a captured image is missing or incompatible.
func (i *ImageInspector) InvalidateNativeAgent(ctx context.Context, imageID, scope string, generation uint64) error {
	if !imageIDPattern.MatchString(imageID) {
		return ErrSpecification
	}
	return i.invalidateImage(ctx, imageInspectionKey{imageID: imageID, kind: "agent", version: 1, scope: scope, generation: generation})
}
func (i *ImageInspector) InspectNativeFileHelper(ctx context.Context, imageID string) (imagestatic.Capabilities, error) {
	return i.inspectNative(ctx, imageID, "file")
}
func (i *ImageInspector) InspectNativeSnapshotHelper(ctx context.Context, imageID string) (imagestatic.Capabilities, error) {
	return i.inspectNative(ctx, imageID, "snapshot")
}
func (i *ImageInspector) inspectNative(ctx context.Context, imageID, kind string) (result imagestatic.Capabilities, returned error) {
	if !imageIDPattern.MatchString(imageID) {
		return imagestatic.Capabilities{}, ErrSpecification
	}
	if err := ctx.Err(); err != nil {
		return imagestatic.Capabilities{}, err
	}
	scope, generation, identityErr := i.engine.VerificationIdentity(ctx)
	if identityErr != nil && !errors.Is(identityErr, ErrEngineIdentity) {
		return result, identityErr
	}
	key := imageInspectionKey{imageID: imageID, kind: kind, version: 1, scope: scope, generation: generation}
	i.mu.Lock()
	if i.scope != scope || i.generation != generation {
		i.scope, i.generation = scope, generation
		i.knownAgentKeys = make(map[string]corestore.PreparationKey)
		if err := i.pinLocked(); err != nil {
			i.mu.Unlock()
			return result, err
		}
	}
	i.mu.Unlock()
	image, err := i.engine.InspectImage(ctx, imageID)
	if err != nil {
		if errors.Is(err, ErrResourceMissing) || errors.Is(err, ErrSpecification) {
			if invalidateErr := i.invalidateImage(ctx, key); invalidateErr != nil {
				return result, invalidateErr
			}
		}
		return result, err
	}
	if !nativeLabelsCompatible(image, kind) {
		if err := i.invalidateImage(ctx, key); err != nil {
			return result, err
		}
		return result, ErrImageIncompatible
	}
	if scope == "" {
		// No stable daemon identity: do not retain a result whose Engine
		// could be replaced behind the same socket without our knowledge.
		return i.inspectNativeUncached(ctx, imageID, kind)
	}
	i.mu.Lock()
	revision := i.revisions[key]
	i.mu.Unlock()
	result, err = i.cache.Get(ctx, key, func(shared context.Context) (imagestatic.Capabilities, error) {
		identity := imagestatic.Identity{ID: image.ID, OS: image.OS, Architecture: image.Architecture, Variant: image.Variant}
		store, persistent := i.registry.(*corestore.Store)
		if !persistent || scope == "" {
			return i.inspectNativeUncached(shared, imageID, kind)
		}
		pk := corestore.PreparationKey{Engine: scope, Image: imageID, Kind: kind, Platform: image.OS + "/" + image.Architecture + "/" + image.Variant, Version: inspectionRuleVersion(kind)}
		if kind == "agent" {
			i.mu.Lock()
			if i.scope == scope && i.generation == generation {
				i.knownAgentKeys[imageID] = pk
			}
			i.mu.Unlock()
		}
		raw, found, err := store.ReadPreparation(shared, pk)
		if err != nil {
			return imagestatic.Capabilities{}, ErrInspectionStorage
		}
		if found {
			var value imagestatic.Capabilities
			decoder := json.NewDecoder(bytes.NewReader(raw))
			decoder.DisallowUnknownFields()
			if decoder.Decode(&value) == nil && validStoredCapabilities(value, identity, kind) {
				if err := store.TouchPreparations(shared, []corestore.PreparationKey{pk}); err != nil {
					return imagestatic.Capabilities{}, ErrInspectionStorage
				}
				diagnostics.BeginPerformance(shared, kind+"-image-persistent-hit").End(nil)
				return value, nil
			}
		}
		value, err := i.inspectNativeUncached(shared, imageID, kind)
		if err != nil {
			return value, err
		}
		currentScope, currentGeneration, err := i.engine.VerificationIdentity(shared)
		if err != nil || currentScope != scope || currentGeneration != generation {
			return imagestatic.Capabilities{}, ErrUnavailable
		}
		current, err := i.engine.InspectImage(shared, imageID)
		if err != nil || !nativeLabelsCompatible(current, kind) || current.ID != image.ID || current.OS != image.OS || current.Architecture != image.Architecture || current.Variant != image.Variant {
			return imagestatic.Capabilities{}, ErrImageIncompatible
		}
		encoded, err := json.Marshal(value)
		if err != nil {
			return imagestatic.Capabilities{}, ErrInspectionStorage
		}
		i.mu.Lock()
		defer i.mu.Unlock()
		if shared.Err() != nil || i.revisions[key] != revision || i.scope != scope || i.generation != generation {
			return imagestatic.Capabilities{}, context.Canceled
		}
		pins := make([]corestore.PreparationKey, 0, len(i.pins))
		for _, id := range i.pins {
			if pinned, ok := i.knownAgentKeys[id]; ok {
				pins = append(pins, pinned)
			}
		}
		publication, cancel := context.WithTimeout(shared, 2*time.Second)
		defer cancel()
		_, err = store.WritePreparationFenced(publication, pk, encoded, pins, func(publish func() error) error {
			return i.engine.withVerificationIdentity(scope, generation, publish)
		})
		if err != nil {
			if errors.Is(err, ErrUnavailable) {
				return imagestatic.Capabilities{}, err
			}
			return imagestatic.Capabilities{}, ErrInspectionStorage
		}
		return value, nil
	})
	if errors.Is(err, ErrImageIncompatible) || errors.Is(err, ErrResourceMissing) || errors.Is(err, ErrSpecification) {
		if invalidateErr := i.invalidateImage(ctx, key); invalidateErr != nil {
			return imagestatic.Capabilities{}, invalidateErr
		}
	}
	if err == nil {
		currentScope, currentGeneration, identityErr := i.engine.VerificationIdentity(ctx)
		if identityErr != nil || currentScope != scope || currentGeneration != generation {
			i.cache.Invalidate(key)
			return imagestatic.Capabilities{}, ErrUnavailable
		}
	}
	if err == nil && (result.Identity.ID != image.ID || result.Identity.OS != image.OS || result.Identity.Architecture != image.Architecture || result.Identity.Variant != image.Variant) {
		if err := i.invalidateImage(ctx, key); err != nil {
			return imagestatic.Capabilities{}, err
		}
		return imagestatic.Capabilities{}, ErrImageIncompatible
	}
	return result, err
}

func (i *ImageInspector) invalidateImage(ctx context.Context, key imageInspectionKey) error {
	i.mu.Lock()
	defer i.mu.Unlock()
	i.revisions[key]++
	i.cache.Invalidate(key)
	if store, ok := i.registry.(*corestore.Store); ok && key.scope != "" {
		if err := store.InvalidateImagePreparations(ctx, key.scope, key.imageID, key.kind); err != nil {
			return ErrInspectionStorage
		}
	}
	return nil
}

func nativeLabelsCompatible(image PreparedImage, kind string) bool {
	switch kind {
	case "agent":
		return image.Labels["io.piwork.agent.protocol"] == "v2" && image.Labels["io.piwork.package-helper.contract"] == "2" && image.Labels["io.piwork.service-mcp.contract"] == "1"
	case "file":
		return image.Labels["piwork.file_protocol"] == "1"
	case "snapshot":
		return image.Labels["piwork.snapshot_protocol"] == "1"
	}
	return false
}

func (i *ImageInspector) inspectNativeUncached(ctx context.Context, imageID, kind string) (result imagestatic.Capabilities, returned error) {
	// Serialize the large archive scratch allocation. Waiting is cancellable.
	select {
	case <-ctx.Done():
		return imagestatic.Capabilities{}, ctx.Err()
	case i.gate <- struct{}{}:
	}
	defer func() { <-i.gate }()
	if err := ctx.Err(); err != nil {
		return imagestatic.Capabilities{}, err
	}
	image, err := i.engine.InspectImage(ctx, imageID)
	if err != nil {
		return imagestatic.Capabilities{}, err
	}
	if !nativeLabelsCompatible(image, kind) {
		return imagestatic.Capabilities{}, ErrImageIncompatible
	}
	var nonce [16]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		return imagestatic.Capabilities{}, ErrInspectionStorage
	}
	inspectionID := hex.EncodeToString(nonce[:])
	if err := i.registry.BeginImageInspection(ctx, inspectionID, image.ID); err != nil {
		return imagestatic.Capabilities{}, ErrInspectionStorage
	}
	defer func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		if err := i.registry.CompleteImageInspection(cleanup, inspectionID); err != nil && returned == nil {
			result = imagestatic.Capabilities{}
			returned = ErrInspectionStorage
		}
	}()
	file, err := i.root.AnonymousFile(i.prefix)
	if err != nil {
		return imagestatic.Capabilities{}, ErrInspectionStorage
	}
	// Closing the scratch descriptor is part of the inspection's completion.
	// A future durable success record must never be published when cleanup has
	// not been confirmed. This defer runs before CompleteImageInspection above.
	defer func() {
		if err := file.Close(); err != nil && returned == nil {
			result = imagestatic.Capabilities{}
			returned = ErrInspectionStorage
		}
	}()
	exportSpan := diagnostics.BeginPerformance(ctx, "image-export")
	size, err := i.engine.SaveImage(ctx, image.ID, file, imagestatic.MaxArchiveBytes)
	exportSpan.End(err)
	if err != nil {
		return imagestatic.Capabilities{}, err
	}
	identity := imagestatic.Identity{ID: image.ID, OS: image.OS, Architecture: image.Architecture, Variant: image.Variant}
	scanSpan := diagnostics.BeginPerformance(ctx, "image-scan")
	if kind == "agent" {
		result, err = imagestatic.InspectNativeAgent(ctx, file, size, identity)
	} else {
		result, err = imagestatic.InspectNativeHelper(ctx, file, size, identity, kind)
	}
	scanSpan.End(err)
	if err != nil {
		if ctx.Err() != nil {
			return imagestatic.Capabilities{}, ctx.Err()
		}
		if errors.Is(err, imagestatic.ErrLimit) {
			return imagestatic.Capabilities{}, ErrStreamLimit
		}
		return imagestatic.Capabilities{}, ErrImageIncompatible
	}
	return result, nil
}
