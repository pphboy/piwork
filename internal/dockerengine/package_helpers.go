package dockerengine

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"strconv"
	"time"

	"github.com/containerd/errdefs"
	"github.com/moby/moby/api/types/container"
	"github.com/moby/moby/api/types/mount"
	"github.com/moby/moby/client"
	"piwork/internal/contracts"
	"piwork/internal/pipackage"
)

const PackageJobLabel = "piwork.pi_package_job_id"

// SetPackageSettler must be configured before package workers start. The
// production callback persists confirmation of the Engine's exact identity.
func (r *Runtime) SetPackageSettler(settle IntentRecorder)  { r.packageSettler = settle }
func (r *Runtime) MarkPackageCreationUncertain(name string) { r.packageUncertain.Store(name, true) }
func (r *Runtime) settlePackageCreation(ctx context.Context, plan ResourcePlan) error {
	if r.packageSettler != nil {
		if err := r.packageSettler(ctx, plan); err != nil {
			return err
		}
	}
	r.packageUncertain.Delete(plan.Name)
	return nil
}

// Package resources use a separate identity and mount policy. Trusted init and
// capture need privileges which must never be available to a user Service.
type PackageIdentity struct {
	WorkID, JobID string
}

type PackageResources struct{ VolumeName, NetworkName string }

type PackageHelperSpec struct {
	PackageIdentity
	Epoch                                                          int64
	Action, ImageID, SourceDirectory, SpoolDirectory, SourceVolume string
}

func (r *Runtime) packageLabels(id PackageIdentity, kind, logical string) (map[string]string, error) {
	if !identityPattern.MatchString(id.JobID) {
		return nil, ErrIdentity
	}
	labels, err := r.baseLabels(id.WorkID)
	if err != nil {
		return nil, err
	}
	labels[PackageJobLabel] = id.JobID
	labels[KindLabel] = kind
	labels[LogicalLabel] = logical
	return labels, nil
}

func (r *Runtime) packageResources(id PackageIdentity) PackageResources {
	return PackageResources{resourceName("pkg-volume", r.installationID, id.WorkID, id.JobID), resourceName("pkg-egress", r.installationID, id.WorkID, id.JobID)}
}

func (r *Runtime) inspectPackageVolume(ctx context.Context, id PackageIdentity) (bool, error) {
	labels, err := r.packageLabels(id, "package-volume", id.JobID)
	if err != nil {
		return false, err
	}
	view, err := r.engine.api.VolumeInspect(ctx, r.packageResources(id).VolumeName, client.VolumeInspectOptions{})
	if errdefs.IsNotFound(err) {
		return false, nil
	}
	if err != nil {
		return false, runtimeError(err)
	}
	if view.Volume.Driver != "local" || len(view.Volume.Options) != 0 {
		return false, ErrIdentity
	}
	if err := checkLabels(view.Volume.Labels, labels); err != nil {
		return false, err
	}
	if err := r.settlePackageCreation(ctx, ResourcePlan{WorkID: id.WorkID, Kind: "package-volume", LogicalID: id.JobID, Name: r.packageResources(id).VolumeName}); err != nil {
		return false, err
	}
	return true, nil
}

func (r *Runtime) inspectPackageNetwork(ctx context.Context, id PackageIdentity) (bool, error) {
	labels, err := r.packageLabels(id, "package-network", id.JobID)
	if err != nil {
		return false, err
	}
	view, err := r.engine.api.NetworkInspect(ctx, r.packageResources(id).NetworkName, client.NetworkInspectOptions{})
	if errdefs.IsNotFound(err) {
		return false, nil
	}
	if err != nil {
		return false, runtimeError(err)
	}
	if view.Network.Driver != "bridge" || view.Network.Internal {
		return false, ErrIdentity
	}
	if err := checkLabels(view.Network.Labels, labels); err != nil {
		return false, err
	}
	if err := r.settlePackageCreation(ctx, ResourcePlan{WorkID: id.WorkID, Kind: "package-network", LogicalID: id.JobID, Name: r.packageResources(id).NetworkName}); err != nil {
		return false, err
	}
	return true, nil
}

