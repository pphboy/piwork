package coreapp

import (
	"context"
	"encoding/json"
	"errors"

	"piwork/internal/contracts"
	"piwork/internal/dockerengine"
)

type environmentKey struct {
	imageID string
	version int
}

type environmentProbeRuntime interface {
	EnsurePackageHelper(context.Context, dockerengine.PackageHelperSpec) (string, error)
	RunPackageHelper(context.Context, dockerengine.PackageHelperSpec) (json.RawMessage, error)
	RemovePackageHelper(context.Context, dockerengine.PackageHelperSpec) error
}

func cloneEnvironment(value contracts.PiPackagePreparedEnvironment) contracts.PiPackagePreparedEnvironment {
	value.Variant = append([]byte(nil), value.Variant...)
	return value
}

func (a *Application) probePackageEnvironment(ctx context.Context, imageID string) (contracts.PiPackagePreparedEnvironment, error) {
	var empty contracts.PiPackagePreparedEnvironment
	key := environmentKey{imageID, 1}
	var err error
	if a.envInspectForTest != nil {
		err = a.envInspectForTest(ctx, imageID)
	} else if a.engine == nil || a.dockerRuntime == nil {
		return empty, contracts.NewError("RUNTIME_UNAVAILABLE", "")
	} else {
		_, err = a.engine.InspectImage(ctx, imageID)
	}
	if err != nil {
		if errors.Is(err, dockerengine.ErrResourceMissing) || errors.Is(err, dockerengine.ErrSpecification) {
			a.environmentCache.Invalidate(key)
		}
		return empty, err
	}
	return a.environmentCache.Get(ctx, key, func(shared context.Context) (contracts.PiPackagePreparedEnvironment, error) {
		select {
		case <-shared.Done():
			return empty, shared.Err()
		case a.environmentSlots <- struct{}{}:
		}
		defer func() { <-a.environmentSlots }()
		return a.probePackageEnvironmentUncached(shared, imageID)
	})
}
