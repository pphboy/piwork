package coreapp

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/diagnostics"
	"piwork/internal/dockerengine"
	"piwork/internal/pipackage"
)

type environmentKey struct {
	imageID    string
	version    int
	scope      string
	generation uint64
}

const packageEnvironmentRuleVersion = 1

type environmentProbeRuntime interface {
	EnsurePackageHelper(context.Context, dockerengine.PackageHelperSpec) (string, error)
	RunPackageHelper(context.Context, dockerengine.PackageHelperSpec) (json.RawMessage, error)
	RemovePackageHelper(context.Context, dockerengine.PackageHelperSpec) error
}

func cloneEnvironment(value contracts.PiPackagePreparedEnvironment) contracts.PiPackagePreparedEnvironment {
	value.Variant = append([]byte(nil), value.Variant...)
	return value
}

func (a *Application) pinPackageEnvironment(ctx context.Context, imageID string) error {
	key := environmentKey{imageID: imageID, version: packageEnvironmentRuleVersion}
	if a.engine != nil && a.envInspectForTest == nil {
		scope, generation, err := a.engine.VerificationIdentity(ctx)
		if errors.Is(err, dockerengine.ErrEngineIdentity) {
			return a.clearPackageEnvironmentPin()
		}
		if err != nil {
			return err
		}
		key.scope, key.generation = scope, generation
	}
	a.environmentMu.Lock()
	defer a.environmentMu.Unlock()
	if a.environmentPinned != key {
		a.environmentPinnedRecord = nil
	}
	a.environmentPinned = key
	return a.environmentCache.Pin(key)
}

func (a *Application) clearPackageEnvironmentPin() error {
	a.environmentMu.Lock()
	defer a.environmentMu.Unlock()
	a.environmentPinned = environmentKey{}
	a.environmentPinnedRecord = nil
	return a.environmentCache.Pin()
}

func (a *Application) invalidatePackageEnvironment(ctx context.Context, key environmentKey) error {
	a.environmentMu.Lock()
	defer a.environmentMu.Unlock()
	if a.environmentRevisions == nil {
		a.environmentRevisions = make(map[environmentKey]uint64)
	}
	a.environmentRevisions[key]++
	a.environmentCache.Invalidate(key)
	if key.scope != "" {
		if err := a.Store.InvalidateImagePreparations(ctx, key.scope, key.imageID, "environment"); err != nil {
			return contracts.NewError("RUNTIME_UNAVAILABLE", "")
		}
	}
	return nil
}