// Creation intents survive lost Engine responses. No fallback resource name is
// used; a mismatched existing name is rejected before any mutation.
func (r *Runtime) EnsurePackageResources(ctx context.Context, id PackageIdentity) (PackageResources, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	resources := r.packageResources(id)
	volumeExists, err := r.inspectPackageVolume(ctx, id)
	if err != nil {
		return resources, err
	}
	if !volumeExists {
		labels, err := r.packageLabels(id, "package-volume", id.JobID)
		if err != nil {
			return resources, err
		}
		if err := r.register(ctx, ResourcePlan{WorkID: id.WorkID, Kind: "package-volume", LogicalID: id.JobID, Name: resources.VolumeName, Labels: labels}); err != nil {
			return resources, err
		}
		if _, err := r.engine.api.VolumeCreate(ctx, client.VolumeCreateOptions{Name: resources.VolumeName, Driver: "local", Labels: labels}); err != nil {
			r.packageUncertain.Store(resources.VolumeName, true)
			return resources, runtimeError(err)
		}
		if exists, err := r.inspectPackageVolume(ctx, id); err != nil || !exists {
			if err == nil {
				err = ErrStateUnknown
			}
			return resources, err
		}
	}
	networkExists, err := r.inspectPackageNetwork(ctx, id)
	if err != nil {
		return resources, err
	}
	if !networkExists {
		labels, err := r.packageLabels(id, "package-network", id.JobID)
		if err != nil {
			return resources, err
		}
		if err := r.register(ctx, ResourcePlan{WorkID: id.WorkID, Kind: "package-network", LogicalID: id.JobID, Name: resources.NetworkName, Labels: labels}); err != nil {
			return resources, err
		}
		if _, err := r.engine.api.NetworkCreate(ctx, resources.NetworkName, client.NetworkCreateOptions{Driver: "bridge", Labels: labels}); err != nil {
			r.packageUncertain.Store(resources.NetworkName, true)
			return resources, runtimeError(err)
		}
		if exists, err := r.inspectPackageNetwork(ctx, id); err != nil || !exists {
			if err == nil {
				err = ErrStateUnknown
			}
			return resources, err
		}
	}
	return resources, nil
}

func packageLogical(spec PackageHelperSpec) string {
	return spec.JobID + "-" + strconv.FormatInt(spec.Epoch, 10) + "-" + spec.Action
}

