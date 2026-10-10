package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"time"

	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/dockerengine"
	"piwork/internal/workpackage"
)

func snapshotSQLNullable(raw json.RawMessage) any {
	if string(raw) == "null" || len(raw) == 0 {
		return nil
	}
	var value any
	if json.Unmarshal(raw, &value) != nil {
		return nil
	}
	return value
}

// This SQL transaction is the only visibility boundary of a restored Work.
func (a *Application) publishSnapshotImport(ctx context.Context, job corestore.SnapshotJob, verified workpackage.Verified, history contracts.WorkControlHistory, identities contracts.WorkSourceIdentityMap, targets snapshotIdentityTargets, bindings snapshotBindings, images map[string]snapshotImportImage, volumes []snapshotImportVolume, contexts []snapshotImportContext) error {
	spec := verified.Spec
	now := packageNow()
	if job.TargetWorkID == nil || job.Name == nil || job.PackageID == nil || targets.WorkID != *job.TargetWorkID || len(contexts) != len(spec.Contexts) || len(images) != len(spec.Images) || len(volumes) != 2 {
		return snapshotInvalid("import.staging")
	}
	var desiredRevision int64
	var activeRevision any
	var activeID any
	var activeKey string
	_ = json.Unmarshal(spec.ActiveContext, &activeKey)
	desiredID := snapshotTargetID(targets.Contexts, string(spec.DesiredContext))
	if desiredID == "" {
		return snapshotInvalid("import.contexts")
	}
	contextKeys := map[string]bool{}
	for _, c := range contexts {
		if contextKeys[c.Key] || c.Revision < 1 || c.Published.ID != snapshotTargetID(targets.Contexts, c.Key) {
			return snapshotInvalid("import.contexts")
		}
		contextKeys[c.Key] = true
		if c.Key == string(spec.DesiredContext) {
			desiredRevision = c.Revision
		}
		if c.Key == activeKey {
			activeRevision = c.Revision
			activeID = c.Published.ID
		}
	}
	if desiredRevision < 1 || activeKey != "" && activeID == nil {
		return snapshotInvalid("import.revisions")
	}
	for _, v := range volumes {
		if !v.Created || v.RuntimeName != dockerengine.ManagedVolumeName(a.Store.InstallationID(), targets.WorkID, v.LogicalID) {
			return snapshotInvalid("import.volumes")
		}
	}
	return a.Store.Write(ctx, func(tx *sql.Tx) error {
		current, err := corestore.AssertSnapshotFence(tx, job.OperationID, job.WorkerEpoch)
		if err != nil {
			return err
		}
		if current.Kind != "import" || current.TargetWorkID == nil || *current.TargetWorkID != targets.WorkID || current.Name == nil || *current.Name != *job.Name || current.OwnerUserID != job.OwnerUserID || current.Phase != "publishing" {
			return corestore.ErrStorage
		}
		deadline, err := time.Parse(time.RFC3339Nano, current.DeadlineAt)
		if err != nil || !deadline.After(time.Now()) {
			return contracts.NewError("SNAPSHOT_DEADLINE_EXCEEDED", "")
		}
		if _, err := a.resolveSnapshotBindings(tx, job.OwnerUserID, spec.Bindings, bindings); err != nil {
			return err
		}
		pack, err := corestore.ReadSnapshotPackage(tx, *job.PackageID)
		if err != nil {
			return err
		}
		if pack.State != "ready" || pack.OwnerUserID != job.OwnerUserID || pack.Digest == nil || *pack.Digest != verified.Digest || pack.Size != verified.Size {
			return snapshotInvalid("import.package")
		}
		var identityJSON, nameOperation string
		if err := tx.QueryRow(`SELECT logical_id FROM snapshot_artifacts WHERE operation_id=? AND artifact_key='identity-map' AND kind='identity-map' AND state='ready'`, job.OperationID).Scan(&identityJSON); err != nil {
			return err
		}
		if identityJSON != string(snapshotRaw(targets)) {
			return corestore.ErrStorage
		}
		if err := tx.QueryRow(`SELECT operation_id FROM work_import_names WHERE owner_user_id=? AND name=?`, job.OwnerUserID, *job.Name).Scan(&nameOperation); err != nil || nameOperation != job.OperationID {
			return corestore.ErrStorage
		}
		quota, err := corestore.ReadQuotaReservation(tx, targets.WorkID, "import", "import")
		if err != nil {
			return err
		}
		var cpu, memory int64
		for _, q := range spec.QuotaReservations {
			cpu += int64(q.DesiredCpuMillis)
			memory += corestore.EffectiveMemoryBytes(q.SubjectKind, int64(q.DesiredMemoryBytes), 0)
		}
		if quota.DesiredCPUMillis != cpu || quota.DesiredMemoryBytes != memory || quota.OccupiedCPUMillis != 0 || quota.OccupiedMemoryBytes != 0 {
			return corestore.ErrStorage
		}
		usage, err := corestore.ReadQuotaUsage(tx, nil)
		if err != nil {
			return err
		}
		if usage.CPUMillis > 128000 || usage.MemoryBytes > 256<<30 {
			return contracts.NewError("QUOTA_EXCEEDED", "")
		}
		if err := corestore.InsertWork(tx, corestore.WorkRecord{ID: targets.WorkID, OwnerUserID: job.OwnerUserID, Name: *job.Name, DesiredState: "stopped", ObservedState: "stopped", DesiredRevision: desiredRevision, ControlVersion: 1, CreatedAt: now, UpdatedAt: now}); err != nil {
			return err
		}
		if _, err := corestore.AssignWorkNetworkName(tx, targets.WorkID, now); err != nil {
			return err
		}
		for _, image := range spec.Images {
			selection, ok := images[string(image.Key)]
			if !ok || selection.Identity != string(image.ImageId) {
				return snapshotInvalid("import.images")
			}
			if _, err := tx.Exec(`INSERT INTO work_owned_images(work_id,selection_id,image_identity,source_reference) VALUES(?,?,?,?)`, targets.WorkID, selection.SelectionID, selection.Identity, selection.Identity); err != nil {
				return err
			}
		}
		for _, c := range contexts {
			profileJSON := string(snapshotRaw(c.Profile))
			revision := c.Revision
			source := c.Profile.Revision
			image := c.Published.ImageID
			if err := corestore.InsertConfiguration(tx, corestore.ConfigurationRevision{WorkID: targets.WorkID, Revision: revision, ConfigJSON: c.Published.ConfigurationJSON, ResolvedImageDigest: &image, RuntimeProfileJSON: &profileJSON, SourceRuntimeRevision: &source, CreatedByUserID: job.OwnerUserID, CreatedAt: now}); err != nil {
				return err
			}
			if err := corestore.InsertContext(tx, corestore.ContextSnapshot{SnapshotID: c.Published.ID, WorkID: targets.WorkID, InternalRevision: &revision, ConfigurationJSON: c.Published.ConfigurationJSON, ImageIdentity: image, CreatedByUserID: job.OwnerUserID, CreatedAt: now}); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(`UPDATE works SET desired_context_id=?,active_context_id=?,active_revision=? WHERE id=?`, desiredID, activeID, activeRevision, targets.WorkID); err != nil {
			return err
		}
		for _, service := range spec.Services {
			id := snapshotTargetID(targets.Services, string(service.Key))
			if id == "" {
				return snapshotInvalid("import.services")
			}
			for _, revision := range service.Revisions {
				var definition map[string]any
				if json.Unmarshal(snapshotRaw(revision.Definition), &definition) != nil {
					return snapshotInvalid("import.service.definition")
				}
				definition["serviceId"] = id
				definition["revision"] = revision.Revision
				var image any
				if key, ok := snapshotSQLNullable(revision.ImageKey).(string); ok {
					selection, found := images[key]
					if !found {
						return snapshotInvalid("import.service.image")
					}
					image = selection.Identity
				}
				if _, err := tx.Exec(`INSERT INTO service_revisions(work_id,service_id,revision,definition_json,resolved_image_digest,created_at) VALUES(?,?,?,?,?,?)`, targets.WorkID, id, revision.Revision, string(snapshotRaw(definition)), image, string(revision.CreatedAt)); err != nil {
					return err
				}
			}
			tombstone := snapshotSQLNullable(service.TombstonedAt)
			enabled := service.Enabled && tombstone == nil
			state := "disabled"
			if enabled {
				state = "stopped"
			}
			if _, err := tx.Exec(`INSERT INTO service_heads(work_id,service_id,name,desired_revision,applied_revision,enabled,observed_state,tombstoned_at,last_error_json) VALUES(?,?,?,?,?,?,?,?,NULL)`, targets.WorkID, id, service.Name, service.DesiredRevision, snapshotSQLNullable(service.AppliedRevision), enabled, state, tombstone); err != nil {
				return err
			}
			if _, err := corestore.AssignServiceDomainLabel(tx, targets.WorkID, id, service.Name, now); err != nil {
				return err
			}
			selected := service.DesiredRevision
			if number, ok := snapshotSQLNullable(service.AppliedRevision).(float64); ok {
				selected = int64(number)
			}
			var selectedImage any
			for _, r := range service.Revisions {
				if r.Revision == selected {
					if key, ok := snapshotSQLNullable(r.ImageKey).(string); ok {
						selectedImage = images[key].Identity
					}
				}
			}
			if _, err := tx.Exec(`INSERT INTO service_runtime_bindings(work_id,service_id,revision,container_id,image_identity,recovery_count,recovery_window_started_at,next_retry_at,ready_since,updated_at) VALUES(?,?,?,NULL,?,?,?,?,?,?)`, targets.WorkID, id, selected, selectedImage, int64(service.Recovery.Count), snapshotSQLNullable(service.Recovery.WindowStartedAt), snapshotSQLNullable(service.Recovery.NextRetryAt), snapshotSQLNullable(service.Recovery.ReadySince), now); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(`DELETE FROM quota_reservations WHERE work_id=? AND subject_kind='import' AND subject_id='import'`, targets.WorkID); err != nil {
			return err
		}
		for _, q := range spec.QuotaReservations {
			subject := "agentd"
			if q.SubjectKind == "service" {
				subject = snapshotTargetID(targets.Services, string(q.SubjectKey))
				if subject == "" {
					return snapshotInvalid("import.quota")
				}
			}
			if _, err := tx.Exec(`INSERT INTO quota_reservations(work_id,subject_kind,subject_id,desired_cpu_millis,desired_memory_bytes,occupied_cpu_millis,occupied_memory_bytes,service_slots,volume_slots,updated_at) VALUES(?,?,?,?,?,0,0,?,?,?)`, targets.WorkID, q.SubjectKind, subject, int64(q.DesiredCpuMillis), int64(q.DesiredMemoryBytes), int64(q.ServiceSlots), int64(q.VolumeSlots), now); err != nil {
				return err
			}
		}
		for _, v := range volumes {
			refs := []contracts.WorkLogicalKey{}
			for _, source := range workpackage.Volumes(spec) {
				if source.Role == v.Role {
					refs = source.ServiceRefKeys
				}
			}
			if _, err := tx.Exec(`INSERT INTO volume_records(id,installation_id,work_id,service_id,volume_role,runtime_name,state,reference_count,retained_at,purged_at,created_at) VALUES(?,?,?,NULL,?,?,'active',?,NULL,NULL,?)`, v.ID, a.Store.InstallationID(), targets.WorkID, v.Role, v.RuntimeName, len(refs)+1, now); err != nil {
				return err
			}
			if _, err := tx.Exec(`INSERT INTO volume_references(volume_id,consumer_kind,consumer_id,created_at) VALUES(?,'work',?,?)`, v.ID, targets.WorkID, now); err != nil {
				return err
			}
			for _, key := range refs {
				id := snapshotTargetID(targets.Services, string(key))
				if id == "" {
					return snapshotInvalid("import.volume.references")
				}
				if _, err := tx.Exec(`INSERT INTO volume_references(volume_id,consumer_kind,consumer_id,created_at) VALUES(?,'service',?,?)`, v.ID, id, now); err != nil {
					return err
				}
			}
		}
		for _, operation := range history.Operations {
			key := ""
			for _, source := range identities.Operations {
				if source.SourceId == operation.Id {
					key = string(source.Key)
				}
			}
			id := snapshotTargetID(targets.Operations, key)
			if id == "" {
				return snapshotInvalid("import.history")
			}
			if _, err := tx.Exec(`INSERT INTO imported_work_history(work_id,operation_id,source_operation_id,record_json) VALUES(?,?,?,?)`, targets.WorkID, id, string(operation.Id), string(snapshotRaw(operation))); err != nil {
				return err
			}
		}
		provenance := snapshotRaw(map[string]any{"sourceIdentityMap": identities, "targets": targets, "archivedIdempotency": history.Idempotency})
		if _, err := tx.Exec(`INSERT INTO work_import_provenance(work_id,package_digest,import_operation_id,identity_map_json) VALUES(?,?,?,?)`, targets.WorkID, verified.Digest, job.OperationID, string(provenance)); err != nil {
			return err
		}
		if err := corestore.ReleaseSnapshotReservations(tx, job.OperationID, job.WorkerEpoch, true); err != nil {
			return err
		}
		if err := corestore.UpdateSnapshotPhase(tx, job.OperationID, job.WorkerEpoch, "succeeded", now, nil); err != nil {
			return err
		}
		result := string(snapshotRaw(map[string]any{"correlationId": job.OperationID, "result": map[string]any{"observedState": "stopped"}}))
		_, err = tx.Exec(`UPDATE operations SET state='succeeded',result_json=?,error_json=NULL,updated_at=? WHERE id=? AND state IN ('pending','running')`, result, now, job.OperationID)
		return err
	})
}
