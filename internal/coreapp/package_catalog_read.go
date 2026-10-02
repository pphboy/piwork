package coreapp

import (
	"context"
	"database/sql"
	"net/http"
	"net/url"
	"strings"

	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/pipackage"
)

func (a *Application) packageCatalog(ctx context.Context, privileged bool, name string, detail bool) (any, error) {
	selected := make(map[string]struct{})
	defaults, err := a.Store.DefaultWork(ctx)
	if err != nil {
		return nil, err
	}
	if defaults.Configuration != nil {
		for _, item := range defaults.Configuration.Packages {
			selected[string(item.Name)] = struct{}{}
		}
	}
	type entry struct {
		contracts.PiPackageCatalogEntry
		ResolvedSource string `json:"resolvedSource,omitempty"`
	}
	items := []entry{}
	err = a.Store.Read(ctx, func(tx *sql.Tx) error {
		query := `SELECT c.name,c.enabled,a.metadata_json FROM pi_package_catalog c JOIN pi_package_artifacts a ON a.id=c.head_artifact_id`
		args := []any{}
		conditions := []string{}
		if !privileged {
			conditions = append(conditions, `c.enabled=1`)
		}
		if detail {
			conditions = append(conditions, `c.name=?`)
			args = append(args, name)
		}
		if len(conditions) > 0 {
			query += ` WHERE ` + strings.Join(conditions, ` AND `)
		}
		query += ` ORDER BY c.name`
		rows, err := tx.QueryContext(ctx, query, args...)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var packageName, metadataJSON string
			var enabled bool
			if err := rows.Scan(&packageName, &enabled, &metadataJSON); err != nil {
				return err
			}
			metadata, err := contracts.Decode[contracts.PiPackageArtifactMetadata](strings.NewReader(metadataJSON), "PiPackageArtifactMetadataSchema", 2<<20)
			if err != nil || string(metadata.Name) != packageName {
				return corestore.ErrStorage
			}
			_, isDefault := selected[packageName]
			items = append(items, entry{PiPackageCatalogEntry: contracts.PiPackageCatalogEntry{Name: metadata.Name, Version: metadata.Version, SourceKind: metadata.SourceKind, Enabled: enabled, IsDefault: isDefault, ResourceCounts: metadata.ResourceCounts}, ResolvedSource: metadata.ResolvedSource})
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	if detail {
		if len(items) != 1 {
			return nil, contracts.NewError("PI_PACKAGE_NOT_FOUND", "")
		}
		return items[0], nil
	}
	// The summary endpoint does not expose resolvedSource or internal identity.
	summaries := make([]contracts.PiPackageCatalogEntry, 0, len(items))
	for _, item := range items {
		summaries = append(summaries, item.PiPackageCatalogEntry)
	}
	return map[string]any{"packages": summaries}, nil
}

func (a *Application) packageCatalogHTTP(w http.ResponseWriter, r *http.Request, privileged bool, prefix string) (bool, error) {
	if r.Method != http.MethodGet {
		return false, nil
	}
	path := r.URL.EscapedPath()
	if path == prefix+"/packages" {
		view, err := a.packageCatalog(r.Context(), privileged, "", false)
		if err == nil {
			send(w, http.StatusOK, view)
		}
		return true, err
	}
	if !strings.HasPrefix(path, prefix+"/packages/") {
		return false, nil
	}
	encoded := strings.TrimPrefix(path, prefix+"/packages/")
	if encoded == "" || strings.Contains(encoded, "/") {
		return false, nil
	}
	name, err := url.PathUnescape(encoded)
	if err != nil || !pipackage.ValidName(name) {
		return true, contracts.NewError("PI_PACKAGE_NOT_FOUND", "")
	}
	view, err := a.packageCatalog(r.Context(), privileged, name, true)
	if err == nil {
		send(w, http.StatusOK, view)
	}
	return true, err
}