func (r *Runtime) packageHelperPolicy(ctx context.Context, spec PackageHelperSpec) (string, *container.Config, *container.HostConfig, error) {
	if spec.SourceVolume != "" && spec.Action != "source-capture" {
		return "", nil, nil, ErrSpecification
	}
	if spec.Epoch < 1 || spec.Epoch > contracts.MaxSafeInteger || !imageIDPattern.MatchString(spec.ImageID) {
		return "", nil, nil, ErrSpecification
	}
	labels, err := r.packageLabels(spec.PackageIdentity, "package-helper", packageLogical(spec))
	if err != nil {
		return "", nil, nil, err
	}
	labels["piwork.package_worker_epoch"] = strconv.FormatInt(spec.Epoch, 10)
	labels["piwork.package_action"] = spec.Action
	labels["piwork.package_image_id"] = spec.ImageID
	resources := r.packageResources(spec.PackageIdentity)
	pids := int64(64)
	host := &container.HostConfig{ReadonlyRootfs: true, CapDrop: []string{"ALL"}, SecurityOpt: []string{"no-new-privileges:true"}, NetworkMode: "none", Resources: container.Resources{NanoCPUs: 1e9, Memory: 512 << 20, PidsLimit: &pids}, Mounts: []mount.Mount{{Type: mount.TypeVolume, Source: resources.VolumeName, Target: "/package/work", VolumeOptions: &mount.VolumeOptions{NoCopy: true}}}}
	config := &container.Config{Image: spec.ImageID, User: "0:0", Entrypoint: []string{"/usr/local/bin/piwork-package-helper"}, Cmd: []string{spec.Action}, WorkingDir: "/workspace", Labels: labels, AttachStdout: true, AttachStderr: true}
	bind := func(source, target string, readOnly bool) error {
		if err := r.validateMounts(ctx, ContainerSpec{Mounts: []ContainerMount{{Type: "bind", Source: source, Target: target, ReadOnly: readOnly}}}); err != nil {
			return err
		}
		host.Mounts = append(host.Mounts, mount.Mount{Type: mount.TypeBind, Source: source, Target: target, ReadOnly: readOnly})
		return nil
	}
	switch spec.Action {
	case "init":
		if spec.SourceDirectory != "" || spec.SpoolDirectory != "" {
			return "", nil, nil, ErrSpecification
		}
		host.CapAdd = []string{"CHOWN"}
	case "prepare":
		if spec.SourceDirectory == "" || spec.SpoolDirectory != "" {
			return "", nil, nil, ErrSpecification
		}
		if err := bind(spec.SourceDirectory, "/package/source", true); err != nil {
			return "", nil, nil, err
		}
		config.User = "10001:10001"
		config.Env = []string{"HOME=/package/work/home", "NPM_CONFIG_CACHE=/package/work/npm-cache"}
		host.NetworkMode = container.NetworkMode(resources.NetworkName)
		host.NanoCPUs = 2e9
		host.Memory = 2 << 30
		pids = 256
		host.Tmpfs = map[string]string{"/tmp": "rw,noexec,nosuid,size=256m"}
	case "capture":
		if spec.SpoolDirectory == "" || spec.SourceDirectory != "" {
			return "", nil, nil, ErrSpecification
		}
		if err := bind(spec.SpoolDirectory, "/package/spool", false); err != nil {
			return "", nil, nil, err
		}
		host.Mounts[0].ReadOnly = true
		host.CapAdd = []string{"DAC_OVERRIDE", "CHOWN"}
	case "source-capture":
		if spec.SourceDirectory != "" || spec.SpoolDirectory == "" || spec.SourceVolume == "" {
			return "", nil, nil, ErrSpecification
		}
		if _, err := r.InspectVolume(ctx, spec.SourceVolume, spec.WorkID, "work-workspace"); err != nil {
			return "", nil, nil, err
		}
		if err := bind(spec.SpoolDirectory, "/package/spool", false); err != nil {
			return "", nil, nil, err
		}
		host.Mounts[0].ReadOnly = true
		host.Mounts = append(host.Mounts, mount.Mount{Type: mount.TypeVolume, Source: spec.SourceVolume, Target: "/brain-source", ReadOnly: true, VolumeOptions: &mount.VolumeOptions{NoCopy: true}})
		host.CapAdd = []string{"DAC_OVERRIDE", "CHOWN"}
	case "measure":
		if spec.SourceDirectory != "" || spec.SpoolDirectory != "" {
			return "", nil, nil, ErrSpecification
		}
		config.User = "10001:10001"
		host.Mounts[0].ReadOnly = true
		host.NanoCPUs = 250e6
		host.Memory = 128 << 20
		pids = 32
	case "environment":
		if spec.SourceDirectory != "" || spec.SpoolDirectory != "" {
			return "", nil, nil, ErrSpecification
		}
		// Node inspects only its own version and the retained host SDK manifest.
		// No user package, lifecycle script or volume is loaded by this probe.
		config.User = "10001:10001"
		config.Entrypoint = []string{"node"}
		config.Cmd = []string{"-e", `const fs=require('fs');const sdk=JSON.parse(fs.readFileSync('/workspace/node_modules/@earendil-works/pi-coding-agent/package.json')).version;console.log(JSON.stringify({os:process.platform,architecture:process.arch==='x64'?'amd64':process.arch,variant:null,nodeAbi:process.versions.modules,piSdkVersion:sdk}));`}
		host.Mounts = nil
		host.NanoCPUs = 250e6
		host.Memory = 128 << 20
		pids = 32
	default:
		return "", nil, nil, ErrSpecification
	}
	encoded, _ := json.Marshal(struct {
		Config *container.Config
		Host   *container.HostConfig
	}{config, host})
	value, err := contracts.ParseJSON(bytes.NewReader(encoded), 4<<20)
	if err != nil {
		return "", nil, nil, ErrSpecification
	}
	hash, err := contracts.PrivateDigest("docker/package-helper/v1", value)
	if err != nil {
		return "", nil, nil, err
	}
	labels[SpecLabel] = hash
	return resourceName("pkg-"+spec.Action, r.installationID, spec.WorkID, packageLogical(spec)), config, host, nil
}

