package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"time"

	"github.com/google/uuid"
	"golang.org/x/sys/unix"
	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/identity"
	"piwork/internal/workpackage"
)

type snapshotIdentityTarget struct {
	Key string `json:"key"`
	ID  string `json:"id"`
}
type snapshotIdentityTargets struct {
	WorkID     string                   `json:"workId"`
	Contexts   []snapshotIdentityTarget `json:"contexts"`
	Services   []snapshotIdentityTarget `json:"services"`
	Operations []snapshotIdentityTarget `json:"operations"`
}

func snapshotTargetID(entries []snapshotIdentityTarget, key string) string {
	for _, entry := range entries {
		if entry.Key == key {
			return entry.ID
		}
	}
	return ""
}
func allocateSnapshotTargets(v contracts.WorkSourceIdentityMap, work string) snapshotIdentityTargets {
	result := snapshotIdentityTargets{work, []snapshotIdentityTarget{}, []snapshotIdentityTarget{}, []snapshotIdentityTarget{}}
	for _, entry := range v.Contexts {
		result.Contexts = append(result.Contexts, snapshotIdentityTarget{string(entry.Key), "context-" + uuid.NewString()})
	}
	for _, entry := range v.Services {
		result.Services = append(result.Services, snapshotIdentityTarget{string(entry.Key), "service-" + uuid.NewString()})
	}
	for _, entry := range v.Operations {
		result.Operations = append(result.Operations, snapshotIdentityTarget{string(entry.Key), "operation-" + uuid.NewString()})
	}
	return result
}
func (a *Application) verifiedSnapshotPackage(ctx context.Context, pack corestore.SnapshotPackage) (workpackage.Verified, error) {
	root, err := a.Store.OpenSnapshotArea("packages")
	if err != nil {
		return workpackage.Verified{}, err
	}
	defer root.Close()
	file, err := root.OpenFile(pack.ID+".work", unix.O_RDONLY)
	if err != nil {
		return workpackage.Verified{}, contracts.NewError("PACKAGE_UNAVAILABLE", "")
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || info.Size() != pack.Size {
		return workpackage.Verified{}, snapshotInvalid("package.size")
	}
	verified, err := workpackage.Read(ctx, io.NewSectionReader(file, 0, info.Size()), workpackage.ReadOptions{})
	if err == nil && (pack.Digest == nil || *pack.Digest != verified.Digest || verified.Size != pack.Size) {
		err = snapshotInvalid("package.digest")
	}
	if err == nil {
		err = workpackage.ValidatePackageContent(ctx, verified, verified.Open(file))
	}
	if err == nil {
		var environments map[string]contracts.PiPackagePreparedEnvironment
		environments, err = workpackage.ImageEnvironments(ctx, verified, file)
		if err == nil {
			err = workpackage.ValidateTarget(verified.Spec, contracts.WorkImagePlatform{Os: verified.Spec.Compatibility.Os, Architecture: verified.Spec.Compatibility.Architecture, Variant: verified.Spec.Compatibility.Variant}, environments)
		}
	}
	return verified, err
}
func (a *Application) acceptWorkImport(ctx context.Context, actor identity.Principal, input contracts.ImportWorkRequest) (contracts.AcceptedWorkImport, error) {
	output := contracts.AcceptedWorkImport{}
	var pack corestore.SnapshotPackage
	err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		var err error
		pack, err = corestore.ReadSnapshotPackage(tx, string(input.PackageId))
		if err != nil {
			return err
		}
		return snapshotOwner(actor, pack.OwnerUserID)
	})
	if errors.Is(err, corestore.ErrNotFound) {
		return output, contracts.NewError("NOT_FOUND", "")
	}
	if err != nil {
		return output, err
	}
	if pack.Digest == nil {
		return output, contracts.NewError("PACKAGE_NOT_READY", "")
	}
	var explicit any
	if input.Name.Present {
		explicit = input.Name.Value
	}
	request := string(snapshotRaw(map[string]any{"packageDigest": *pack.Digest, "explicitName": explicit}))
	response := func(v corestore.AcceptedMutation) (contracts.AcceptedWorkImport, error) {
		var job corestore.SnapshotJob
		err := a.Store.Read(ctx, func(tx *sql.Tx) error {
			var err error
			job, err = corestore.ReadSnapshotJob(tx, v.OperationID)
			return err
		})
		if err != nil || job.Name == nil {
			return output, corestore.ErrStorage
		}
		return contracts.AcceptedWorkImport{WorkId: contracts.ResourceId(v.ResourceID), Name: *job.Name, OperationId: contracts.ResourceId(v.OperationID), CorrelationId: contracts.ResourceId(v.OperationID), Reused: v.Reused}, nil
	}
	if prior, found, err := a.Store.FindAcceptedMutation(ctx, actor.UserID, "work-imports", "import-work", string(input.IdempotencyKey), request); err != nil {
		return output, snapshotPublicError(err)
	} else if found {
		return response(prior)
	}
	if pack.State == "expired" || pack.ExpiresAt != nil && snapshotExpired(*pack.ExpiresAt) {
		return output, contracts.NewError("PACKAGE_EXPIRED", "")
	}
	if pack.State != "ready" {
		return output, contracts.NewError("PACKAGE_NOT_READY", "")
	}
	if a.Status().State != "READY" {
		return output, contracts.NewError("RUNTIME_UNAVAILABLE", "")
	}
	image, err := a.requireSnapshotImage()
	if err != nil {
		return output, err
	}
	verified, err := a.verifiedSnapshotPackage(ctx, pack)
	if err != nil {
		return output, snapshotPublicError(err)
	}
	if err := a.validateSnapshotPlatform(ctx, verified.Spec); err != nil {
		return output, err
	}
	var identities contracts.WorkSourceIdentityMap
	if strictMetadata(verified.Metadata[string(verified.Spec.History.SourceIdentityMap)], &identities) != nil {
		return output, snapshotInvalid("history.identities")
	}
	workID := "work-" + uuid.NewString()
	targets := allocateSnapshotTargets(identities, workID)
	now := packageNow()
	accepted, err := a.Store.AcceptMutation(ctx, corestore.MutationRequest{PrincipalID: actor.UserID, WorkScope: "work-imports", Kind: "import-work", IdempotencyKey: string(input.IdempotencyKey), RequestJSON: request, TargetVersion: 1, Now: now}, func(tx *sql.Tx, id string) (corestore.MutationEffect, error) {
		if err := a.Identity.AuthorizePrincipalTx(tx, actor); err != nil {
			return corestore.MutationEffect{}, err
		}
		current, err := corestore.ReadSnapshotPackage(tx, pack.ID)
		if err != nil {
			return corestore.MutationEffect{}, err
		}
		if current.OwnerUserID != actor.UserID || current.Digest == nil || *current.Digest != verified.Digest || current.Size != verified.Size {
			return corestore.MutationEffect{}, snapshotInvalid("package.record")
		}
		if current.State != "ready" || current.ExpiresAt == nil || snapshotExpired(*current.ExpiresAt) {
			return corestore.MutationEffect{}, contracts.NewError("PACKAGE_EXPIRED", "")
		}
		bindings, err := a.resolveSnapshotBindings(tx, actor.UserID, verified.Spec.Bindings, nil)
		if err != nil {
			return corestore.MutationEffect{}, err
		}
		name, err := snapshotImportName(tx, actor.UserID, verified.Spec.SourceName, input.Name)
		if err != nil {
			return corestore.MutationEffect{}, err
		}
		digest, err := contracts.PrivateDigest("snapshot/import-work", json.RawMessage(request))
		if err != nil {
			return corestore.MutationEffect{}, err
		}
		job := corestore.SnapshotJob{OperationID: id, OwnerUserID: actor.UserID, Kind: "import", TargetWorkID: &workID, PackageID: &pack.ID, Name: &name, RequestDigest: digest, Phase: "accepted", DeadlineAt: time.Now().Add(30 * time.Minute).UTC().Format(time.RFC3339Nano), WorkerEpoch: 1, CreatedAt: now, UpdatedAt: now}
		if err := corestore.InsertSnapshotJob(tx, job); err != nil {
			return corestore.MutationEffect{}, err
		}
		for _, entry := range []struct {
			key   string
			value any
		}{{"identity-map", targets}, {"bindings", bindings}, {"helper-image", image}} {
			logical := string(snapshotRaw(entry.value))
			if entry.key == "helper-image" {
				logical = image
			}
			if err := corestore.InsertSnapshotArtifact(tx, corestore.SnapshotArtifact{OperationID: id, ArtifactKey: entry.key, Kind: entry.key, LogicalID: logical, State: "ready"}, 1); err != nil {
				return corestore.MutationEffect{}, err
			}
		}
		if err := corestore.ReserveImportName(tx, actor.UserID, name, id); err != nil {
			return corestore.MutationEffect{}, err
		}
		if err := reserveSnapshotImportQuota(tx, workID, verified.Spec, now); err != nil {
			return corestore.MutationEffect{}, err
		}
		return corestore.MutationEffect{ResourceID: workID}, nil
	})
	if err != nil {
		return output, snapshotPublicError(err)
	}
	if !accepted.Reused {
		a.kickSnapshotImport(accepted.OperationID)
	}
	return response(accepted)
}
func snapshotImportName(tx *sql.Tx, owner, source string, explicit contracts.Field[string]) (string, error) {
	for n := 1; n < 1000000; n++ {
		suffix := ""
		if n > 1 {
			suffix = fmt.Sprintf("-%d", n)
		}
		runes := []rune(source)
		if len(runes) > 128-len(suffix) {
			runes = runes[:128-len(suffix)]
		}
		name := string(runes) + suffix
		if explicit.Present {
			name = explicit.Value
		}
		var busy bool
		if err := tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM works WHERE owner_user_id=? AND name=? UNION ALL SELECT 1 FROM work_import_names WHERE owner_user_id=? AND name=?)`, owner, name, owner, name).Scan(&busy); err != nil {
			return "", err
		}
		if !busy {
			return name, nil
		}
		if explicit.Present {
			return "", contracts.NewError("WORK_NAME_CONFLICT", "name")
		}
	}
	return "", snapshotInvalid("name")
}
func reserveSnapshotImportQuota(tx *sql.Tx, work string, spec contracts.PortableWorkSpec, now string) error {
	var policy contracts.ResourcePolicy
	for _, c := range spec.Contexts {
		if c.Key == spec.DesiredContext {
			policy = c.Configuration.Resources
		}
	}
	var cpu, memory, services int64
	for _, q := range spec.QuotaReservations {
		if int64(q.DesiredCpuMillis) > contracts.MaxSafeInteger-cpu || int64(q.DesiredMemoryBytes) > contracts.MaxSafeInteger-memory {
			return contracts.NewError("QUOTA_EXCEEDED", "")
		}
		cpu += int64(q.DesiredCpuMillis)
		memory += int64(q.DesiredMemoryBytes)
	}
	for _, s := range spec.Services {
		if string(s.TombstonedAt) == "null" {
			services++
		}
	}
	if cpu > policy.CpuMillis || memory > policy.MemoryBytes || services > policy.MaxServices || len(spec.Volumes) > int(policy.MaxRetainedVolumes) {
		return contracts.NewError("QUOTA_EXCEEDED", "")
	}
	err := corestore.ReserveQuota(tx, corestore.QuotaReservation{WorkID: work, SubjectKind: "import", SubjectID: "import", DesiredCPUMillis: cpu, DesiredMemoryBytes: memory, VolumeSlots: 2, UpdatedAt: now}, corestore.QuotaLimits{CPUMillis: policy.CpuMillis, MemoryBytes: policy.MemoryBytes, MaxRetainedVolumes: &policy.MaxRetainedVolumes}, corestore.QuotaLimits{CPUMillis: 128000, MemoryBytes: 256 << 30})
	if errors.Is(err, corestore.ErrQuotaExceeded) {
		return contracts.NewError("QUOTA_EXCEEDED", "")
	}
	return err
}
