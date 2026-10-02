package coreapp

import (
	"context"
	"database/sql"
	"github.com/google/uuid"
	"path/filepath"
	"strings"
	"time"

	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/diagnostics"
	"piwork/internal/pipackage"
	"piwork/internal/workcontext"
)

func (a *Application) buildWorkContext(ctx context.Context, workID, priorID string, reselectSkills bool, config contracts.WorkConfig, imageID, now string, override *workcontext.PackageSource) (published workcontext.Published, returned error) {
	if trace := traceFrom(ctx); trace != nil {
		if err := trace.observe(ctx, diagnostics.Event{Component: "core", Stage: "context-copy", Outcome: "started", Code: "CONTEXT_COPY_FAILED"}); err != nil {
			return published, err
		}
		defer func() {
			outcome := "succeeded"
			if returned != nil {
				outcome = "failed"
			}
			if err := trace.observe(ctx, diagnostics.Event{Component: "core", Stage: "context-copy", Outcome: outcome, Code: "CONTEXT_COPY_FAILED"}); err != nil {
				returned = err
			}
			if returned != nil {
				return
			}
			for _, skill := range config.Skills {
				for _, outcome := range []string{"started", "succeeded"} {
					if err := trace.observe(ctx, diagnostics.Event{Component: "core", Stage: "skill-validate", Outcome: outcome, Code: "SKILL_VALIDATION_FAILED", SkillName: string(skill)}); err != nil {
						returned = err
						return
					}
				}
			}
			for _, outcome := range []string{"started", "succeeded"} {
				if err := trace.observe(ctx, diagnostics.Event{Component: "core", Stage: "context-validate", Outcome: outcome, Code: "SKILL_VALIDATION_FAILED"}); err != nil {
					returned = err
					return
				}
			}
		}()
	}
	selection := contracts.PiPackageSelection{}
	for _, item := range config.Packages {
		if override == nil || string(item.Name) != override.Name {
			selection = append(selection, item)
		}
	}
	sources := []workcontext.PackageSource{}
	if priorID != "" {
		var err error
		sources, err = workcontext.LoadPackageSources(a.Store, a.options.DataDirectory, workID, priorID, selection)
		if err != nil {
			return published, err
		}
	} else if len(selection) > 0 {
		var captured []corestore.PackageArtifact
		leaseKey := "package_context_lease_" + strings.ReplaceAll(uuid.NewString(), "-", "")
		if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
			names := make([]string, 0, len(selection))
			for _, item := range selection {
				names = append(names, string(item.Name))
			}
			var err error
			captured, err = corestore.LeaseContextPackages(tx, leaseKey, names, packageNow())
			return err
		}); err != nil {
			return published, packagePublicError(err)
		}
		defer func() {
			cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if err := a.Store.Write(cleanup, func(tx *sql.Tx) error { return corestore.ReleaseContextPackageLeases(tx, leaseKey) }); err != nil {
				returned = err
			}
		}()
		for _, item := range captured {
			metadata, err := contracts.Decode[contracts.PiPackageArtifactMetadata](strings.NewReader(item.MetadataJSON), "PiPackageArtifactMetadataSchema", 2<<20)
			if err != nil || string(metadata.Name) != item.Name || string(metadata.ContentDigest) != item.ContentDigest || filepath.Clean(item.StoragePath) != item.StoragePath || filepath.IsAbs(item.StoragePath) || !strings.HasPrefix(item.StoragePath, "pi-packages/artifacts/") {
				return published, corestore.ErrStorage
			}
			sources = append(sources, workcontext.PackageSource{Name: item.Name, Directory: filepath.Join(a.options.DataDirectory, item.StoragePath), Metadata: metadata})
		}
	}
	ordered := make([]workcontext.PackageSource, 0, len(config.Packages))
	for _, selected := range config.Packages {
		var source *workcontext.PackageSource
		if override != nil && override.Name == string(selected.Name) {
			source = override
		}
		for i := range sources {
			if sources[i].Name == string(selected.Name) {
				source = &sources[i]
			}
		}
		if source == nil {
			return published, contracts.NewError("PI_PACKAGE_NOT_INSTALLED", "packages")
		}
		ordered = append(ordered, *source)
	}
	var environment *contracts.PiPackagePreparedEnvironment
	for i, source := range ordered {
		if !config.Packages[i].Enabled {
			continue
		}
		if environment == nil {
			if a.dockerRuntime == nil {
				return published, contracts.NewError("RUNTIME_UNAVAILABLE", "")
			}
			value, err := a.probePackageEnvironment(ctx, imageID)
			if err != nil {
				return published, err
			}
			environment = &value
		}
		if err := pipackage.AssertEnvironment(source.Metadata.PreparedEnvironment, *environment); err != nil {
			return published, contracts.NewError("PI_PACKAGE_ENVIRONMENT_MISMATCH", "packages")
		}
	}
	return workcontext.BuildWithPackages(a.Store, a.options.DataDirectory, workID, priorID, reselectSkills, config, imageID, now, ordered)
}

func validateSelectedPackagesTx(tx *sql.Tx, selection contracts.PiPackageSelection) error {
	seen := map[string]bool{}
	for _, item := range selection {
		name := string(item.Name)
		if !item.Enabled || !pipackage.ValidName(name) || seen[name] {
			return contracts.NewError("INVALID_REQUEST", "packages")
		}
		seen[name] = true
		var available bool
		if err := tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM pi_package_catalog WHERE name=? AND enabled=1)`, name).Scan(&available); err != nil {
			return err
		}
		if !available {
			return contracts.NewError("PI_PACKAGE_NOT_FOUND", "packages")
		}
	}
	return nil
}
