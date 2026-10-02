package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"

	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/identity"
)

func (a *Application) snapshotProvenanceView(ctx context.Context, actor identity.Principal, workID string) (contracts.WorkImportProvenance, error) {
	var view contracts.WorkImportProvenance
	work, err := a.Store.Work(ctx, workID, true)
	if errors.Is(err, corestore.ErrNotFound) {
		return view, contracts.NewError("NOT_FOUND", "")
	}
	if err != nil {
		return view, err
	}
	if err := snapshotOwner(actor, work.OwnerUserID); err != nil {
		return view, err
	}
	view.OperationMap = []struct {
		SourceOperationId contracts.ResourceId `json:"sourceOperationId"`
		OperationId       contracts.ResourceId `json:"operationId"`
	}{}
	err = a.Store.Read(ctx, func(tx *sql.Tx) error {
		if err := tx.QueryRow(`SELECT package_digest,import_operation_id FROM work_import_provenance WHERE work_id=?`, workID).Scan(&view.SourcePackageDigest, &view.ImportOperationId); err != nil {
			return err
		}
		rows, err := tx.Query(`SELECT source_operation_id,operation_id FROM imported_work_history WHERE work_id=? ORDER BY operation_id`, workID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var entry struct {
				SourceOperationId contracts.ResourceId `json:"sourceOperationId"`
				OperationId       contracts.ResourceId `json:"operationId"`
			}
			if err := rows.Scan(&entry.SourceOperationId, &entry.OperationId); err != nil {
				return err
			}
			view.OperationMap = append(view.OperationMap, entry)
		}
		return rows.Err()
	})
	if errors.Is(err, sql.ErrNoRows) {
		return view, contracts.NewError("NOT_FOUND", "")
	}
	return view, err
}

func (a *Application) archivedSnapshotOperation(ctx context.Context, actor identity.Principal, id string) (any, error) {
	var workID, record, archive string
	err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		return tx.QueryRow(`SELECT h.work_id,h.record_json,p.identity_map_json FROM imported_work_history h JOIN work_import_provenance p ON p.work_id=h.work_id WHERE h.operation_id=?`, id).Scan(&workID, &record, &archive)
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, contracts.NewError("NOT_FOUND", "")
	}
	if err != nil {
		return nil, err
	}
	work, err := a.Store.Work(ctx, workID, true)
	if err != nil {
		return nil, err
	}
	if err := snapshotOwner(actor, work.OwnerUserID); err != nil {
		return nil, err
	}
	var item contracts.ArchivedWorkOperation
	var provenance snapshotProvenance
	if strictMetadata([]byte(record), &item) != nil || contracts.Validate("ArchivedWorkOperationSchema", item) != nil || strictMetadata([]byte(archive), &provenance) != nil {
		return nil, corestore.ErrStorage
	}
	services := map[string]string{}
	for _, source := range provenance.SourceIdentityMap.Services {
		for _, target := range provenance.Targets.Services {
			if source.Key == contracts.WorkLogicalKey(target.Key) {
				services[string(source.SourceId)] = target.ID
			}
		}
	}
	var result, errorJSON *string
	if json.Unmarshal(item.ResultJson, &result) != nil || json.Unmarshal(item.ErrorJson, &errorJSON) != nil {
		return nil, corestore.ErrStorage
	}
	if errorJSON != nil {
		var d contracts.SafeDiagnostic
		if json.Unmarshal([]byte(*errorJSON), &d) == nil && contracts.Validate("SafeDiagnosticSchema", d) == nil {
			if d.ServiceId.Present {
				target, ok := services[string(d.ServiceId.Value)]
				d.ServiceId = contracts.Field[contracts.ResourceId]{}
				if ok {
					d.ServiceId = contracts.Supplied(contracts.ResourceId(target))
				}
			}
			d.CorrelationId = contracts.Supplied(contracts.ResourceId(id))
			raw, _ := json.Marshal(d)
			value := string(raw)
			errorJSON = &value
		} else {
			errorJSON = nil
		}
	}
	if result != nil {
		v := decodeDiagnosticEnvelope(result, id)
		// Historical configuration JSON is retained as archive content only.
		var observation struct {
			ObservedState string `json:"observedState"`
		}
		encoded, _ := json.Marshal(v.Result)
		v.Result = nil
		if json.Unmarshal(encoded, &observation) == nil && validObservedState(observation.ObservedState) {
			v.Result = map[string]any{"observedState": observation.ObservedState}
		}
		for i := range v.Diagnostics.Stages {
			s := &v.Diagnostics.Stages[i]
			if s.ServiceId.Present {
				target, ok := services[string(s.ServiceId.Value)]
				s.ServiceId = contracts.Field[contracts.ResourceId]{}
				if ok {
					s.ServiceId = contracts.Supplied(contracts.ResourceId(target))
				}
			}
		}
		raw, _ := json.Marshal(v)
		value := string(raw)
		result = &value
	}
	return operationEnvelopeView(corestore.OperationRecord{ID: id, WorkID: &workID, Kind: item.Kind, State: item.State, CreatedAt: string(item.CreatedAt), UpdatedAt: string(item.UpdatedAt), ResultJSON: result, ErrorJSON: errorJSON}), nil
}
