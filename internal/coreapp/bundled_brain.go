package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"piwork/internal/coreassets"
	"piwork/internal/corestore"
	"piwork/internal/dockerengine"
	"piwork/internal/packageprepare"
)

var errBundledBrain = errors.New("built-in brain package is unavailable")

// This runs before READY. Catalog, default selection and the one-time marker
// commit together only after immutable bytes passed native helper preparation.
func (a *Application) ensureBundledBrain(ctx context.Context) error {
	var seeded bool
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		var raw string
		err := tx.QueryRow("SELECT value_json FROM control_metadata WHERE key='piwork_brain_seeded'").Scan(&raw)
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		if raw != `{"seeded":true}` {
			return errBundledBrain
		}
		seeded = true
		return nil
	}); err != nil {
		return err
	}
	if seeded {
		return nil
	} // Administrative removal/disable/customization is final.
	var prepared packageprepare.Result
	var err error
	if a.prepareBrainForTest != nil {
		prepared, err = a.prepareBrainForTest(ctx)
	} else {
		prepared, err = a.prepareEmbeddedBrain(ctx)
	}
	if err != nil {
		return err
	}
	if prepared.Artifact.Metadata.Name != coreassets.BrainPackageName {
		return errBundledBrain
	}
	storage, err := a.publishCorePackageBytes(ctx, prepared)
	if err != nil {
		return err
	}
	metadata, err := json.Marshal(prepared.Artifact.Metadata)
	if err != nil {
		return err
	}
	return a.Store.Write(ctx, func(tx *sql.Tx) error {
		var exists bool
		if err := tx.QueryRow("SELECT EXISTS(SELECT 1 FROM control_metadata WHERE key='piwork_brain_seeded')").Scan(&exists); err != nil {
			return err
		}
		if exists {
			return nil
		}
		var catalog bool
		if err := tx.QueryRow("SELECT EXISTS(SELECT 1 FROM pi_package_catalog WHERE name=?)", coreassets.BrainPackageName).Scan(&catalog); err != nil {
			return err
		}
		now := packageNow()
		if !catalog {
			artifact := corestore.PackageArtifact{ID: "core:bundled-piwork-brain", ScopeKind: "core", Name: coreassets.BrainPackageName, ContentDigest: string(prepared.Artifact.Metadata.ContentDigest), MetadataJSON: string(metadata), StoragePath: storage, CreatedAt: now}
			if err := corestore.InsertPackageArtifact(tx, artifact); err != nil {
				return err
			}
			if _, err := tx.Exec("INSERT INTO pi_package_catalog(name,enabled,head_artifact_id,generation,created_at,updated_at) VALUES(?,1,?,1,?,?)", artifact.Name, artifact.ID, now, now); err != nil {
				return err
			}
		}
		current, err := corestore.ReadDefaultWorkTx(tx)
		if err != nil {
			return err
		}
		// Revision zero is the fresh-install marker. An administrator's explicit
		// empty/default configuration has a higher revision and must remain intact.
		if current.Revision == 0 && current.Configuration == nil {
			profile, _, err := a.Settings.LoadRuntime()
			if err != nil {
				return err
			}
			config := defaultWorkConfiguration(profile)
			current.Configuration = &config
			current.Revision = 1
			raw, _ := json.Marshal(current)
			if _, err := tx.Exec("UPDATE control_metadata SET value_json=?,updated_at=? WHERE key='default_work_configuration'", string(raw), now); err != nil {
				return err
			}
		}
		_, err = tx.Exec("INSERT INTO control_metadata(key,value_json,updated_at) VALUES('piwork_brain_seeded','{\"seeded\":true}',?)", now)
		return err
	})
}

