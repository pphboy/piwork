package dockerengine

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"path/filepath"
	"reflect"
	"regexp"
	"strconv"
	"time"

	"github.com/containerd/errdefs"
	"github.com/moby/moby/api/types/container"
	"github.com/moby/moby/api/types/mount"
	"github.com/moby/moby/client"
	"golang.org/x/sys/unix"
	"piwork/internal/contracts"
	"piwork/internal/workpackage"
)

const SnapshotJobLabel = "piwork.snapshot_job_id"
const SnapshotEpochLabel = "piwork.snapshot_worker_epoch"
const SnapshotAttemptLabel = "piwork.snapshot_attempt_id"

type SnapshotHelperSpec struct {
	WorkID, JobID, AttemptID, ImageID, SpoolDirectory                                  string
	VolumeName, VolumeLogicalID, Action, TreeDigest, ContextKey, PackageKey, SpoolUser string
	Epoch                                                                              int64
}

var snapshotKey = regexp.MustCompile(`^[a-z][a-z0-9-]{0,63}$`)
var snapshotDigest = regexp.MustCompile(`^[a-f0-9]{64}$`)

type SnapshotHelperError struct{ Code string }

func (e *SnapshotHelperError) Error() string { return e.Code }
func SnapshotHelperName(installation, job, attempt string) string {
	sum := sha256.Sum256([]byte(installation + "\x00" + job + "\x00" + attempt))
	return "piwork-snapshot-" + hex.EncodeToString(sum[:16])
}
func SnapshotHelperIdentity(spec SnapshotHelperSpec) ContainerIdentity {
	return ContainerIdentity{WorkID: spec.WorkID, Kind: "snapshot-helper", LogicalID: spec.JobID + "." + spec.AttemptID, Labels: map[string]string{SnapshotJobLabel: spec.JobID, SnapshotEpochLabel: strconv.FormatInt(spec.Epoch, 10), SnapshotAttemptLabel: spec.AttemptID, "piwork.snapshot_action": spec.Action}}
}
func (r *Runtime) snapshotHelperPolicy(ctx context.Context, spec SnapshotHelperSpec) (string, *container.Config, *container.HostConfig, error) {
	if !identityPattern.MatchString(spec.JobID) || !identityPattern.MatchString(spec.AttemptID) || !imageIDPattern.MatchString(spec.ImageID) || spec.Epoch < 1 || spec.Epoch > contracts.MaxSafeInteger {
		return "", nil, nil, ErrSpecification
	}
	labels, err := r.containerLabels(SnapshotHelperIdentity(spec))
	if err != nil {
		return "", nil, nil, err
	}
	arguments := []string{spec.Action}
	restore := spec.Action == "restore" || spec.Action == "restore-context" || spec.Action == "restore-package"
	if restore {
		if !snapshotDigest.MatchString(spec.TreeDigest) {
			return "", nil, nil, ErrSpecification
		}
		arguments = append(arguments, spec.TreeDigest)
	} else if spec.TreeDigest != "" {
		return "", nil, nil, ErrSpecification
	}
	contextAction := spec.Action == "restore-context" || spec.Action == "restore-package"
	if contextAction {
		if !snapshotKey.MatchString(spec.ContextKey) {
			return "", nil, nil, ErrSpecification
		}
		arguments = append(arguments, spec.ContextKey)
	} else if spec.ContextKey != "" {
		return "", nil, nil, ErrSpecification
	}
	if spec.Action == "restore-package" {
		if !snapshotDigest.MatchString(spec.PackageKey) {
			return "", nil, nil, ErrSpecification
		}
		arguments = append(arguments, spec.PackageKey)
	} else if spec.PackageKey != "" {
		return "", nil, nil, ErrSpecification
	}
	switch spec.Action {
	case "capture", "restore", "restore-context", "restore-package", "verify-history", "restore-history", "verify-package":
	default:
		return "", nil, nil, ErrSpecification
	}
	upload := spec.Action == "verify-package"
	noVolume := upload || contextAction
	if noVolume != (spec.VolumeName == "") {
		return "", nil, nil, ErrSpecification
	}
	if noVolume && spec.VolumeLogicalID != "" {
		return "", nil, nil, ErrSpecification
	}
	if !noVolume {
		if spec.VolumeLogicalID != "work-private" && spec.VolumeLogicalID != "work-workspace" {
			return "", nil, nil, ErrSpecification
		}
		if _, err := r.InspectVolume(ctx, spec.VolumeName, spec.WorkID, spec.VolumeLogicalID); err != nil {
			return "", nil, nil, err
		}
	}
	if !filepath.IsAbs(spec.SpoolDirectory) || filepath.Clean(spec.SpoolDirectory) != spec.SpoolDirectory {
		return "", nil, nil, ErrSpecification
	}
	spoolFD, err := workpackage.OpenDirectoryFD(spec.SpoolDirectory)
	if err != nil {
		return "", nil, nil, ErrSpecification
	}
	unix.Close(spoolFD)
	if err := r.validateMounts(ctx, ContainerSpec{Mounts: []ContainerMount{{Type: "bind", Source: spec.SpoolDirectory, Target: "/snapshot/spool"}}}); err != nil {
		return "", nil, nil, err
	}
	if upload {
		if !numericUser.MatchString(spec.SpoolUser) || spec.SpoolUser == "" {
			return "", nil, nil, ErrSpecification
		}
	} else if spec.SpoolUser != "" {
		return "", nil, nil, ErrSpecification
	}
	pids := int64(64)
	host := &container.HostConfig{NetworkMode: "none", ReadonlyRootfs: true, CapDrop: []string{"ALL"}, SecurityOpt: []string{"no-new-privileges:true"}, Resources: container.Resources{NanoCPUs: 1e9, Memory: 512 << 20, PidsLimit: &pids}, Mounts: []mount.Mount{{Type: mount.TypeBind, Source: spec.SpoolDirectory, Target: "/snapshot/spool"}}}
	user := "0:0"
	if upload {
		user = spec.SpoolUser
	} else {
		host.CapAdd = []string{"CAP_CHOWN", "CAP_DAC_OVERRIDE", "CAP_DAC_READ_SEARCH", "CAP_FOWNER"}
	}
	if !noVolume {
		host.Mounts = append(host.Mounts, mount.Mount{Type: mount.TypeVolume, Source: spec.VolumeName, Target: "/snapshot/volume", ReadOnly: spec.Action == "capture" || spec.Action == "verify-history", VolumeOptions: &mount.VolumeOptions{NoCopy: true}})
	}
	config := &container.Config{Image: spec.ImageID, User: user, Entrypoint: []string{"/usr/local/bin/piwork-snapshot-helper"}, Cmd: arguments, Labels: labels, AttachStdout: true, AttachStderr: true}
	encoded, _ := json.Marshal(struct {
		Config *container.Config
		Host   *container.HostConfig
	}{config, host})
	value, err := contracts.ParseJSON(bytes.NewReader(encoded), 4<<20)
	if err != nil {
		return "", nil, nil, ErrSpecification
	}
	hash, err := contracts.PrivateDigest("docker/snapshot-helper/v1", value)
	if err != nil {
		return "", nil, nil, err
	}
	labels[SpecLabel] = hash
	return SnapshotHelperName(r.installationID, spec.JobID, spec.AttemptID), config, host, nil
}
func (r *Runtime) InspectSnapshotHelper(ctx context.Context, spec SnapshotHelperSpec) (*container.InspectResponse, error) {
	name, config, host, err := r.snapshotHelperPolicy(ctx, spec)
	if err != nil {
		return nil, err
	}
	view, err := r.engine.api.ContainerInspect(ctx, name, client.ContainerInspectOptions{})
	if errdefs.IsNotFound(err) {
		return nil, nil
	}
	if err != nil {
		return nil, runtimeError(err)
	}
	c := view.Container
	actual := c.HostConfig
	if c.Config == nil || actual == nil || c.Image != spec.ImageID || c.Config.Image != spec.ImageID || c.Config.User != config.User || c.Config.Tty || c.Config.OpenStdin || !reflect.DeepEqual([]string(c.Config.Entrypoint), []string(config.Entrypoint)) || !reflect.DeepEqual([]string(c.Config.Cmd), []string(config.Cmd)) {
		return nil, ErrSpecificationConflict
	}
	if err := checkLabels(c.Config.Labels, config.Labels); err != nil {
		return nil, err
	}
	if actual.Privileged || !actual.ReadonlyRootfs || actual.NetworkMode != "none" || len(actual.PortBindings) != 0 || len(actual.Binds) != 0 || len(actual.Devices) != 0 || len(actual.Tmpfs) != 0 || actual.NanoCPUs != host.NanoCPUs || actual.Memory != host.Memory || actual.PidsLimit == nil || *actual.PidsLimit != *host.PidsLimit || !reflect.DeepEqual(actual.CapDrop, host.CapDrop) || !reflect.DeepEqual(actual.CapAdd, host.CapAdd) || !reflect.DeepEqual(actual.SecurityOpt, host.SecurityOpt) || len(c.Mounts) != len(host.Mounts) {
		return nil, ErrSpecificationConflict
	}
	for _, expected := range host.Mounts {
		found := false
		for _, m := range c.Mounts {
			if m.Destination != expected.Target {
				continue
			}
			found = true
			if string(m.Type) != string(expected.Type) || m.RW == expected.ReadOnly {
				return nil, ErrSpecificationConflict
			}
			if expected.Type == mount.TypeVolume && m.Name != expected.Source || expected.Type == mount.TypeBind && m.Source != expected.Source {
				return nil, ErrSpecificationConflict
			}
		}
		if !found {
			return nil, ErrSpecificationConflict
		}
	}
	return &c, nil
}
func (r *Runtime) EnsureSnapshotHelper(ctx context.Context, spec SnapshotHelperSpec) (EnsuredContainer, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	name, config, host, err := r.snapshotHelperPolicy(ctx, spec)
	if err != nil {
		return EnsuredContainer{}, err
	}
	view, err := r.InspectSnapshotHelper(ctx, spec)
	if err != nil {
		return EnsuredContainer{}, err
	}
	if view != nil {
		return EnsuredContainer{ID: view.ID, Name: name, SpecHash: config.Labels[SpecLabel]}, nil
	}
	if err := r.register(ctx, ResourcePlan{WorkID: spec.WorkID, Kind: "snapshot-helper", LogicalID: SnapshotHelperIdentity(spec).LogicalID, Name: name, SpecHash: config.Labels[SpecLabel], Labels: config.Labels}); err != nil {
		return EnsuredContainer{}, err
	}
	created, err := r.engine.api.ContainerCreate(ctx, client.ContainerCreateOptions{Name: name, Config: config, HostConfig: host})
	if err != nil {
		return EnsuredContainer{}, runtimeError(err)
	}
	view, err = r.InspectSnapshotHelper(ctx, spec)
	if err != nil {
		return EnsuredContainer{}, err
	}
	if view == nil || view.ID != created.ID {
		return EnsuredContainer{}, ErrStateUnknown
	}
	return EnsuredContainer{ID: created.ID, Name: name, SpecHash: config.Labels[SpecLabel], Created: true}, nil
}

