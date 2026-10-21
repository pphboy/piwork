package coreapp

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"io"
	"strconv"
	"time"

	"golang.org/x/sys/unix"
	"piwork/internal/corestore"
	"piwork/internal/dockerengine"
	"piwork/internal/safefs"
)

// recoverLogSources indexes instances that predate this feature or survived a
// crash, verifies completely published archives, and records gaps for bound
// sources whose exact instance is gone. It is best effort: Docker/model
// availability must not gate ordinary Work recovery.
func (a *Application) recoverLogSources(ctx context.Context) {
	if a.Store == nil || a.dockerRuntime == nil || a.logs == nil {
		return
	}
	recoveryCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	a.indexBoundLogSources(recoveryCtx)
	a.recoverPublishedLogArchives(recoveryCtx)
	a.markMissingLogSources(recoveryCtx)
}

func (a *Application) logWorkOwner(ctx context.Context, workID string) (string, bool) {
	var owner string
	err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		return tx.QueryRowContext(ctx, `SELECT owner_user_id FROM works WHERE id=? AND deleted_at IS NULL`, workID).Scan(&owner)
	})
	return owner, err == nil && owner != ""
}

func (a *Application) indexBoundLogSources(ctx context.Context) {
	var agents []corestore.ResourceBinding
	var services []corestore.ServiceRuntimeBinding
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		var err error
		agents, err = corestore.ResourceBindings(tx, a.Store.InstallationID(), "agent")
		if err != nil {
			return err
		}
		services, err = corestore.ServiceRuntimeBindings(tx)
		return err
	}); err != nil {
		return
	}
	now := packageNow()
	for _, binding := range agents {
		var labels map[string]string
		if json.Unmarshal([]byte(binding.LabelsJSON), &labels) != nil {
			continue
		}
		instanceID := labels["piwork.instance_id"]
		contextID := labels["piwork.context_identity"]
		generation := binding.Generation
		if parsed, err := strconv.ParseInt(labels["piwork.generation"], 10, 64); err == nil && parsed > 0 {
			generation = parsed
		}
		if instanceID == "" || contextID == "" || generation <= 0 {
			continue
		}
		identity := dockerengine.ContainerIdentity{WorkID: binding.WorkID, Kind: "agent", LogicalID: "agentd", Labels: map[string]string{
			"piwork.generation": strconv.FormatInt(generation, 10), "piwork.instance_id": instanceID,
			"piwork.context_identity": contextID, "piwork.protocol_version": "v2",
		}}
		view, err := a.dockerRuntime.InspectContainer(ctx, identity)
		if err != nil || view == nil || view.ID != binding.RuntimeID {
			continue
		}
		work, err := a.Store.Work(ctx, binding.WorkID, false)
		if err != nil {
			continue
		}
		owner := work.OwnerUserID
		configRevision, _ := a.logContextRevision(ctx, binding.WorkID, contextID)
		if _, found, err := a.Store.LogSourceByContainer(ctx, view.ID); err != nil || found {
			continue
		}
		sourceID, ok := corestore.LogSourceID(a.Store.InstallationID(), binding.WorkID, "agent", "agentd", generation, instanceID)
		if !ok {
			continue
		}
		if _, err := a.Store.RegisterLogSource(ctx, corestore.LogSourceRegistration{
			SourceID: sourceID, OwnerUserID: owner, WorkID: binding.WorkID, Kind: "agent",
			Generation: generation, ConfigRevision: configRevision, InstanceID: instanceID, CreatedAt: now,
		}); err != nil {
			continue
		}
		_, _ = a.Store.BindLogSource(ctx, sourceID, view.ID, dockerengine.ObservedContainerLogPolicyVersion(view.HostConfig), now)
	}
	for _, binding := range services {
		if binding.ContainerID == nil || binding.Revision <= 0 {
			continue
		}
		identity := serviceContainerIdentity(binding.WorkID, binding.ServiceID, binding.Revision)
		view, err := a.dockerRuntime.InspectContainer(ctx, identity)
		if err != nil || view == nil || view.ID != *binding.ContainerID {
			continue
		}
		owner, ok := a.logWorkOwner(ctx, binding.WorkID)
		if !ok {
			continue
		}
		if _, found, err := a.Store.LogSourceByContainer(ctx, view.ID); err != nil || found {
			continue
		}
		instanceID := "container-" + view.ID
		sourceID, ok := corestore.LogSourceID(a.Store.InstallationID(), binding.WorkID, "service", binding.ServiceID, binding.Revision, instanceID)
		if !ok {
			continue
		}
		if _, err := a.Store.RegisterLogSource(ctx, corestore.LogSourceRegistration{
			SourceID: sourceID, OwnerUserID: owner, WorkID: binding.WorkID, Kind: "service", ServiceID: binding.ServiceID,
			Generation: binding.Revision, InstanceID: instanceID, CreatedAt: now,
		}); err != nil {
			continue
		}
		_, _ = a.Store.BindLogSource(ctx, sourceID, view.ID, dockerengine.ObservedContainerLogPolicyVersion(view.HostConfig), now)
	}
}

