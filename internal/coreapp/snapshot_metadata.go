package coreapp

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"sort"
	"strings"

	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/internaltls"
	"piwork/internal/workpackage"
	"piwork/internal/workruntime"
)

type snapshotContext struct {
	Key, Directory, ImageKey string
	Record                   corestore.ContextSnapshot
	Config                   contracts.WorkConfig
	Metadata                 contracts.WorkContextMetadata
	Portable                 contracts.PortableWorkConfiguration
}
type snapshotVolume struct {
	Record     corestore.VolumeRecord
	References []contracts.WorkLogicalKey
}
type snapshotMetadata struct {
	Work           corestore.WorkRecord
	Contexts       []snapshotContext
	Services       []contracts.PortableWorkService
	Quotas         []contracts.PortableWorkQuotaReservation
	Volumes        []snapshotVolume
	Images         []struct{ Key, ID string }
	Bindings       contracts.WorkBindingRequirements
	History        contracts.WorkControlHistory
	Identities     contracts.WorkSourceIdentityMap
	ActiveContext  json.RawMessage
	DesiredContext string
}

func snapshotInvalid(field string) error {
	return &workpackage.ValidationError{Code: "PACKAGE_INVALID", Field: field}
}
func snapshotRaw(value any) json.RawMessage { raw, _ := json.Marshal(value); return raw }
func snapshotConvert[T any](value any) (T, error) {
	var result T
	raw, err := json.Marshal(value)
	if err == nil {
		err = json.Unmarshal(raw, &result)
	}
	return result, err
}
func snapshotKeys(ids []string, prefix string) map[string]string {
	sort.Strings(ids)
	result := map[string]string{}
	for _, id := range ids {
		if _, exists := result[id]; !exists {
			result[id] = fmt.Sprintf("%s-%06d", prefix, len(result)+1)
		}
	}
	return result
}
func snapshotIdentityEntries(keys map[string]string) []map[string]string {
	out := []map[string]string{}
	for id, key := range keys {
		out = append(out, map[string]string{"sourceId": id, "key": key})
	}
	sort.Slice(out, func(i, j int) bool { return out[i]["key"] < out[j]["key"] })
	return out
}

