package dockerengine

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"time"

	"piwork/internal/imagestatic"
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
}

type InspectionRegistry interface {
	InstallationID() string
	BeginImageInspection(context.Context, string, string) error
	CompleteImageInspection(context.Context, string) error
	RecoverImageInspections(context.Context) error
}

func NewImageInspector(ctx context.Context, engine *Engine, root *safefs.Root, registry InspectionRegistry) (*ImageInspector, error) {
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
	return &ImageInspector{engine: engine, root: root, prefix: prefix, gate: make(chan struct{}, 1), registry: registry}, nil
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
	if kind == "agent" && (image.Labels["io.piwork.agent.protocol"] != "v2" || image.Labels["io.piwork.package-helper.contract"] != "2" || image.Labels["io.piwork.service-mcp.contract"] != "1") || kind == "file" && image.Labels["piwork.file_protocol"] != "1" || kind == "snapshot" && image.Labels["piwork.snapshot_protocol"] != "1" {
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