func (a *Application) probePackageEnvironment(ctx context.Context, imageID string) (contracts.PiPackagePreparedEnvironment, error) {
	var empty contracts.PiPackagePreparedEnvironment
	key := environmentKey{imageID: imageID, version: packageEnvironmentRuleVersion}
	var image dockerengine.PreparedImage
	var err error
	testFixture := a.envInspectForTest != nil
	if testFixture {
		err = a.envInspectForTest(ctx, imageID)
	} else if a.engine == nil || a.dockerRuntime == nil || a.inspector == nil {
		return empty, contracts.NewError("RUNTIME_UNAVAILABLE", "")
	} else {
		key.scope, key.generation, err = a.engine.VerificationIdentity(ctx)
		if errors.Is(err, dockerengine.ErrEngineIdentity) {
			err = nil
		}
		if err == nil {
			image, err = a.engine.InspectImage(ctx, imageID)
		}
		if err == nil {
			_, err = a.inspector.InspectNativeAgent(ctx, imageID)
		}
	}
	if err != nil {
		if errors.Is(err, dockerengine.ErrResourceMissing) || errors.Is(err, dockerengine.ErrSpecification) || errors.Is(err, dockerengine.ErrImageIncompatible) {
			if !testFixture && a.inspector != nil {
				if invalidateErr := a.inspector.InvalidateNativeAgent(ctx, imageID, key.scope, key.generation); invalidateErr != nil {
					return empty, invalidateErr
				}
			}
			if invalidateErr := a.invalidatePackageEnvironment(ctx, key); invalidateErr != nil {
				return empty, invalidateErr
			}
		}
		return empty, err
	}
	if !testFixture && key.scope == "" {
		select {
		case <-ctx.Done():
			return empty, ctx.Err()
		case a.environmentSlots <- struct{}{}:
		}
		defer func() { <-a.environmentSlots }()
		return a.probePackageEnvironmentUncached(ctx, imageID)
	}
	a.environmentMu.Lock()
	if a.environmentPinned.imageID != "" && a.environmentPinned.imageID == imageID && a.environmentPinned != key {
		a.environmentPinned, a.environmentPinnedRecord = key, nil
		if err := a.environmentCache.Pin(key); err != nil {
			a.environmentMu.Unlock()
			return empty, err
		}
	}
	revision := a.environmentRevisions[key]
	a.environmentMu.Unlock()
	result, err := a.environmentCache.Get(ctx, key, func(shared context.Context) (contracts.PiPackagePreparedEnvironment, error) {
		var pk corestore.PreparationKey
		if !testFixture {
			pk = corestore.PreparationKey{Engine: key.scope, Image: imageID, Kind: "environment", Platform: image.OS + "/" + image.Architecture + "/" + image.Variant, Version: packageEnvironmentRuleVersion}
			a.environmentMu.Lock()
			if a.environmentPinned == key {
				pinned := pk
				a.environmentPinnedRecord = &pinned
			}
			a.environmentMu.Unlock()
			raw, found, readErr := a.Store.ReadPreparation(shared, pk)
			if readErr != nil {
				return empty, contracts.NewError("RUNTIME_UNAVAILABLE", "")
			}
			if found {
				value, parseErr := pipackage.ValidateEnvironment(raw)
				if parseErr == nil && environmentMatchesImage(value, image) {
					if err := a.Store.TouchPreparations(shared, []corestore.PreparationKey{pk}); err != nil {
						return empty, contracts.NewError("RUNTIME_UNAVAILABLE", "")
					}
					diagnostics.BeginPerformance(shared, "environment-persistent-hit").End(nil)
					return value, nil
				}
			}
		}
		select {
		case <-shared.Done():
			return empty, shared.Err()
		case a.environmentSlots <- struct{}{}:
		}
		defer func() { <-a.environmentSlots }()
		value, probeErr := a.probePackageEnvironmentUncached(shared, imageID)
		if probeErr != nil || testFixture {
			return value, probeErr
		}
		if !environmentMatchesImage(value, image) {
			return empty, contracts.NewError("PI_PACKAGE_ENVIRONMENT_MISMATCH", "")
		}
		scope, generation, identityErr := a.engine.VerificationIdentity(shared)
		if identityErr != nil || scope != key.scope || generation != key.generation {
			return empty, contracts.NewError("RUNTIME_UNAVAILABLE", "")
		}
		current, inspectErr := a.engine.InspectImage(shared, imageID)
		if inspectErr != nil || current.ID != image.ID || current.OS != image.OS || current.Architecture != image.Architecture || current.Variant != image.Variant {
			return empty, contracts.NewError("RUNTIME_UNAVAILABLE", "")
		}
		raw, marshalErr := json.Marshal(value)
		if marshalErr != nil {
			return empty, contracts.NewError("RUNTIME_UNAVAILABLE", "")
		}
		a.environmentMu.Lock()
		defer a.environmentMu.Unlock()
		if shared.Err() != nil || a.environmentRevisions[key] != revision {
			return empty, context.Canceled
		}
		var pins []corestore.PreparationKey
		if a.environmentPinnedRecord != nil {
			pins = append(pins, *a.environmentPinnedRecord)
		}
		publication, cancel := context.WithTimeout(shared, 2*time.Second)
		defer cancel()
		if _, err := a.Store.WritePreparationFenced(publication, pk, raw, pins, func(publish func() error) error {
			return a.engine.WithVerificationIdentity(key.scope, key.generation, publish)
		}); err != nil {
			return empty, contracts.NewError("RUNTIME_UNAVAILABLE", "")
		}
		return value, nil
	})
	if err == nil && !testFixture {
		scope, generation, identityErr := a.engine.VerificationIdentity(ctx)
		if identityErr != nil || scope != key.scope || generation != key.generation {
			a.environmentCache.Invalidate(key)
			return empty, contracts.NewError("RUNTIME_UNAVAILABLE", "")
		}
	}
	return result, err
}

func environmentMatchesImage(value contracts.PiPackagePreparedEnvironment, image dockerengine.PreparedImage) bool {
	if value.Os != image.OS || value.Architecture != image.Architecture {
		return false
	}
	var variant *string
	if json.Unmarshal(value.Variant, &variant) != nil {
		return false
	}
	return variant == nil && image.Variant == "" || variant != nil && *variant == image.Variant
}
