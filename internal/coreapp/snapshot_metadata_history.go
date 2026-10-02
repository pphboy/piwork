package coreapp

import (
	"database/sql"
	"encoding/json"
	"errors"
	"sort"

	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/dockerengine"
)

func (a *Application) collectSnapshotVolumes(tx *sql.Tx, result *snapshotMetadata, serviceKeys map[string]string) error {
	workID := result.Work.ID
	rows, err := tx.Query(`SELECT id FROM volume_records WHERE work_id=? ORDER BY volume_role`, workID)
	if err != nil {
		return err
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	if len(ids) != 2 {
		return contracts.NewError("SNAPSHOT_STORAGE_UNSUPPORTED", "")
	}
	for _, id := range ids {
		record, err := corestore.ReadVolume(tx, id)
		if err != nil {
			return err
		}
		logical := "work-private"
		if record.Role == "workspace" {
			logical = "work-workspace"
		} else if record.Role != "agent-private" {
			return contracts.NewError("SNAPSHOT_STORAGE_UNSUPPORTED", "")
		}
		if record.InstallationID != a.Store.InstallationID() || record.ServiceID != nil || record.State != "active" || record.PurgedAt != nil || record.RuntimeName != dockerengine.ManagedVolumeName(a.Store.InstallationID(), workID, logical) {
			return contracts.NewError("SNAPSHOT_STORAGE_UNSUPPORTED", "")
		}
		value := snapshotVolume{Record: record, References: []contracts.WorkLogicalKey{}}
		refs, err := tx.Query(`SELECT consumer_kind,consumer_id FROM volume_references WHERE volume_id=? ORDER BY consumer_id`, id)
		if err != nil {
			return err
		}
		var count, workRefs int64
		for refs.Next() {
			var kind, consumer string
			if err := refs.Scan(&kind, &consumer); err != nil {
				refs.Close()
				return err
			}
			count++
			if kind == "work" && consumer == workID {
				workRefs++
				continue
			}
			key, ok := serviceKeys[consumer]
			if kind != "service" || record.Role != "workspace" || !ok {
				refs.Close()
				return contracts.NewError("SNAPSHOT_STORAGE_UNSUPPORTED", "")
			}
			value.References = append(value.References, contracts.WorkLogicalKey(key))
		}
		if err := refs.Err(); err != nil {
			refs.Close()
			return err
		}
		refs.Close()
		if count != record.ReferenceCount || workRefs != 1 {
			return contracts.NewError("SNAPSHOT_STORAGE_UNSUPPORTED", "")
		}
		sort.Slice(value.References, func(i, j int) bool { return value.References[i] < value.References[j] })
		result.Volumes = append(result.Volumes, value)
	}
	if result.Volumes[0].Record.Role != "agent-private" || result.Volumes[1].Record.Role != "workspace" {
		return contracts.NewError("SNAPSHOT_STORAGE_UNSUPPORTED", "")
	}
	return nil
}

type snapshotHistoryPrincipal struct {
	Record contracts.ArchivedWorkIdempotency
	Origin string
}
type snapshotProvenance struct {
	SourceIdentityMap contracts.WorkSourceIdentityMap `json:"sourceIdentityMap"`
	Targets           struct {
		WorkID                         string `json:"workId"`
		Contexts, Services, Operations []struct{ Key, ID string }
	} `json:"targets"`
	ArchivedIdempotency []contracts.ArchivedWorkIdempotency `json:"archivedIdempotency"`
}

func collectSnapshotControlHistory(tx *sql.Tx, work corestore.WorkRecord, current string, contexts []corestore.ContextSnapshot, contextKeys, serviceKeys map[string]string) (contracts.WorkControlHistory, contracts.WorkSourceIdentityMap, error) {
	history := contracts.WorkControlHistory{Version: 1, Operations: []contracts.ArchivedWorkOperation{}, Idempotency: []contracts.ArchivedWorkIdempotency{}}
	identities := contracts.WorkSourceIdentityMap{}
	history.Work.Name = work.Name
	history.Work.CreatedAt = contracts.Timestamp(work.CreatedAt)
	for _, context := range contexts {
		if context.InternalRevision == nil {
			return history, identities, snapshotInvalid("history.configurationRevisions")
		}
		entry := struct {
			Revision   int64                    `json:"revision"`
			ContextKey contracts.WorkLogicalKey `json:"contextKey"`
		}{*context.InternalRevision, contracts.WorkLogicalKey(contextKeys[context.SnapshotID])}
		history.ConfigurationRevisions = append(history.ConfigurationRevisions, entry)
	}
	sort.Slice(history.ConfigurationRevisions, func(i, j int) bool {
		return history.ConfigurationRevisions[i].Revision < history.ConfigurationRevisions[j].Revision
	})
	operations := map[string]contracts.ArchivedWorkOperation{}
	rows, err := tx.Query(`SELECT DISTINCT o.id,o.service_id,o.kind,o.state,o.target_version,o.request_json,o.result_json,o.error_json,o.created_at,o.updated_at FROM operations o LEFT JOIN idempotency_records i ON i.operation_id=o.id WHERE (o.work_id=? OR i.resource_id=?) AND o.id!=? ORDER BY o.id`, work.ID, work.ID, current)
	if err != nil {
		return history, identities, err
	}
	for rows.Next() {
		var item contracts.ArchivedWorkOperation
		var id string
		var service, result, failure *string
		var created, updated string
		if err := rows.Scan(&id, &service, &item.Kind, &item.State, &item.TargetVersion, &item.RequestJson, &result, &failure, &created, &updated); err != nil {
			rows.Close()
			return history, identities, err
		}
		if item.State == "pending" || item.State == "running" {
			rows.Close()
			return history, identities, contracts.NewError("WORK_BUSY", "")
		}
		item.Id = contracts.ResourceId(id)
		item.WorkId = contracts.ResourceId(work.ID)
		item.ServiceId = snapshotRaw(service)
		item.ResultJson = snapshotRaw(result)
		item.ErrorJson = snapshotRaw(failure)
		item.CreatedAt = contracts.Timestamp(created)
		item.UpdatedAt = contracts.Timestamp(updated)
		operations[id] = item
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return history, identities, err
	}
	rows.Close()
	principals := []snapshotHistoryPrincipal{}
	rows, err = tx.Query(`SELECT DISTINCT i.principal_id,i.work_scope,i.operation_kind,i.idempotency_key,i.request_digest,i.resource_id,i.operation_id,i.created_at FROM idempotency_records i JOIN operations o ON o.id=i.operation_id WHERE (o.work_id=? OR i.resource_id=?) AND o.id!=?`, work.ID, work.ID, current)
	if err != nil {
		return history, identities, err
	}
	for rows.Next() {
		var principal string
		var item contracts.ArchivedWorkIdempotency
		if err := rows.Scan(&principal, &item.WorkScope, &item.OperationKind, &item.IdempotencyKey, &item.RequestDigest, &item.ResourceId, &item.OperationId, &item.CreatedAt); err != nil {
			rows.Close()
			return history, identities, err
		}
		item.PrincipalKind = "admin"
		if principal == work.OwnerUserID {
			item.PrincipalKind = "owner"
		} else if principal == "work-agent:"+work.ID {
			item.PrincipalKind = "agent"
		}
		principals = append(principals, snapshotHistoryPrincipal{item, "live:" + principal})
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return history, identities, err
	}
	rows.Close()
	var archiveRaw, importID string
	err = tx.QueryRow(`SELECT identity_map_json,import_operation_id FROM work_import_provenance WHERE work_id=?`, work.ID).Scan(&archiveRaw, &importID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return history, identities, err
	}
	if err == nil {
		var archive snapshotProvenance
		if strictMetadata([]byte(archiveRaw), &archive) != nil || archive.Targets.WorkID != work.ID {
			return history, identities, snapshotInvalid("history.provenance")
		}
		oldServices, oldOperations := map[string]string{}, map[string]string{}
		for _, source := range archive.SourceIdentityMap.Services {
			for _, target := range archive.Targets.Services {
				if target.Key == string(source.Key) {
					oldServices[string(source.SourceId)] = target.ID
				}
			}
		}
		for _, source := range archive.SourceIdentityMap.Operations {
			for _, target := range archive.Targets.Operations {
				if target.Key == string(source.Key) {
					oldOperations[string(source.SourceId)] = target.ID
				}
			}
		}
		rs, err := tx.Query(`SELECT operation_id,source_operation_id,record_json FROM imported_work_history WHERE work_id=?`, work.ID)
		if err != nil {
			return history, identities, err
		}
		for rs.Next() {
			var target, source, raw string
			if err := rs.Scan(&target, &source, &raw); err != nil {
				rs.Close()
				return history, identities, err
			}
			var item contracts.ArchivedWorkOperation
			if strictMetadata([]byte(raw), &item) != nil || string(item.Id) != source || oldOperations[source] != target {
				rs.Close()
				return history, identities, snapshotInvalid("history.provenance")
			}
			if _, exists := operations[target]; exists {
				rs.Close()
				return history, identities, snapshotInvalid("history.provenance")
			}
			item.Id = contracts.ResourceId(target)
			item.WorkId = contracts.ResourceId(work.ID)
			var service *string
			if json.Unmarshal(item.ServiceId, &service) != nil {
				rs.Close()
				return history, identities, snapshotInvalid("history.provenance")
			}
			if service != nil {
				mapped, ok := oldServices[*service]
				if !ok {
					rs.Close()
					return history, identities, snapshotInvalid("history.provenance")
				}
				item.ServiceId = snapshotRaw(mapped)
			}
			operations[target] = item
		}
		if err := rs.Err(); err != nil {
			rs.Close()
			return history, identities, err
		}
		rs.Close()
		for _, item := range archive.ArchivedIdempotency {
			origin := "imported:" + importID + ":" + string(item.PrincipalKey)
			resource := string(item.ResourceId)
			if resource == string(archive.SourceIdentityMap.SourceWorkId) {
				resource = work.ID
			} else {
				var ok bool
				resource, ok = oldServices[resource]
				if !ok {
					return history, identities, snapshotInvalid("history.provenance")
				}
			}
			operation, ok := oldOperations[string(item.OperationId)]
			if !ok {
				return history, identities, snapshotInvalid("history.provenance")
			}
			item.ResourceId = contracts.ResourceId(resource)
			item.OperationId = contracts.ResourceId(operation)
			if item.WorkScope == string(archive.SourceIdentityMap.SourceWorkId) {
				item.WorkScope = work.ID
			}
			principals = append(principals, snapshotHistoryPrincipal{item, origin})
		}
	} else {
		var count int
		if err := tx.QueryRow(`SELECT count(*) FROM imported_work_history WHERE work_id=?`, work.ID).Scan(&count); err != nil {
			return history, identities, err
		}
		if count != 0 {
			return history, identities, snapshotInvalid("history.provenance")
		}
	}
	origins := []string{}
	for _, item := range principals {
		origins = append(origins, item.Origin)
	}
	principalKeys := snapshotKeys(origins, "p")
	for _, item := range principals {
		item.Record.PrincipalKey = contracts.WorkLogicalKey(principalKeys[item.Origin])
		history.Idempotency = append(history.Idempotency, item.Record)
	}
	sort.Slice(history.Idempotency, func(i, j int) bool {
		a, b := history.Idempotency[i], history.Idempotency[j]
		for _, pair := range [][2]string{{string(a.PrincipalKey), string(b.PrincipalKey)}, {a.WorkScope, b.WorkScope}, {a.OperationKind, b.OperationKind}, {a.IdempotencyKey, b.IdempotencyKey}} {
			if pair[0] != pair[1] {
				return pair[0] < pair[1]
			}
		}
		return false
	})
	operationIDs := []string{}
	for id := range operations {
		operationIDs = append(operationIDs, id)
	}
	sort.Strings(operationIDs)
	for _, id := range operationIDs {
		history.Operations = append(history.Operations, operations[id])
	}
	identities, err = snapshotConvert[contracts.WorkSourceIdentityMap](map[string]any{"version": 1, "sourceWorkId": work.ID, "contexts": snapshotIdentityEntries(contextKeys), "services": snapshotIdentityEntries(serviceKeys), "operations": snapshotIdentityEntries(snapshotKeys(operationIDs, "o"))})
	if err != nil {
		return history, identities, err
	}
	return history, identities, nil
}
