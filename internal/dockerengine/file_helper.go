package dockerengine

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"strconv"

	"piwork/internal/contracts"
)

const FileJobLabel = "piwork.file_job_id"
const FileEpochLabel = "piwork.file_epoch"
const FileAttemptLabel = "piwork.file_attempt_id"

type FileHelperSpec struct {
	WorkID, JobID, AttemptID, ImageID, VolumeName string
	Epoch                                         int64
	ReadOnly                                      bool
}

func FileHelperName(installationID, jobID, attemptID string) string {
	sum := sha256.Sum256([]byte(installationID + "\x00" + jobID + "\x00" + attemptID))
	return "piwork-file-" + hex.EncodeToString(sum[:16])
}
func FileHelperIdentity(spec FileHelperSpec) ContainerIdentity {
	return ContainerIdentity{WorkID: spec.WorkID, Kind: "file-helper", LogicalID: spec.JobID + "." + spec.AttemptID, Labels: map[string]string{FileJobLabel: spec.JobID, FileAttemptLabel: spec.AttemptID, FileEpochLabel: strconv.FormatInt(spec.Epoch, 10)}}
}
func (r *Runtime) EnsureFileHelper(ctx context.Context, spec FileHelperSpec) (EnsuredContainer, error) {
	if !identityPattern.MatchString(spec.WorkID) || !identityPattern.MatchString(spec.JobID) || !identityPattern.MatchString(spec.AttemptID) || !imageIDPattern.MatchString(spec.ImageID) || spec.Epoch < 1 || spec.Epoch > contracts.MaxSafeInteger {
		return EnsuredContainer{}, ErrSpecification
	}
	if _, err := r.InspectVolume(ctx, spec.VolumeName, spec.WorkID, "work-workspace"); err != nil {
		return EnsuredContainer{}, err
	}
	return r.EnsureContainer(ctx, ContainerSpec{Identity: FileHelperIdentity(spec), DisplayName: FileHelperName(r.installationID, spec.JobID, spec.AttemptID), Image: spec.ImageID,
		Entrypoint: []string{"/usr/local/bin/piwork-file-helper"}, Command: []string{"--job-id", spec.JobID, "--work-id", spec.WorkID, "--epoch", strconv.FormatInt(spec.Epoch, 10)},
		CPUMillis: 500, MemoryBytes: 128 << 20, User: "10001:10001", Stdin: true,
		Mounts: []ContainerMount{{Type: "volume", Source: spec.VolumeName, Target: "/workspace", ReadOnly: spec.ReadOnly}}})
}
