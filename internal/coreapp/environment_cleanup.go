package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"

	"piwork/internal/dockerengine"
)

// Shared probes have no public Operation. After their workers have returned,
// settle their exact durable helper intents, including an earlier failed remove.
func (a *Application) closeEnvironmentProbes(ctx context.Context) error {
	failure := errors.New("Core environment probe cleanup was not confirmed")
	if ctx.Err() != nil {
		return failure
	}
	var plans []dockerengine.ResourcePlan
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		rows, err := tx.QueryContext(ctx, `SELECT logical_id,runtime_id,labels_json FROM resource_bindings WHERE installation_id=? AND work_id='core' AND resource_kind='package-helper' AND logical_id LIKE 'core/probe-%'`, a.Store.InstallationID())
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			plan := dockerengine.ResourcePlan{WorkID: "core", Kind: "package-helper"}
			var logical, raw string
			if err := rows.Scan(&logical, &plan.Name, &raw); err != nil {
				return err
			}
			if json.Unmarshal([]byte(raw), &plan.Labels) != nil || !strings.HasPrefix(plan.Labels[dockerengine.PackageJobLabel], "probe-") {
				return failure
			}
			plan.LogicalID = strings.TrimPrefix(logical, "core/")
			plans = append(plans, plan)
		}
		return rows.Err()
	}); err != nil {
		return failure
	}
	for _, plan := range plans {
		if a.dockerRuntime == nil {
			return failure
		}
		unsettled, err := a.Store.PackageCreationUnsettled(ctx, plan.WorkID, plan.Kind, plan.LogicalID, plan.Name)
		if err != nil {
			return failure
		}
		if unsettled {
			a.dockerRuntime.MarkPackageCreationUncertain(plan.Name)
		}
		if err := a.dockerRuntime.RemovePlannedPackageHelper(ctx, plan); err != nil {
			return failure
		}
		if err := a.Store.ReleaseResourceIntent(ctx, plan.WorkID, plan.Kind, plan.LogicalID, true); err != nil {
			return failure
		}
	}
	return nil
}