func (r *Runtime) InspectPackageHelper(ctx context.Context, spec PackageHelperSpec) (*container.InspectResponse, error) {
	name, config, _, err := r.packageHelperPolicy(ctx, spec)
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
	if view.Container.Config == nil || view.Container.Image != spec.ImageID {
		return nil, ErrIdentity
	}
	if err := checkLabels(view.Container.Config.Labels, config.Labels); err != nil {
		return nil, err
	}
	if err := r.settlePackageCreation(ctx, ResourcePlan{WorkID: spec.WorkID, Kind: "package-helper", LogicalID: packageLogical(spec), Name: name}); err != nil {
		return nil, err
	}
	return &view.Container, nil
}

func (r *Runtime) EnsurePackageHelper(ctx context.Context, spec PackageHelperSpec) (string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	name, config, host, err := r.packageHelperPolicy(ctx, spec)
	if err != nil {
		return "", err
	}
	if spec.Action != "environment" {
		if exists, err := r.inspectPackageVolume(ctx, spec.PackageIdentity); err != nil || !exists {
			if err == nil {
				err = ErrResourceMissing
			}
			return "", err
		}
	}
	if spec.Action == "prepare" {
		if exists, err := r.inspectPackageNetwork(ctx, spec.PackageIdentity); err != nil || !exists {
			if err == nil {
				err = ErrResourceMissing
			}
			return "", err
		}
	}
	existing, err := r.InspectPackageHelper(ctx, spec)
	if err != nil {
		return "", err
	}
	if existing != nil {
		return existing.ID, nil
	}
	if err := r.register(ctx, ResourcePlan{WorkID: spec.WorkID, Kind: "package-helper", LogicalID: packageLogical(spec), Name: name, SpecHash: config.Labels[SpecLabel], Labels: config.Labels}); err != nil {
		return "", err
	}
	createCtx := ctx
	if spec.Action != "environment" {
		// A package worker may be cancelled while the Engine is creating an
		// ordinary job helper. Finish observing this registered attempt so its
		// cleanup can confirm the identity and release the durable intent.
		var cancel context.CancelFunc
		createCtx, cancel = context.WithTimeout(context.WithoutCancel(ctx), 15*time.Second)
		defer cancel()
	}
	created, err := r.engine.api.ContainerCreate(createCtx, client.ContainerCreateOptions{Name: name, Config: config, HostConfig: host})
	if err != nil {
		r.packageUncertain.Store(name, true)
		return "", runtimeError(err)
	}
	view, err := r.InspectPackageHelper(createCtx, spec)
	if err != nil {
		return "", err
	}
	if view == nil || view.ID != created.ID {
		return "", ErrStateUnknown
	}
	return created.ID, nil
}