func (a *Application) prepareEmbeddedBrain(ctx context.Context) (packageprepare.Result, error) {
	if a.dockerRuntime == nil || a.engine == nil {
		return packageprepare.Result{}, errBundledBrain
	}
	profile, configured, err := a.Settings.LoadRuntime()
	if err != nil || !configured {
		return packageprepare.Result{}, errBundledBrain
	}
	image, err := a.engine.PrepareImage(ctx, profile.AgentImage)
	if err != nil {
		return packageprepare.Result{}, err
	}
	trustedRef := a.options.PackageHelperImage
	if trustedRef == "" {
		trustedRef = profile.AgentImage
	}
	trusted, err := a.engine.PrepareImage(ctx, trustedRef)
	if err != nil {
		return packageprepare.Result{}, err
	}
	if _, err = a.inspector.InspectNativeAgent(ctx, trusted.ID); err != nil {
		return packageprepare.Result{}, err
	}
	environment, err := a.probePackageEnvironment(ctx, image.ID)
	if err != nil {
		return packageprepare.Result{}, err
	}
	parent, err := a.Store.OpenPackageArea("jobs")
	if err != nil {
		return packageprepare.Result{}, err
	}
	defer parent.Close()
	const directory = "bundled-piwork-brain"
	root, err := parent.OpenDirectory(directory)
	if err != nil {
		return packageprepare.Result{}, err
	}
	defer root.Close()
	basePath, err := root.Path("unused")
	if err != nil {
		return packageprepare.Result{}, err
	}
	base, err := filepath.EvalSymlinks(filepath.Dir(basePath))
	if err != nil {
		return packageprepare.Result{}, err
	}
	sourceDirectory := filepath.Join(base, "source")
	spool := filepath.Join(base, "spool")
	identity := dockerengine.PackageIdentity{WorkID: "core", JobID: directory}
	epoch := int64(1)
	runtime := a.dockerRuntime
	var plans []dockerengine.ResourcePlan
	if err = a.Store.Read(ctx, func(tx *sql.Tx) error {
		rows, err := tx.Query("SELECT runtime_id,logical_id,labels_json FROM resource_bindings WHERE installation_id=? AND work_id='core' AND resource_kind='package-helper'", a.Store.InstallationID())
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var name, logical, raw string
			if err = rows.Scan(&name, &logical, &raw); err != nil {
				return err
			}
			logical = strings.TrimPrefix(logical, "core/")
			if !strings.HasPrefix(logical, directory+"-") {
				continue
			}
			var labels map[string]string
			if json.Unmarshal([]byte(raw), &labels) != nil {
				return corestore.ErrStorage
			}
			plans = append(plans, dockerengine.ResourcePlan{WorkID: "core", Kind: "package-helper", LogicalID: logical, Name: name, Labels: labels})
		}
		return rows.Err()
	}); err != nil {
		return packageprepare.Result{}, err
	}
	for _, plan := range plans {
		unsettled, err := a.Store.PackageCreationUnsettled(ctx, plan.WorkID, plan.Kind, plan.LogicalID, plan.Name)
		if err != nil {
			return packageprepare.Result{}, err
		}
		if unsettled {
			runtime.MarkPackageCreationUncertain(plan.Name)
		}
		if err = runtime.RemovePlannedPackageHelper(ctx, plan); err != nil {
			return packageprepare.Result{}, err
		}
		if err = a.Store.ReleaseResourceIntent(ctx, plan.WorkID, plan.Kind, plan.LogicalID, true); err != nil {
			return packageprepare.Result{}, err
		}
	}
	// The resource creation intent is persisted by Docker Runtime before creation.
	// Reusing the fixed seed identity lets retry remove a prior crashed prepare.
	if err = runtime.RemovePackageResources(ctx, identity); err != nil {
		return packageprepare.Result{}, err
	}
	for _, name := range []string{"source", "spool"} {
		if err = root.RemoveTree(name); err != nil && !errors.Is(err, os.ErrNotExist) {
			return packageprepare.Result{}, err
		}
	}
	if err = root.EnsureDirectory("spool"); err != nil {
		return packageprepare.Result{}, err
	}
	if err = os.Mkdir(sourceDirectory, 0755); err != nil {
		return packageprepare.Result{}, err
	}
	source, err := os.OpenRoot(sourceDirectory)
	if err != nil {
		return packageprepare.Result{}, err
	}
	defer source.Close()
	archive, err := coreassets.BrainPackageArchive()
	if err != nil {
		return packageprepare.Result{}, err
	}
	for name, data := range map[string][]byte{"input.zip": archive, "request.json": []byte(`{"source":{"kind":"local","displayName":"piwork-brain"}}`)} {
		file, err := source.OpenFile(name, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0644)
		if err != nil {
			return packageprepare.Result{}, err
		}
		_, writeErr := file.Write(data)
		syncErr := file.Sync()
		closeErr := file.Close()
		if err = errors.Join(writeErr, syncErr, closeErr); err != nil {
			return packageprepare.Result{}, err
		}
	}
	result, err := packageprepare.Prepare(ctx, packageprepare.Input{Runtime: runtime, Identity: identity, Epoch: epoch, PrepareImageID: image.ID, TrustedImageID: trusted.ID, SourceDirectory: sourceDirectory, SpoolDirectory: spool, Environment: environment,
		OnPlanned: func(ctx context.Context, spec dockerengine.PackageHelperSpec) error { return nil },
		OnRemoved: func(ctx context.Context, spec dockerengine.PackageHelperSpec) error {
			return a.Store.ReleaseResourceIntent(ctx, "core", "package-helper", directory+"-"+strconv.FormatInt(epoch, 10)+"-"+spec.Action, true)
		},
		OnResourcesRemoved: func(ctx context.Context) error {
			if err := runtime.ConfirmPackageAbsence(ctx, identity); err != nil {
				return err
			}
			for _, kind := range []string{"package-network", "package-volume"} {
				if err := a.Store.ReleaseResourceIntent(ctx, "core", kind, directory, true); err != nil {
					return err
				}
			}
			return nil
		}})
	return result, err
}