func (a *Application) recoverPublishedLogArchives(ctx context.Context) {
	sources, err := a.Store.LogSources(ctx)
	if err != nil {
		return
	}
	for _, source := range sources {
		if source.State == "archived" || source.State == "partial" {
			continue
		}
		root, exists, err := a.Store.OpenExistingLogSourceDir(source.WorkID, source.SourceID)
		if err != nil || !exists {
			continue
		}
		rawMetadata, readErr := root.ReadFile(archiveMetadataFileName, 1<<20)
		var metadata archiveMetadata
		if readErr != nil || json.Unmarshal(rawMetadata, &metadata) != nil || metadata.SourceID != source.SourceID ||
			(metadata.State != "archived" && metadata.State != "partial") {
			root.Close()
			continue
		}
		verified := verifyArchiveContent(root, metadata)
		root.Close()
		if !verified {
			archive := corestore.LogArchive{Version: 1, SourceID: source.SourceID, State: "failed", Reason: "published archive failed verification", PublishedAt: packageNow()}
			_ = a.Store.RecordLogArchive(ctx, source.SourceID, archive, "failed", archive.PublishedAt)
			continue
		}
		archive := corestore.LogArchive{
			Version: 1, SourceID: source.SourceID, State: metadata.State, StartTime: metadata.StartTime, EndTime: metadata.EndTime,
			StdoutBytes: metadata.StdoutBytes, StderrBytes: metadata.StderrBytes, StdoutDigest: metadata.StdoutDigest,
			StderrDigest: metadata.StderrDigest, PublishedAt: metadata.ArchivedAt, Reason: metadata.Reason,
		}
		_ = a.Store.RecordLogArchive(ctx, source.SourceID, archive, metadata.State, metadata.ArchivedAt)
	}
}

func verifyArchiveContent(root *safefs.Root, metadata archiveMetadata) bool {
	stdoutSize, stdoutDigest, ok := hashArchiveFile(root, "stdout.log", maxArchiveSourceBytes)
	if !ok || stdoutSize != metadata.StdoutBytes || stdoutDigest != metadata.StdoutDigest {
		return false
	}
	stderrSize, stderrDigest, ok := hashArchiveFile(root, "stderr.log", maxArchiveSourceBytes)
	return ok && stderrSize == metadata.StderrBytes && stderrDigest == metadata.StderrDigest
}

func (a *Application) markMissingLogSources(ctx context.Context) {
	sources, err := a.Store.LogSources(ctx)
	if err != nil {
		return
	}
	now := time.Now().UTC()
	for _, source := range sources {
		if source.State == "archived" || source.State == "partial" || source.State == "missing" || source.State == "failed" {
			continue
		}
		if _, exists, err := a.Store.OpenExistingLogSourceDir(source.WorkID, source.SourceID); err != nil || exists {
			continue
		}
		created, err := time.Parse(time.RFC3339Nano, source.CreatedAt)
		if err != nil || now.Sub(created) < time.Minute {
			continue
		}
		reason := "source binding was interrupted"
		if source.ContainerID != "" {
			if a.dockerRuntime == nil {
				continue
			}
			logicalID := "agentd"
			if source.Kind == "service" {
				logicalID = source.ServiceID
			}
			view, inspectErr := a.dockerRuntime.InspectContainer(ctx, dockerengine.ContainerIdentity{WorkID: source.WorkID, Kind: source.Kind, LogicalID: logicalID})
			if inspectErr != nil {
				continue
			}
			if view != nil && view.ID == source.ContainerID {
				continue
			}
			reason = "exact source instance is missing"
		}
		archive := corestore.LogArchive{Version: 1, SourceID: source.SourceID, State: "missing", Reason: reason, PublishedAt: now.Format(time.RFC3339Nano)}
		_ = a.Store.RecordLogArchive(ctx, source.SourceID, archive, "missing", archive.PublishedAt)
	}
}

func hashArchiveFile(root *safefs.Root, name string, limit int64) (int64, string, bool) {
	file, err := root.OpenFile(name, unix.O_RDONLY)
	if err != nil {
		return 0, "", false
	}
	defer file.Close()
	hash := sha256.New()
	size, err := io.CopyBuffer(hash, io.LimitReader(file, limit+1), make([]byte, 32<<10))
	if err != nil || size > limit {
		return 0, "", false
	}
	return size, hex.EncodeToString(hash.Sum(nil)), true
}
