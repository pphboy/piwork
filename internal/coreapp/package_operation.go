package coreapp

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"

	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/pipackage"
)

func packageSafeFailureCode(code string) bool {
	switch code {
	case "PI_PACKAGE_CANDIDATE_CONFLICT", "PI_PACKAGE_CANDIDATE_CHANGED":
		return true
	case "PI_PACKAGE_INVALID_SOURCE", "PI_PACKAGE_INVALID_MANIFEST", "PI_PACKAGE_UNSAFE_ARCHIVE", "PI_PACKAGE_LIMIT_EXCEEDED", "PI_PACKAGE_UNSUPPORTED_MEDIA_TYPE", "PI_PACKAGE_SDK_VERSION_UNSUPPORTED", "PI_PACKAGE_SOURCE_FETCH_FAILED", "PI_PACKAGE_DEPENDENCY_INSTALL_FAILED", "PI_PACKAGE_PREPARATION_FAILED", "PI_PACKAGE_INTERRUPTED", "PI_PACKAGE_CLEANUP_PENDING", "PI_PACKAGE_ALREADY_INSTALLED", "PI_PACKAGE_NAME_MISMATCH", "PI_PACKAGE_NOT_FOUND", "PI_PACKAGE_ENVIRONMENT_MISMATCH":
		return true
	}
	return false
}

func (a *Application) corePackageOperationHTTP(w http.ResponseWriter, r *http.Request, prefix string) (bool, error) {
	path := r.URL.EscapedPath()
	if r.Method != http.MethodGet || !strings.HasPrefix(path, prefix+"/operations/") {
		return false, nil
	}
	encoded := strings.TrimPrefix(path, prefix+"/operations/")
	id, err := url.PathUnescape(encoded)
	if err != nil || strings.Contains(encoded, "/") || !validResourceID(id) {
		return true, contracts.NewError("PI_PACKAGE_NOT_FOUND", "")
	}
	operation, err := a.Store.Operation(r.Context(), id)
	if errors.Is(err, corestore.ErrNotFound) || err == nil && (operation.WorkID != nil || operation.Kind != "pi-package-install" && operation.Kind != "pi-package-update") {
		return true, contracts.NewError("PI_PACKAGE_NOT_FOUND", "")
	}
	if err != nil {
		return true, err
	}
	var job corestore.PackageJob
	err = a.Store.Read(r.Context(), func(tx *sql.Tx) error { var err error; job, err = corestore.ReadPackageJob(tx, id); return err })
	if err != nil {
		return true, corestore.ErrStorage
	}
	if job.ScopeKind != "core" || job.WorkID != nil {
		return true, corestore.ErrStorage
	}
	view, err := packageOperationProjection(operation, job)
	if err != nil {
		return true, err
	}
	send(w, http.StatusOK, view)
	return true, nil
}