// A single read transaction captures all platform metadata. Business data is
// read later only through the stopped Work's isolated snapshot helpers.
func (a *Application) collectSnapshotMetadata(ctx context.Context, workID, currentOperation string) (snapshotMetadata, error) {
	result := snapshotMetadata{Contexts: []snapshotContext{}, Services: []contracts.PortableWorkService{}, Quotas: []contracts.PortableWorkQuotaReservation{}, Volumes: []snapshotVolume{}}
	err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		var err error
		result.Work, err = corestore.ReadWork(tx, workID, false)
		if err != nil {
			return err
		}
		if result.Work.DesiredContextID == nil {
			return snapshotInvalid("work.context")
		}
		rows, err := tx.Query(`SELECT snapshot_id,work_id,internal_revision,configuration_json,image_identity,created_by_user_id,created_at FROM work_context_snapshots WHERE work_id=? ORDER BY snapshot_id`, workID)
		if err != nil {
			return err
		}
		records := []corestore.ContextSnapshot{}
		ids := []string{}
		imageIDs := []string{}
		models := []string{}
		secretIDs := []string{}
		for rows.Next() {
			var v corestore.ContextSnapshot
			if err := rows.Scan(&v.SnapshotID, &v.WorkID, &v.InternalRevision, &v.ConfigurationJSON, &v.ImageIdentity, &v.CreatedByUserID, &v.CreatedAt); err != nil {
				rows.Close()
				return err
			}
			records = append(records, v)
			ids = append(ids, v.SnapshotID)
			imageIDs = append(imageIDs, v.ImageIdentity)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return err
		}
		rows.Close()
		contextKeys := snapshotKeys(ids, "c")
		revisions := map[int64]corestore.ConfigurationRevision{}
		rows, err = tx.Query(`SELECT work_id,revision,config_json,resolved_image_digest,created_by_user_id,created_at,runtime_profile_json,source_runtime_revision FROM work_config_revisions WHERE work_id=? ORDER BY revision`, workID)
		if err != nil {
			return err
		}
		for rows.Next() {
			var v corestore.ConfigurationRevision
			if err := rows.Scan(&v.WorkID, &v.Revision, &v.ConfigJSON, &v.ResolvedImageDigest, &v.CreatedByUserID, &v.CreatedAt, &v.RuntimeProfileJSON, &v.SourceRuntimeRevision); err != nil {
				rows.Close()
				return err
			}
			revisions[v.Revision] = v
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return err
		}
		rows.Close()
		if len(records) != len(revisions) {
			return snapshotInvalid("history.configurationRevisions")
		}
		for _, record := range records {
			if record.InternalRevision == nil {
				return snapshotInvalid("history.configurationRevisions")
			}
			revision, ok := revisions[*record.InternalRevision]
			if !ok || revision.ConfigJSON != record.ConfigurationJSON || revision.RuntimeProfileJSON == nil {
				return snapshotInvalid("context.configuration")
			}
			directory := filepath.Join(a.options.DataDirectory, "works", workID, "contexts", record.SnapshotID)
			captured, err := readSnapshotContext(directory, workID, record.SnapshotID, record.ImageIdentity)
			if err != nil {
				return err
			}
			stored, err := contracts.ParseJSON(strings.NewReader(record.ConfigurationJSON), 2<<20)
			if err != nil {
				return err
			}
			got, _ := contracts.EncodeCanonicalJSON(captured.config)
			wanted, _ := contracts.EncodeCanonicalJSON(stored)
			if !bytes.Equal(got, wanted) {
				return snapshotInvalid("context.configuration")
			}
			source := snapshotContext{Key: contextKeys[record.SnapshotID], Directory: directory, Record: record, Config: captured.config, Metadata: captured.metadata}
			result.Contexts = append(result.Contexts, source)
			models = append(models, string(source.Config.ModelRef))
			for _, server := range source.Config.McpServers {
				for _, secret := range server.SecretRefs.Value {
					secretIDs = append(secretIDs, string(secret.SecretId))
				}
			}
		}
		services, err := corestore.ReadServices(tx, workID, true)
		if err != nil {
			return err
		}
		sort.Slice(services, func(i, j int) bool { return services[i].ServiceID < services[j].ServiceID })
		serviceIDs := []string{}
		for _, s := range services {
			serviceIDs = append(serviceIDs, s.ServiceID)
		}
		serviceKeys := snapshotKeys(serviceIDs, "s")
		serviceRevisions := map[string][]map[string]any{}
		for _, service := range services {
			items := []map[string]any{}
			rs, err := tx.Query(`SELECT revision,definition_json,resolved_image_digest,created_at FROM service_revisions WHERE work_id=? AND service_id=? ORDER BY revision`, workID, service.ServiceID)
			if err != nil {
				return err
			}
			for rs.Next() {
				var revision int64
				var raw, created string
				var image *string
				if err := rs.Scan(&revision, &raw, &image, &created); err != nil {
					rs.Close()
					return err
				}
				var definition map[string]any
				if strictMetadata([]byte(raw), &definition) != nil {
					rs.Close()
					return snapshotInvalid("service.definition")
				}
				delete(definition, "serviceId")
				delete(definition, "revision")
				items = append(items, map[string]any{"revision": revision, "createdAt": created, "definition": definition, "imageIdentity": image})
				if image != nil {
					imageIDs = append(imageIDs, *image)
				}
			}
			if err := rs.Err(); err != nil {
				rs.Close()
				return err
			}
			rs.Close()
			serviceRevisions[service.ServiceID] = items
		}
		imageKeys := snapshotKeys(imageIDs, "i")
		orderedImages := snapshotIdentityEntries(imageKeys)
		for _, entry := range orderedImages {
			result.Images = append(result.Images, struct{ Key, ID string }{entry["key"], entry["sourceId"]})
		}
		modelKeys, secretKeys := snapshotKeys(models, "m"), snapshotKeys(secretIDs, "b")
		modelRequirements := map[string]map[string]any{}
		secretUses := map[string][]map[string]any{}
		for _, key := range secretKeys {
			secretUses[key] = []map[string]any{}
		}
		for i := range result.Contexts {
			source := &result.Contexts[i]
			revision := revisions[*source.Record.InternalRevision]
			var profile RuntimeProfile
			if strictMetadata([]byte(*revision.RuntimeProfileJSON), &profile) != nil || profile.Model.Provider == "" || profile.Model.ID == "" {
				return snapshotInvalid("context.model")
			}
			modelKey := modelKeys[string(source.Config.ModelRef)]
			requirement := map[string]any{"key": modelKey, "provider": profile.Model.Provider, "model": profile.Model.ID, "baseUrl": profile.Model.BaseURL}
			if prior, exists := modelRequirements[modelKey]; exists && !bytes.Equal(snapshotRaw(prior), snapshotRaw(requirement)) {
				return snapshotInvalid("context.model")
			}
			modelRequirements[modelKey] = requirement
			portable, err := snapshotConvert[map[string]any](source.Config)
			if err != nil {
				return err
			}
			delete(portable, "agentImage")
			delete(portable, "modelRef")
			delete(portable, "agentsMd")
			portable["modelBindingKey"] = modelKey
			servers := []map[string]any{}
			for _, server := range source.Config.McpServers {
				item, err := snapshotConvert[map[string]any](server)
				if err != nil {
					return err
				}
				delete(item, "requiredServiceId")
				delete(item, "secretRefs")
				if server.RequiredServiceId.Present {
					key, exists := serviceKeys[string(server.RequiredServiceId.Value)]
					if !exists {
						return snapshotInvalid("context.requiredService")
					}
					item["requiredServiceKey"] = key
				}
				if server.SecretRefs.Present {
					refs := []map[string]any{}
					for _, secret := range server.SecretRefs.Value {
						key := secretKeys[string(secret.SecretId)]
						ref := map[string]any{"bindingKey": key}
						var useKey any
						if secret.Key.Present {
							ref["key"] = secret.Key.Value
							useKey = secret.Key.Value
						}
						refs = append(refs, ref)
						secretUses[key] = append(secretUses[key], map[string]any{"contextKey": source.Key, "serverId": server.ServerId, "key": useKey})
					}
					item["secretRefs"] = refs
				}
				servers = append(servers, item)
			}
			portable["mcpServers"] = servers
			source.Portable, err = snapshotConvert[contracts.PortableWorkConfiguration](portable)
			if err != nil {
				return err
			}
			source.ImageKey = imageKeys[source.Record.ImageIdentity]
		}
		modelList, secretList := []map[string]any{}, []map[string]any{}
		for _, entry := range snapshotIdentityEntries(modelKeys) {
			modelList = append(modelList, modelRequirements[entry["key"]])
		}
		for _, entry := range snapshotIdentityEntries(secretKeys) {
			secretList = append(secretList, map[string]any{"key": entry["key"], "uses": secretUses[entry["key"]]})
		}
		result.Bindings, err = snapshotConvert[contracts.WorkBindingRequirements](map[string]any{"models": modelList, "secrets": secretList})
		if err != nil {
			return err
		}
		for _, service := range services {
			revs := serviceRevisions[service.ServiceID]
			for _, rev := range revs {
				var key any
				if image, ok := rev["imageIdentity"].(*string); ok && image != nil {
					key = imageKeys[*image]
				}
				delete(rev, "imageIdentity")
				rev["imageKey"] = key
			}
			binding, err := corestore.ReadServiceRuntimeBinding(tx, workID, service.ServiceID)
			if err != nil && !errors.Is(err, corestore.ErrNotFound) {
				return err
			}
			var diagnostic any
			if service.LastErrorJSON != nil {
				value, err := contracts.ParseJSON(strings.NewReader(*service.LastErrorJSON), 64<<10)
				if err != nil || contracts.Validate("SafeDiagnosticSchema", value) != nil {
					return snapshotInvalid("service.lastError")
				}
				diagnostic = value
			}
			row := map[string]any{"key": serviceKeys[service.ServiceID], "name": service.Name, "desiredRevision": service.DesiredRevision, "appliedRevision": service.AppliedRevision, "enabled": service.Enabled, "tombstonedAt": service.TombstonedAt, "revisions": revs, "recovery": map[string]any{"count": binding.RecoveryCount, "windowStartedAt": binding.RecoveryWindowStartedAt, "nextRetryAt": binding.NextRetryAt, "readySince": binding.ReadySince}, "sourceObservation": map[string]any{"state": service.ObservedState, "lastError": diagnostic}}
			value, err := snapshotConvert[contracts.PortableWorkService](row)
			if err != nil {
				return err
			}
			result.Services = append(result.Services, value)
		}
		rows, err = tx.Query(`SELECT subject_kind,subject_id,desired_cpu_millis,desired_memory_bytes,service_slots,volume_slots FROM quota_reservations WHERE work_id=? ORDER BY CASE subject_kind WHEN 'agent' THEN 0 ELSE 1 END,subject_id`, workID)
		if err != nil {
			return err
		}
		for rows.Next() {
			var value contracts.PortableWorkQuotaReservation
			var subject string
			if err := rows.Scan(&value.SubjectKind, &subject, &value.DesiredCpuMillis, &value.DesiredMemoryBytes, &value.ServiceSlots, &value.VolumeSlots); err != nil {
				rows.Close()
				return err
			}
			if value.SubjectKind == "agent" && subject == "agentd" {
				value.SubjectKey = "agentd"
			} else if value.SubjectKind == "service" {
				key, ok := serviceKeys[subject]
				if !ok {
					rows.Close()
					return snapshotInvalid("quotaReservations")
				}
				value.SubjectKey = contracts.WorkLogicalKey(key)
			} else {
				rows.Close()
				return snapshotInvalid("quotaReservations")
			}
			result.Quotas = append(result.Quotas, value)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return err
		}
		rows.Close()
		if len(result.Quotas) != len(services)+1 {
			return snapshotInvalid("quotaReservations")
		}
		if err := a.collectSnapshotVolumes(tx, &result, serviceKeys); err != nil {
			return err
		}
		history, identities, err := collectSnapshotControlHistory(tx, result.Work, currentOperation, records, contextKeys, serviceKeys)
		if err != nil {
			return err
		}
		result.History = history
		result.Identities = identities
		desired, ok := contextKeys[*result.Work.DesiredContextID]
		if !ok {
			return snapshotInvalid("work.desiredContext")
		}
		result.DesiredContext = desired
		result.ActiveContext = snapshotRaw(nil)
		if result.Work.ActiveContextID != nil {
			active, ok := contextKeys[*result.Work.ActiveContextID]
			if !ok {
				return snapshotInvalid("work.activeContext")
			}
			result.ActiveContext = snapshotRaw(active)
		}
		return nil
	})
	return result, err
}

func readSnapshotContext(directory, work, contextID, image string) (snapshotCapturedContext, error) {
	// readCaptured is static filesystem validation; it does not contact or run
	// an Agent. Dummy launch scope/model meet its structural input contract.
	config, metadata, err := workruntime.ReadCapturedContext(workruntime.StartSpec{Scope: internaltls.Scope{WorkID: work, Generation: 1, InstanceID: "snapshot"}, ContextID: contextID, ImageID: image, ContextDirectory: directory, Model: workruntime.Model{Provider: "snapshot", ID: "snapshot"}})
	return snapshotCapturedContext{config, metadata}, err
}

type snapshotCapturedContext struct {
	config   contracts.WorkConfig
	metadata contracts.WorkContextMetadata
}
