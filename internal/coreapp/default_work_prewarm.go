package coreapp

import (
	"context"

	"piwork/internal/contracts"
)

func (a *Application) confirmDefaultPreparationRevision(ctx context.Context) error {
	expected, scoped := ctx.Value(preparationDefaultKey{}).(int64)
	if !scoped {
		return ctx.Err()
	}
	defaults, err := a.Store.DefaultWork(ctx)
	if err != nil {
		return err
	}
	if defaults.Revision != expected {
		return errWorkSuperseded
	}
	return ctx.Err()
}

func (a *Application) prewarmDefaultWork(ctx context.Context, profile RuntimeProfile) error {
	if err := a.confirmDefaultPreparationRevision(ctx); err != nil {
		return err
	}
	// Existing unit fixtures replace the entire Docker dependency boundary.
	if a.options.DependencyCheck != nil {
		return nil
	}
	defaults, err := a.Store.DefaultWork(ctx)
	if err != nil {
		return err
	}
	if defaults.Configuration == nil {
		return contracts.NewError("DEFAULT_WORK_NOT_CONFIGURED", "")
	}
	image, _, err := a.resolveWorkImage(ctx, defaults.Configuration.AgentImage.CatalogId)
	if err != nil {
		return err
	}
	ids := []string{image.ID}
	for _, reference := range []string{profile.AgentImage, a.options.PackageHelperImage} {
		if reference == "" {
			continue
		}
		prepared, err := a.preparation.pullImage(ctx, reference)
		if err != nil {
			return err
		}
		ids = append(ids, prepared.ID)
	}
	a.mu.Lock()
	current := a.preparation.currentLocked(ctx)
	if current {
		err = a.inspector.PinAgentImages(ids...)
	}
	a.mu.Unlock()
	if !current {
		return context.Canceled
	}
	if err != nil {
		return err
	}
	needsEnvironment := false
	for _, item := range defaults.Configuration.Packages {
		needsEnvironment = needsEnvironment || item.Enabled
	}
	if needsEnvironment {
		if err := a.environmentCache.Pin(environmentKey{image.ID, 1}); err != nil {
			return err
		}
		if _, err := a.probePackageEnvironment(ctx, image.ID); err != nil {
			return err
		}
	} else if err := a.environmentCache.Pin(); err != nil {
		return err
	}
	return a.confirmDefaultPreparationRevision(ctx)
}