// Run is at most once. Recovery may read an exited helper's results but cannot
// start it again and repeat package lifecycle scripts.
func (r *Runtime) RunPackageHelper(ctx context.Context, spec PackageHelperSpec) (json.RawMessage, error) {
	// Serialize inspection and start so two callers cannot both run an action.
	r.mu.Lock()
	view, err := r.InspectPackageHelper(ctx, spec)
	if err != nil {
		r.mu.Unlock()
		return nil, err
	}
	if view == nil {
		r.mu.Unlock()
		return nil, ErrResourceMissing
	}
	if view.State == nil || view.State.Status != "created" {
		r.mu.Unlock()
		return nil, ErrStateUnknown
	}
	stream, err := r.engine.api.ContainerAttach(ctx, view.ID, client.ContainerAttachOptions{Stream: true, Stdout: true, Stderr: true})
	if err != nil {
		r.mu.Unlock()
		return nil, runtimeError(err)
	}
	defer stream.Close()
	stop := context.AfterFunc(ctx, func() { stream.Close() })
	defer stop()
	if _, err := r.engine.api.ContainerStart(ctx, view.ID, client.ContainerStartOptions{}); err != nil {
		r.mu.Unlock()
		return nil, runtimeError(err)
	}
	r.mu.Unlock()
	var output bytes.Buffer
	if err := Demultiplex(ctx, stream.Reader, &limitedWriter{writer: &output, remaining: 64 << 10}, io.Discard); err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, err
	}
	// Attach EOF is not proof of exit. Inspect until a bounded caller deadline
	// confirms the exact container has exited before interpreting its output.
	for {
		after, err := r.InspectPackageHelper(ctx, spec)
		if err != nil {
			return nil, err
		}
		if after == nil || after.ID != view.ID || after.State == nil {
			return nil, ErrStateUnknown
		}
		if !after.State.Running && after.State.Status == "exited" {
			parsed, err := contracts.ParseJSON(bytes.NewReader(output.Bytes()), 64<<10)
			if err != nil {
				return nil, ErrStateUnknown
			}
			if after.State.ExitCode != 0 {
				if fields, ok := parsed.(map[string]any); ok {
					if code, ok := fields["errorCode"].(string); ok {
						switch code {
						case "PI_PACKAGE_INVALID_SOURCE", "PI_PACKAGE_INVALID_MANIFEST", "PI_PACKAGE_UNSAFE_ARCHIVE", "PI_PACKAGE_LIMIT_EXCEEDED", "PI_PACKAGE_UNSUPPORTED_MEDIA_TYPE", "PI_PACKAGE_SDK_VERSION_UNSUPPORTED", "PI_PACKAGE_SOURCE_FETCH_FAILED", "PI_PACKAGE_DEPENDENCY_INSTALL_FAILED", "PI_PACKAGE_CANDIDATE_CONFLICT":
							return nil, &pipackage.InputError{Code: code}
						}
					}
				}
				return nil, ErrStateUnknown
			}
			return json.RawMessage(bytes.TrimSpace(output.Bytes())), nil
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(20 * time.Millisecond):
		}
	}
}

func (r *Runtime) RemovePackageHelper(ctx context.Context, spec PackageHelperSpec) error {
	// A cancelled start may still be reaching the Engine. The helper can move
	// from created to running between inspect and remove; re-inspect that exact
	// labelled identity on conflict instead of leaving a permanent cleanup job.
	for attempt := 0; attempt < 4; attempt++ {
		view, err := r.InspectPackageHelper(ctx, spec)
		if err == nil && view == nil {
			if _, uncertain := r.packageUncertain.Load(r.PackageHelperName(spec)); uncertain {
				return ErrStateUnknown
			}
			return nil
		}
		if err != nil {
			return err
		}
		if view.State == nil {
			return ErrStateUnknown
		}
		if view.State.Running {
			seconds := 3
			if _, err := r.engine.api.ContainerStop(ctx, view.ID, client.ContainerStopOptions{Timeout: &seconds}); err != nil && !errdefs.IsNotFound(err) && !errdefs.IsNotModified(err) {
				return runtimeError(err)
			}
			continue
		}
		if _, err := r.engine.api.ContainerRemove(ctx, view.ID, client.ContainerRemoveOptions{}); err != nil && !errdefs.IsNotFound(err) {
			if errdefs.IsConflict(err) || errdefs.IsNotModified(err) {
				select {
				case <-ctx.Done():
					return ctx.Err()
				case <-time.After(20 * time.Millisecond):
				}
				continue
			}
			return runtimeError(err)
		}
		after, err := r.InspectPackageHelper(ctx, spec)
		if err != nil {
			return err
		}
		if after == nil {
			return nil
		}
	}
	return ErrStateUnknown
}

func (r *Runtime) RemovePackageResources(ctx context.Context, id PackageIdentity) error {
	resources := r.packageResources(id)
	if exists, err := r.inspectPackageNetwork(ctx, id); err != nil {
		return err
	} else if exists {
		if _, err := r.engine.api.NetworkRemove(ctx, resources.NetworkName, client.NetworkRemoveOptions{}); err != nil && !errdefs.IsNotFound(err) {
			return runtimeError(err)
		}
		if exists, err := r.inspectPackageNetwork(ctx, id); err != nil {
			return err
		} else if exists {
			return ErrStateUnknown
		}
	}
	if _, uncertain := r.packageUncertain.Load(resources.NetworkName); uncertain {
		return ErrStateUnknown
	}
	if exists, err := r.inspectPackageVolume(ctx, id); err != nil {
		return err
	} else if exists {
		if _, err := r.engine.api.VolumeRemove(ctx, resources.VolumeName, client.VolumeRemoveOptions{}); err != nil && !errdefs.IsNotFound(err) {
			return runtimeError(err)
		}
		if exists, err := r.inspectPackageVolume(ctx, id); err != nil {
			return err
		} else if exists {
			return ErrStateUnknown
		}
	}
	if _, uncertain := r.packageUncertain.Load(resources.VolumeName); uncertain {
		return ErrStateUnknown
	}
	return nil
}