// An attempt starts only from created. Caller owns durable recovery and must
// confirm removal before releasing its journal; this method never replays.
func (r *Runtime) RunSnapshotHelper(ctx context.Context, spec SnapshotHelperSpec) (json.RawMessage, error) {
	r.mu.Lock()
	view, err := r.InspectSnapshotHelper(ctx, spec)
	if err != nil {
		r.mu.Unlock()
		return nil, err
	}
	if view == nil || view.State == nil || view.State.Status != "created" {
		r.mu.Unlock()
		return nil, ErrStateUnknown
	}
	attached, err := r.engine.api.ContainerAttach(ctx, view.ID, client.ContainerAttachOptions{Stream: true, Stdout: true, Stderr: true})
	if err != nil {
		r.mu.Unlock()
		return nil, runtimeError(err)
	}
	defer attached.Close()
	stop := context.AfterFunc(ctx, func() { attached.Close() })
	defer stop()
	if _, err := r.engine.api.ContainerStart(ctx, view.ID, client.ContainerStartOptions{}); err != nil {
		r.mu.Unlock()
		return nil, runtimeError(err)
	}
	r.mu.Unlock()
	var output bytes.Buffer
	safeError := newTail(4096)
	if err := Demultiplex(ctx, attached.Reader, &limitedWriter{writer: &output, remaining: 64 << 10}, safeError); err != nil {
		return nil, err
	}
	for {
		after, err := r.InspectSnapshotHelper(ctx, spec)
		if err != nil {
			return nil, err
		}
		if after == nil || after.ID != view.ID || after.State == nil {
			return nil, ErrStateUnknown
		}
		if !after.State.Running && after.State.Status == "exited" {
			if after.State.ExitCode != 0 {
				var message struct {
					Code string `json:"code"`
				}
				if json.Unmarshal(bytes.TrimSpace(safeError.bytes), &message) == nil {
					switch message.Code {
					case "PACKAGE_INVALID", "PACKAGE_LIMIT_EXCEEDED", "PACKAGE_FORMAT_UNSUPPORTED", "PACKAGE_INCOMPATIBLE", "SNAPSHOT_STORAGE_UNREADABLE", "SNAPSHOT_STORAGE_UNSUPPORTED", "SNAPSHOT_HISTORY_INVALID", "SNAPSHOT_HISTORY_BUSY", "SNAPSHOT_HISTORY_UNSUPPORTED", "SNAPSHOT_HISTORY_LIMIT":
						return nil, &SnapshotHelperError{message.Code}
					}
				}
				return nil, ErrStateUnknown
			}
			if _, err := contracts.ParseJSON(bytes.NewReader(output.Bytes()), 64<<10); err != nil {
				return nil, ErrStateUnknown
			}
			return bytes.TrimSpace(output.Bytes()), nil
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(10 * time.Millisecond):
		}
	}
}