func packageOperationProjection(operation corestore.OperationRecord, job corestore.PackageJob) (map[string]any, error) {
	if job.OperationID != operation.ID || (job.ScopeKind == "core") != (operation.WorkID == nil) || (job.WorkID == nil) != (operation.WorkID == nil) || job.WorkID != nil && *job.WorkID != *operation.WorkID {
		return nil, corestore.ErrStorage
	}
	phase, _ := json.Marshal(job.Phase)
	if _, err := contracts.Decode[string](strings.NewReader(string(phase)), "PiPackagePhaseSchema", 128); err != nil {
		return nil, corestore.ErrStorage
	}
	if job.ScopeKind == "work" {
		view := operationEnvelopeView(operation).(map[string]any)
		view["packagePhase"] = job.Phase
		if operation.ResultJSON != nil {
			var result struct {
				Name           contracts.PiPackageName           `json:"name"`
				Version        json.RawMessage                   `json:"version"`
				ResourceCounts contracts.PiPackageResourceCounts `json:"resourceCounts"`
				Scope          string                            `json:"scope"`
				PendingApply   bool                              `json:"pendingApply"`
			}
			if json.Unmarshal([]byte(*operation.ResultJSON), &result) != nil || !pipackage.ValidName(string(result.Name)) || result.Scope != "work" || !result.PendingApply {
				return nil, corestore.ErrStorage
			}
			value := map[string]any{"name": result.Name, "version": result.Version, "resourceCounts": result.ResourceCounts, "scope": "work", "pendingApply": true}
			raw, _ := json.Marshal(value)
			parsed, err := contracts.ParseJSON(strings.NewReader(string(raw)), 64<<10)
			if err != nil {
				return nil, corestore.ErrStorage
			}
			view["result"] = parsed
		}
		if operation.ErrorJSON != nil {
			var safe struct {
				Code string `json:"code"`
			}
			if json.Unmarshal([]byte(*operation.ErrorJSON), &safe) != nil {
				return nil, corestore.ErrStorage
			}
			if packageSafeFailureCode(safe.Code) {
				view["error"] = map[string]any{"code": "WORK_OPERATION_FAILED", "stage": "package-prepare", "message": packageFailureMessage(safe.Code), "remediation": "Inspect the original package Operation before a new submission.", "retryable": false, "correlationId": operation.ID}
			}
		}
		raw, _ := json.Marshal(view)
		if _, err := contracts.Decode[contracts.PublicOperation](strings.NewReader(string(raw)), "PublicOperationSchema", 2<<20); err != nil {
			return nil, corestore.ErrStorage
		}
		return view, nil
	}
	var result any
	var diagnostic any
	if operation.ResultJSON != nil {
		var stored struct {
			Name           contracts.PiPackageName `json:"name"`
			Version        json.RawMessage         `json:"version"`
			ResourceCounts json.RawMessage         `json:"resourceCounts"`
			Scope          string                  `json:"scope"`
		}
		if _, err := contracts.ParseJSON(strings.NewReader(*operation.ResultJSON), 64<<10); err != nil {
			return nil, corestore.ErrStorage
		}
		if json.Unmarshal([]byte(*operation.ResultJSON), &stored) != nil || !pipackage.ValidName(string(stored.Name)) || len(stored.Version) == 0 || len(stored.ResourceCounts) == 0 || stored.Scope != job.ScopeKind {
			return nil, corestore.ErrStorage
		}
		counts, err := contracts.Decode[contracts.PiPackageResourceCounts](strings.NewReader(string(stored.ResourceCounts)), "PiPackageResourceCountsSchema", 4096)
		if err != nil {
			return nil, corestore.ErrStorage
		}
		projection, err := json.Marshal(contracts.PiPackageCatalogEntry{Name: stored.Name, Version: stored.Version, SourceKind: "zip", Enabled: true, ResourceCounts: counts})
		if err != nil {
			return nil, corestore.ErrStorage
		}
		if _, err := contracts.Decode[contracts.PiPackageCatalogEntry](strings.NewReader(string(projection)), "PiPackageCatalogEntrySchema", 64<<10); err != nil {
			return nil, corestore.ErrStorage
		}
		// Only the public result contract is projected, regardless of extra
		// internal fields in a durable record.
		value := map[string]any{"name": stored.Name, "version": stored.Version, "resourceCounts": counts, "scope": job.ScopeKind}
		if job.ScopeKind == "work" {
			value["pendingApply"] = true
		}
		result = value
	}
	if operation.ErrorJSON != nil {
		var stored struct{ Stage, Code string }
		if json.Unmarshal([]byte(*operation.ErrorJSON), &stored) != nil {
			return nil, corestore.ErrStorage
		}
		if !packageSafeFailureCode(stored.Code) {
			stored.Code = "PI_PACKAGE_PREPARATION_FAILED"
		}
		switch stored.Stage {
		case "source", "prepare", "validate", "publish", "queued", "cleanup-pending":
		default:
			stored.Stage = "prepare"
		}
		diagnostic = map[string]string{"stage": stored.Stage, "code": stored.Code, "message": packageFailureMessage(stored.Code)}
	}
	var workID any
	if operation.WorkID != nil {
		workID = *operation.WorkID
	}
	view := map[string]any{"operationId": operation.ID, "workId": workID, "kind": operation.Kind, "state": operation.State, "createdAt": operation.CreatedAt, "updatedAt": operation.UpdatedAt, "result": result, "error": diagnostic, "packagePhase": job.Phase}
	if job.ScopeKind == "core" {
		var name any
		if job.PackageName != nil {
			name = *job.PackageName
		}
		view["name"] = name
	} else {
		view["correlationId"] = operation.ID
	}
	return view, nil
}