// ConfirmPackageAbsence is used before Core releases durable resource intents.
func (r *Runtime) ConfirmPackageAbsence(ctx context.Context, id PackageIdentity) error {
	if exists, err := r.inspectPackageNetwork(ctx, id); err != nil {
		return err
	} else if exists {
		return ErrStateUnknown
	}
	if exists, err := r.inspectPackageVolume(ctx, id); err != nil {
		return err
	} else if exists {
		return ErrStateUnknown
	}
	resources := r.packageResources(id)
	for _, name := range []string{resources.NetworkName, resources.VolumeName} {
		if _, uncertain := r.packageUncertain.Load(name); uncertain {
			return ErrStateUnknown
		}
	}
	return nil
}

func (r *Runtime) PackageHelperName(spec PackageHelperSpec) string {
	return resourceName("pkg-"+spec.Action, r.installationID, spec.WorkID, packageLogical(spec))
}

// Recovery uses the persisted creation plan even if the job's input directory
// is no longer present. It cannot delete a container merely because its name
// resembles a package helper.
func (r *Runtime) RemovePlannedPackageHelper(ctx context.Context, plan ResourcePlan) error {
	if plan.Kind != "package-helper" || plan.Labels[InstallationLabel] != r.installationID || plan.Labels[ManagedLabel] != "true" || plan.Labels[WorkLabel] != plan.WorkID || plan.Labels[KindLabel] != plan.Kind || plan.Labels[LogicalLabel] != plan.LogicalID || !imageIDPattern.MatchString(plan.Labels["piwork.package_image_id"]) {
		return ErrIdentity
	}
	action := plan.Labels["piwork.package_action"]
	switch action {
	case "init", "prepare", "capture", "source-capture", "measure", "environment":
	default:
		return ErrIdentity
	}
	if plan.Name != resourceName("pkg-"+action, r.installationID, plan.WorkID, plan.LogicalID) {
		return ErrIdentity
	}
	inspect := func() (*container.InspectResponse, error) {
		view, err := r.engine.api.ContainerInspect(ctx, plan.Name, client.ContainerInspectOptions{})
		if errdefs.IsNotFound(err) {
			if _, uncertain := r.packageUncertain.Load(plan.Name); uncertain {
				return nil, ErrStateUnknown
			}
			return nil, nil
		}
		if err != nil {
			return nil, runtimeError(err)
		}
		if view.Container.Config == nil || view.Container.Image != plan.Labels["piwork.package_image_id"] {
			return nil, ErrIdentity
		}
		if err := checkLabels(view.Container.Config.Labels, plan.Labels); err != nil {
			return nil, err
		}
		if err := r.settlePackageCreation(ctx, plan); err != nil {
			return nil, err
		}
		return &view.Container, nil
	}
	view, err := inspect()
	if err != nil || view == nil {
		return err
	}
	if view.State == nil {
		return ErrStateUnknown
	}
	if view.State.Running {
		seconds := 3
		if _, err := r.engine.api.ContainerStop(ctx, view.ID, client.ContainerStopOptions{Timeout: &seconds}); err != nil {
			return runtimeError(err)
		}
		view, err = inspect()
		if err != nil {
			return err
		}
		if view == nil {
			return nil
		}
		if view.State == nil || view.State.Running {
			return ErrStateUnknown
		}
	}
	if _, err := r.engine.api.ContainerRemove(ctx, view.ID, client.ContainerRemoveOptions{}); err != nil && !errdefs.IsNotFound(err) {
		return runtimeError(err)
	}
	view, err = inspect()
	if err != nil {
		return err
	}
	if view != nil {
		return ErrStateUnknown
	}
	return nil
}