func (r *Runtime) RemoveSnapshotHelper(ctx context.Context, spec SnapshotHelperSpec, confirmedID string) error {
	if confirmedID == "" {
		return ErrStateUnknown
	}
	view, err := r.InspectSnapshotHelper(ctx, spec)
	if err != nil {
		return err
	}
	if view == nil {
		return r.ConfirmContainerAbsent(ctx, confirmedID, SnapshotHelperName(r.installationID, spec.JobID, spec.AttemptID))
	}
	if view.ID != confirmedID {
		return ErrIdentity
	}
	if view.State == nil {
		return ErrStateUnknown
	}
	if view.State.Running {
		seconds := 3
		if _, err := r.engine.api.ContainerStop(ctx, view.ID, client.ContainerStopOptions{Timeout: &seconds}); err != nil {
			return runtimeError(err)
		}
	}
	after, err := r.InspectSnapshotHelper(ctx, spec)
	if err != nil {
		return err
	}
	if after == nil {
		return r.ConfirmContainerAbsent(ctx, confirmedID, SnapshotHelperName(r.installationID, spec.JobID, spec.AttemptID))
	}
	if after.ID != confirmedID || after.State == nil || after.State.Running {
		return ErrStateUnknown
	}
	if _, err := r.engine.api.ContainerRemove(ctx, confirmedID, client.ContainerRemoveOptions{RemoveVolumes: false}); err != nil && !errdefs.IsNotFound(err) {
		return runtimeError(err)
	}
	return r.ConfirmContainerAbsent(ctx, confirmedID, SnapshotHelperName(r.installationID, spec.JobID, spec.AttemptID))
}
