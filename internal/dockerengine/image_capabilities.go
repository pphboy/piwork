package dockerengine

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"time"

	"piwork/internal/imagestatic"
	"piwork/internal/preparationcache"
	"piwork/internal/safefs"
)

var ErrImageIncompatible = errors.New("image native capabilities are incompatible")
var ErrInspectionStorage = errors.New("image inspection storage is unavailable")

// ImageInspector owns no Docker containers, volumes or networks. It streams
// Engine save bytes into an anonymous fd in an installation-owned private root,
// then checks the archive without running any image code. Core supplies its
// locked installation root/subdirectory and retains ownership of both handles.
type ImageInspector struct {
	engine   *Engine
	root     *safefs.Root
	prefix   string
	gate     chan struct{}
	registry InspectionRegistry
	cache    *preparationcache.Cache[imageInspectionKey, imagestatic.Capabilities]
}

type imageInspectionKey struct {
	imageID, kind string
	version       int
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
	return &ImageInspector{engine: engine, root: root, prefix: prefix, gate: make(chan struct{}, 1), registry: registry,
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
	keys := make([]imageInspectionKey, 0, len(ids))
	for _, id := range ids {
		if !imageIDPattern.MatchString(id) {
			return ErrSpecification
		}
		keys = append(keys, imageInspectionKey{id, "agent", 1})
	}
	return i.cache.Pin(keys...)
}
func (i *ImageInspector) InspectNativeAgent(ctx context.Context, imageID string) (result imagestatic.Capabilities, returned error) {
	return i.inspectNative(ctx, imageID, "agent")
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
	key := imageInspectionKey{imageID, kind, 1}
	image, err := i.engine.InspectImage(ctx, imageID)
	if err != nil {
		if errors.Is(err, ErrResourceMissing) || errors.Is(err, ErrSpecification) {
			i.cache.Invalidate(key)
		}
		return result, err
	}
	if !nativeLabelsCompatible(image, kind) {
		i.cache.Invalidate(key)
		return result, ErrImageIncompatible
	}
	result, err = i.cache.Get(ctx, key, func(shared context.Context) (imagestatic.Capabilities, error) {
		return i.inspectNativeUncached(shared, imageID, kind)
	})
	if err == nil && (result.Identity.ID != image.ID || result.Identity.OS != image.OS || result.Identity.Architecture != image.Architecture || result.Identity.Variant != image.Variant) {
		i.cache.Invalidate(key)
		return imagestatic.Capabilities{}, ErrImageIncompatible
	}
	return result, err
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
	defer file.Close()
	size, err := i.engine.SaveImage(ctx, image.ID, file, imagestatic.MaxArchiveBytes)
	if err != nil {
		return imagestatic.Capabilities{}, err
	}
	identity := imagestatic.Identity{ID: image.ID, OS: image.OS, Architecture: image.Architecture, Variant: image.Variant}
	if kind == "agent" {
		result, err = imagestatic.InspectNativeAgent(ctx, file, size, identity)
	} else {
		result, err = imagestatic.InspectNativeHelper(ctx, file, size, identity, kind)
	}
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
