package dockerengine

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"

	"github.com/containerd/errdefs"
	"github.com/moby/moby/api/types/container"
	"github.com/moby/moby/api/types/mount"
	"github.com/moby/moby/api/types/network"
	"github.com/moby/moby/api/types/volume"
	"github.com/moby/moby/client"
	"piwork/internal/contracts"
)

const InstallationLabel = "piwork.installation_id"
const ManagedLabel = "piwork.managed"
const WorkLabel = "piwork.work_id"
const KindLabel = "piwork.resource_kind"
const LogicalLabel = "piwork.logical_id"
const SpecLabel = "piwork.spec_hash"

var ErrIdentity = errors.New("Docker resource identity does not match")
var ErrSpecification = errors.New("Docker resource specification is invalid")
var ErrSpecificationConflict = errors.New("Docker resource immutable specification conflicts")
var ErrStateUnknown = errors.New("Docker resource state is unconfirmed")
var ErrResourceMissing = errors.New("Docker resource is missing")
var ErrResourceRunning = errors.New("Docker container is still running")
var ErrResourceRemovalUnconfirmed = errors.New("Docker resource removal has not been confirmed")
var ErrUnregistered = errors.New("Docker creation requires a durable resource intent")
var identityPattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$`)
var imageIDPattern = regexp.MustCompile(`^sha256:[a-f0-9]{64}$`)
var displayNamePattern = regexp.MustCompile(`^w-[a-f0-9]{8,61}_[a-z][a-z0-9-]{0,47}$`)
var fileHelperNamePattern = regexp.MustCompile(`^piwork-file-[a-f0-9]{32}$`)
var numericUser = regexp.MustCompile(`^[0-9]+(?::[0-9]+)?$`)

type ResourcePlan struct {
	WorkID, Kind, LogicalID, Name, SpecHash string
	Labels                                  map[string]string
}
type IntentRecorder func(context.Context, ResourcePlan) error
type Runtime struct {
	engine            *Engine
	installationID    string
	recordIntent      IntentRecorder
	allowedBindRoots  []string
	mu                sync.Mutex
	uncertainNetworks map[string]bool
	packageUncertain  sync.Map
	packageSettler    IntentRecorder
}

func NewRuntime(engine *Engine, installationID string, record IntentRecorder, bindRoots []string) (*Runtime, error) {
	if engine == nil || !identityPattern.MatchString(installationID) {
		return nil, ErrIdentity
	}
	return &Runtime{engine: engine, installationID: installationID, recordIntent: record, allowedBindRoots: append([]string(nil), bindRoots...), uncertainNetworks: make(map[string]bool)}, nil
}
func (r *Runtime) baseLabels(workID string) (map[string]string, error) {
	if !identityPattern.MatchString(workID) {
		return nil, ErrIdentity
	}
	return map[string]string{InstallationLabel: r.installationID, ManagedLabel: "true", WorkLabel: workID}, nil
}
func checkLabels(actual, expected map[string]string) error {
	for key, value := range expected {
		if actual[key] != value {
			return ErrIdentity
		}
	}
	return nil
}
func filtersFor(labels map[string]string) client.Filters {
	filters := make(client.Filters)
	for key, value := range labels {
		filters = filters.Add("label", key+"="+value)
	}
	return filters
}
func resourceName(kind, installation, work, logical string) string {
	sum := sha256.Sum256([]byte(installation + "\x00" + work + "\x00" + kind + "\x00" + logical))
	return "piwork-" + kind + "-" + hex.EncodeToString(sum[:8])
}

// ManagedVolumeName returns the exact Docker name used by EnsureVolume, so
// Core can register a durable volume reference before the Engine call.
func ManagedVolumeName(installation, work, logical string) string {
	return resourceName("vol", installation, work, logical)
}
func runtimeError(err error) error {
	if err == nil {
		return nil
	}
	if errdefs.IsNotFound(err) {
		return ErrResourceMissing
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return ErrStateUnknown
	}
	if errdefs.IsConflict(err) {
		return ErrSpecificationConflict
	}
	if errdefs.IsInvalidArgument(err) {
		return ErrSpecification
	}
	return ErrUnavailable
}
func (r *Runtime) register(ctx context.Context, plan ResourcePlan) error {
	if r.recordIntent == nil {
		return ErrUnregistered
	}
	return r.recordIntent(ctx, plan)
}

type ContainerIdentity struct {
	WorkID, Kind, LogicalID string
	Labels                  map[string]string
}
type ContainerMount struct {
	Type, Source, Target string
	ReadOnly             bool
	// Agent data volumes copy ownership of the empty image directory on their
	// first mount. Other volumes are always mounted without image copy-up.
	CopyImageData bool
}
type ContainerNetwork struct {
	Name, WorkID string
	Aliases      []string
}
type ContainerSpec struct {
	Identity               ContainerIdentity
	Image, DisplayName     string
	Command, Entrypoint    []string
	Environment            map[string]string
	CPUMillis, MemoryBytes int64
	User, WorkingDirectory string
	ControlHost            string
	Network                *ContainerNetwork
	Mounts                 []ContainerMount
	Stdin                  bool
}
type EnsuredContainer struct {
	ID, Name, SpecHash string
	Created            bool
}

func (r *Runtime) containerLabels(identity ContainerIdentity) (map[string]string, error) {
	labels, err := r.baseLabels(identity.WorkID)
	if err != nil {
		return nil, err
	}
	if !identityPattern.MatchString(identity.LogicalID) {
		return nil, ErrIdentity
	}
	switch identity.Kind {
	case "agent", "service", "file-helper", "snapshot-helper", "package-helper":
	default:
		return nil, ErrIdentity
	}
	labels[KindLabel] = identity.Kind
	labels[LogicalLabel] = identity.LogicalID
	for key, value := range identity.Labels {
		if _, reserved := labels[key]; reserved || key == SpecLabel {
			return nil, ErrIdentity
		}
		if key == "" || strings.ContainsAny(key, "\x00\r\n=") || strings.ContainsRune(value, 0) {
			return nil, ErrIdentity
		}
		labels[key] = value
	}
	return labels, nil
}
func (r *Runtime) findContainer(ctx context.Context, identity ContainerIdentity) (*container.InspectResponse, error) {
	labels, err := r.containerLabels(identity)
	if err != nil {
		return nil, err
	}
	// Filter the complete logical identity, then inspect all additional fencing
	// labels rather than hiding a wrong generation behind an overly strict list.
	base := map[string]string{InstallationLabel: r.installationID, ManagedLabel: "true", WorkLabel: identity.WorkID, KindLabel: identity.Kind, LogicalLabel: identity.LogicalID}
	list, err := r.engine.api.ContainerList(ctx, client.ContainerListOptions{All: true, Filters: filtersFor(base)})
	if err != nil {
		return nil, runtimeError(err)
	}
	if len(list.Items) > 1 {
		return nil, ErrStateUnknown
	}
	if len(list.Items) == 0 {
		return nil, nil
	}
	view, err := r.engine.api.ContainerInspect(ctx, list.Items[0].ID, client.ContainerInspectOptions{})
	if err != nil {
		return nil, runtimeError(err)
	}
	if view.Container.Config == nil {
		return nil, ErrIdentity
	}
	if err := checkLabels(view.Container.Config.Labels, labels); err != nil {
		return nil, err
	}
	return &view.Container, nil
}
func (r *Runtime) InspectContainer(ctx context.Context, identity ContainerIdentity) (*container.InspectResponse, error) {
	return r.findContainer(ctx, identity)
}

// Only for a previously confirmed create. Missing labels cannot hide an old
// instance: both its immutable ID and its registered name must be absent.
func (r *Runtime) ConfirmContainerAbsent(ctx context.Context, id, name string) error {
	if id == "" || name == "" {
		return ErrStateUnknown
	}
	for _, reference := range []string{id, name} {
		_, err := r.engine.api.ContainerInspect(ctx, reference, client.ContainerInspectOptions{})
		if errdefs.IsNotFound(err) {
			continue
		}
		if err != nil {
			return runtimeError(err)
		}
		return ErrIdentity
	}
	return nil
}
func (r *Runtime) ListContainers(ctx context.Context, kind string) ([]container.InspectResponse, error) {
	labels := map[string]string{InstallationLabel: r.installationID, ManagedLabel: "true"}
	if kind != "" {
		labels[KindLabel] = kind
	}
	list, err := r.engine.api.ContainerList(ctx, client.ContainerListOptions{All: true, Filters: filtersFor(labels)})
	if err != nil {
		return nil, runtimeError(err)
	}
	out := []container.InspectResponse{}
	for _, item := range list.Items {
		view, err := r.engine.api.ContainerInspect(ctx, item.ID, client.ContainerInspectOptions{})
		if err != nil {
			return nil, runtimeError(err)
		}
		if view.Container.Config == nil {
			return nil, ErrIdentity
		}
		if err := checkLabels(view.Container.Config.Labels, labels); err != nil {
			return nil, err
		}
		out = append(out, view.Container)
	}
	return out, nil
}
func normalizeContainer(spec ContainerSpec) (ContainerSpec, error) {
	if spec.CPUMillis == 0 {
		spec.CPUMillis = 100
	}
	if spec.MemoryBytes == 0 && spec.Identity.Kind != "service" {
		spec.MemoryBytes = 64 << 20
	}
	if spec.User == "" {
		spec.User = "65532:65532"
	}
	if spec.CPUMillis < 10 || spec.CPUMillis > 128000 || (spec.MemoryBytes < 16<<20 && !(spec.Identity.Kind == "service" && spec.MemoryBytes == 0)) || spec.MemoryBytes > contracts.MaxSafeInteger || !numericUser.MatchString(spec.User) {
		return spec, ErrSpecification
	}
	if spec.Identity.Kind == "service" {
		spec.MemoryBytes = 0
	}
	uid, err := strconv.ParseUint(strings.Split(spec.User, ":")[0], 10, 32)
	if err != nil || uid == 0 {
		return spec, ErrSpecification
	}
	if !imageIDPattern.MatchString(spec.Image) {
		return spec, ErrSpecification
	}
	if spec.Entrypoint != nil && len(spec.Entrypoint) == 0 {
		return spec, ErrSpecification
	}
	if spec.DisplayName != "" {
		valid := spec.Identity.Kind == "service" && displayNamePattern.MatchString(spec.DisplayName) || spec.Identity.Kind == "file-helper" && fileHelperNamePattern.MatchString(spec.DisplayName)
		if !valid || len(spec.DisplayName) > 128 {
			return spec, ErrSpecification
		}
	}
	if spec.WorkingDirectory != "" && (!filepath.IsAbs(spec.WorkingDirectory) || filepath.Clean(spec.WorkingDirectory) != spec.WorkingDirectory) {
		return spec, ErrSpecification
	}
	if spec.ControlHost != "" && (spec.Identity.Kind != "agent" || !identityPattern.MatchString(spec.ControlHost)) {
		return spec, ErrSpecification
	}
	if spec.Network != nil {
		copy := *spec.Network
		copy.Aliases = append([]string(nil), spec.Network.Aliases...)
		sort.Strings(copy.Aliases)
		spec.Network = &copy
		for _, alias := range copy.Aliases {
			if !identityPattern.MatchString(alias) {
				return spec, ErrSpecification
			}
		}
	}
	for key, value := range spec.Environment {
		if key == "" || strings.ContainsAny(key, "=\x00") || strings.ContainsRune(value, 0) {
			return spec, ErrSpecification
		}
	}
	return spec, nil
}
func containerSpecHash(spec ContainerSpec) (string, error) {
	spec.DisplayName = ""
	bytes, err := json.Marshal(spec)
	if err != nil {
		return "", ErrSpecification
	}
	parsed, err := contracts.ParseJSON(strings.NewReader(string(bytes)), 4<<20)
	if err != nil {
		return "", ErrSpecification
	}
	return contracts.PrivateDigest("docker/container/v1", parsed)
}
func (r *Runtime) validateMounts(ctx context.Context, spec ContainerSpec) error {
	seen := make(map[string]bool)
	for _, item := range spec.Mounts {
		if !filepath.IsAbs(item.Target) || filepath.Clean(item.Target) != item.Target || item.Target == "/" || seen[item.Target] || strings.ContainsRune(item.Target, 0) {
			return ErrSpecification
		}
		seen[item.Target] = true
		switch item.Type {
		case "volume":
			if item.Source == "" {
				return ErrSpecification
			}
			if item.CopyImageData && (spec.Identity.Kind != "agent" || item.ReadOnly || item.Target != "/var/data" && item.Target != "/var/data/workspace") {
				return ErrSpecification
			}
			view, err := r.engine.api.VolumeInspect(ctx, item.Source, client.VolumeInspectOptions{})
			if err != nil {
				return runtimeError(err)
			}
			labels, err := r.baseLabels(spec.Identity.WorkID)
			if err != nil {
				return err
			}
			labels["piwork.volume_kind"] = "managed-data"
			if err := checkLabels(view.Volume.Labels, labels); err != nil {
				return err
			}
		case "bind":
			if item.CopyImageData {
				return ErrSpecification
			}
			if item.Source == "" {
				return ErrSpecification
			}
			source, err := filepath.EvalSymlinks(item.Source)
			if err != nil {
				return ErrSpecification
			}
			info, err := os.Stat(source)
			if err != nil || info.Mode()&os.ModeSocket != 0 {
				return ErrSpecification
			}
			allowed := false
			for _, root := range r.allowedBindRoots {
				base, err := filepath.EvalSymlinks(root)
				if err != nil {
					return ErrSpecification
				}
				relative, err := filepath.Rel(base, source)
				if err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)) && !filepath.IsAbs(relative) {
					allowed = true
					break
				}
			}
			if !allowed {
				return ErrSpecification
			}
		case "tmpfs":
			if item.Source != "" || item.CopyImageData {
				return ErrSpecification
			}
		default:
			return ErrSpecification
		}
	}
	return nil
}
func (r *Runtime) EnsureContainer(ctx context.Context, input ContainerSpec) (EnsuredContainer, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	spec, err := normalizeContainer(input)
	if err != nil {
		return EnsuredContainer{}, err
	}
	labels, err := r.containerLabels(spec.Identity)
	if err != nil {
		return EnsuredContainer{}, err
	}
	hash, err := containerSpecHash(spec)
	if err != nil {
		return EnsuredContainer{}, err
	}
	labels[SpecLabel] = hash
	if spec.Network != nil {
		if spec.Network.WorkID != spec.Identity.WorkID {
			return EnsuredContainer{}, ErrIdentity
		}
		if _, err := r.inspectNetwork(ctx, spec.Network.Name, spec.Identity.WorkID); err != nil {
			return EnsuredContainer{}, err
		}
	}
	if err := r.validateMounts(ctx, spec); err != nil {
		return EnsuredContainer{}, err
	}
	adopt := func(view *container.InspectResponse) (EnsuredContainer, error) {
		if view.Config == nil || view.Config.Labels[SpecLabel] != hash {
			return EnsuredContainer{}, ErrSpecificationConflict
		}
		return EnsuredContainer{ID: view.ID, Name: strings.TrimPrefix(view.Name, "/"), SpecHash: hash}, nil
	}
	existing, err := r.findContainer(ctx, spec.Identity)
	if err != nil {
		return EnsuredContainer{}, err
	}
	if existing != nil {
		return adopt(existing)
	}
	name := spec.DisplayName
	if name == "" {
		name = resourceName(spec.Identity.Kind, r.installationID, spec.Identity.WorkID, spec.Identity.LogicalID)
	}
	if err := r.register(ctx, ResourcePlan{WorkID: spec.Identity.WorkID, Kind: spec.Identity.Kind, LogicalID: spec.Identity.LogicalID, Name: name, SpecHash: hash, Labels: labels}); err != nil {
		return EnsuredContainer{}, err
	}
	pids := int64(512)
	if spec.Identity.Kind == "file-helper" {
		pids = 32
	}
	host := &container.HostConfig{Resources: container.Resources{NanoCPUs: spec.CPUMillis * 1000000, Memory: spec.MemoryBytes, PidsLimit: &pids}, ReadonlyRootfs: true, CapDrop: []string{"ALL"}, SecurityOpt: []string{"no-new-privileges:true"}, RestartPolicy: container.RestartPolicy{Name: container.RestartPolicyDisabled}, NetworkMode: container.NetworkMode("none")}
	if spec.Identity.Kind == "file-helper" {
		host.Tmpfs = map[string]string{"/tmp": "rw,noexec,nosuid,nodev,size=16m,mode=1777"}
	}
	for _, item := range spec.Mounts {
		value := mount.Mount{Type: mount.Type(item.Type), Source: item.Source, Target: item.Target, ReadOnly: item.ReadOnly}
		if item.Type == "volume" {
			value.VolumeOptions = &mount.VolumeOptions{NoCopy: !item.CopyImageData}
		}
		host.Mounts = append(host.Mounts, value)
	}
	if spec.ControlHost != "" {
		host.ExtraHosts = []string{spec.ControlHost + ":host-gateway"}
	}
	config := &container.Config{Image: spec.Image, Cmd: spec.Command, User: spec.User, WorkingDir: spec.WorkingDirectory, Labels: labels, OpenStdin: spec.Stdin, StdinOnce: spec.Stdin, AttachStdin: spec.Stdin, AttachStdout: spec.Stdin, AttachStderr: spec.Stdin}
	if spec.Entrypoint != nil {
		config.Entrypoint = spec.Entrypoint
	}
	keys := make([]string, 0, len(spec.Environment))
	for key := range spec.Environment {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		config.Env = append(config.Env, key+"="+spec.Environment[key])
	}
	var networking *network.NetworkingConfig
	if spec.Network != nil {
		host.NetworkMode = container.NetworkMode(spec.Network.Name)
		networking = &network.NetworkingConfig{EndpointsConfig: map[string]*network.EndpointSettings{spec.Network.Name: {Aliases: spec.Network.Aliases}}}
	}
	result, err := r.engine.api.ContainerCreate(ctx, client.ContainerCreateOptions{Config: config, HostConfig: host, NetworkingConfig: networking, Name: name})
	if err != nil {
		if errdefs.IsConflict(err) {
			view, lookupErr := r.findContainer(ctx, spec.Identity)
			if lookupErr == nil && view != nil {
				return adopt(view)
			}
			return EnsuredContainer{}, ErrSpecificationConflict
		}
		return EnsuredContainer{}, runtimeError(err)
	}
	view, err := r.engine.api.ContainerInspect(ctx, result.ID, client.ContainerInspectOptions{})
	if err != nil {
		return EnsuredContainer{}, runtimeError(err)
	}
	if view.Container.Config == nil {
		return EnsuredContainer{}, ErrIdentity
	}
	if err := checkLabels(view.Container.Config.Labels, labels); err != nil {
		return EnsuredContainer{}, err
	}
	return EnsuredContainer{ID: result.ID, Name: name, SpecHash: hash, Created: true}, nil
}
func (r *Runtime) StartContainer(ctx context.Context, identity ContainerIdentity) (*container.InspectResponse, error) {
	view, err := r.findContainer(ctx, identity)
	if err != nil {
		return nil, err
	}
	if view == nil {
		return nil, ErrResourceMissing
	}
	if view.State == nil {
		return nil, ErrStateUnknown
	}
	if !view.State.Running {
		if _, err := r.engine.api.ContainerStart(ctx, view.ID, client.ContainerStartOptions{}); err != nil {
			return nil, runtimeError(err)
		}
	}
	return r.findContainer(ctx, identity)
}
func (r *Runtime) StopContainer(ctx context.Context, identity ContainerIdentity, seconds int) (*container.InspectResponse, error) {
	if seconds < 0 || seconds > 30 {
		return nil, ErrSpecification
	}
	view, err := r.findContainer(ctx, identity)
	if err != nil || view == nil {
		return view, err
	}
	if view.State == nil {
		return nil, ErrStateUnknown
	}
	if view.State.Running {
		if _, err := r.engine.api.ContainerStop(ctx, view.ID, client.ContainerStopOptions{Timeout: &seconds}); err != nil {
			return nil, runtimeError(err)
		}
	}
	return r.findContainer(ctx, identity)
}
func (r *Runtime) KillContainer(ctx context.Context, identity ContainerIdentity) error {
	view, err := r.findContainer(ctx, identity)
	if err != nil || view == nil {
		return err
	}
	if view.State == nil {
		return ErrStateUnknown
	}
	if !view.State.Running {
		return nil
	}
	_, err = r.engine.api.ContainerKill(ctx, view.ID, client.ContainerKillOptions{Signal: "SIGKILL"})
	return runtimeError(err)
}
func (r *Runtime) RemoveContainer(ctx context.Context, identity ContainerIdentity) error {
	view, err := r.findContainer(ctx, identity)
	if err != nil || view == nil {
		return err
	}
	if view.State == nil {
		return ErrStateUnknown
	}
	if view.State.Running {
		return ErrResourceRunning
	}
	_, err = r.engine.api.ContainerRemove(ctx, view.ID, client.ContainerRemoveOptions{})
	if errdefs.IsNotFound(err) {
		return nil
	}
	return runtimeError(err)
}

func (r *Runtime) networkLabels(workID string) (map[string]string, error) {
	labels, err := r.baseLabels(workID)
	if err == nil {
		labels["piwork.network_kind"] = "work-private"
	}
	return labels, err
}
func (r *Runtime) inspectNetwork(ctx context.Context, id, workID string) (network.Inspect, error) {
	view, err := r.engine.api.NetworkInspect(ctx, id, client.NetworkInspectOptions{})
	if err != nil {
		return network.Inspect{}, runtimeError(err)
	}
	labels, err := r.networkLabels(workID)
	if err != nil {
		return network.Inspect{}, err
	}
	if err := checkLabels(view.Network.Labels, labels); err != nil {
		return network.Inspect{}, err
	}
	if view.Network.Driver != "bridge" {
		return network.Inspect{}, ErrSpecificationConflict
	}
	return view.Network, nil
}
func (r *Runtime) InspectNetwork(ctx context.Context, id, workID string) (network.Inspect, error) {
	return r.inspectNetwork(ctx, id, workID)
}

func (r *Runtime) ListNetworks(ctx context.Context) ([]network.Inspect, error) {
	labels := map[string]string{InstallationLabel: r.installationID, ManagedLabel: "true", "piwork.network_kind": "work-private"}
	list, err := r.engine.api.NetworkList(ctx, client.NetworkListOptions{Filters: filtersFor(labels)})
	if err != nil {
		return nil, runtimeError(err)
	}
	out := []network.Inspect{}
	for _, item := range list.Items {
		view, err := r.inspectNetwork(ctx, item.ID, item.Labels[WorkLabel])
		if err != nil {
			return nil, err
		}
		out = append(out, view)
	}
	return out, nil
}
func (r *Runtime) EnsureNetwork(ctx context.Context, workID string) (network.Inspect, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	labels, err := r.networkLabels(workID)
	if err != nil {
		return network.Inspect{}, err
	}
	list, err := r.engine.api.NetworkList(ctx, client.NetworkListOptions{Filters: filtersFor(labels)})
	if err != nil {
		return network.Inspect{}, runtimeError(err)
	}
	if len(list.Items) > 1 {
		return network.Inspect{}, ErrStateUnknown
	}
	if len(list.Items) == 1 {
		return r.inspectNetwork(ctx, list.Items[0].ID, workID)
	}
	if r.uncertainNetworks[workID] {
		return network.Inspect{}, ErrStateUnknown
	}
	name := resourceName("net", r.installationID, workID, "network")
	// Docker network names are not a sufficient ownership claim.
	matches, err := r.engine.api.NetworkList(ctx, client.NetworkListOptions{Filters: make(client.Filters).Add("name", name)})
	if err != nil {
		return network.Inspect{}, runtimeError(err)
	}
	for _, item := range matches.Items {
		if item.Name == name {
			return network.Inspect{}, ErrIdentity
		}
	}
	if err := r.register(ctx, ResourcePlan{WorkID: workID, Kind: "network", LogicalID: workID, Name: name, Labels: labels}); err != nil {
		return network.Inspect{}, err
	}
	result, err := r.engine.api.NetworkCreate(ctx, name, client.NetworkCreateOptions{Driver: "bridge", Labels: labels})
	if err != nil {
		if !errdefs.IsInvalidArgument(err) && !errdefs.IsConflict(err) {
			r.uncertainNetworks[workID] = true
		}
		return network.Inspect{}, runtimeError(err)
	}
	return r.inspectNetwork(ctx, result.ID, workID)
}
func (r *Runtime) RemoveNetwork(ctx context.Context, id, workID string) error {
	if _, err := r.inspectNetwork(ctx, id, workID); errors.Is(err, ErrResourceMissing) {
		return nil
	} else if err != nil {
		return err
	}
	_, err := r.engine.api.NetworkRemove(ctx, id, client.NetworkRemoveOptions{})
	if errdefs.IsNotFound(err) {
		return nil
	}
	return runtimeError(err)
}
func (r *Runtime) volumeLabels(workID, logical string) (map[string]string, error) {
	labels, err := r.baseLabels(workID)
	if err != nil {
		return nil, err
	}
	if !identityPattern.MatchString(logical) {
		return nil, ErrIdentity
	}
	labels[LogicalLabel] = logical
	labels["piwork.volume_kind"] = "managed-data"
	return labels, nil
}
func (r *Runtime) inspectVolume(ctx context.Context, name, workID, logical string) (volume.Volume, error) {
	view, err := r.engine.api.VolumeInspect(ctx, name, client.VolumeInspectOptions{})
	if err != nil {
		return volume.Volume{}, runtimeError(err)
	}
	labels, err := r.volumeLabels(workID, logical)
	if err != nil {
		return volume.Volume{}, err
	}
	if err := checkLabels(view.Volume.Labels, labels); err != nil {
		return volume.Volume{}, err
	}
	if view.Volume.Driver != "local" {
		return volume.Volume{}, ErrSpecificationConflict
	}
	return view.Volume, nil
}
func (r *Runtime) InspectVolume(ctx context.Context, name, workID, logical string) (volume.Volume, error) {
	return r.inspectVolume(ctx, name, workID, logical)
}

func (r *Runtime) ListVolumes(ctx context.Context) ([]volume.Volume, error) {
	labels := map[string]string{InstallationLabel: r.installationID, ManagedLabel: "true", "piwork.volume_kind": "managed-data"}
	list, err := r.engine.api.VolumeList(ctx, client.VolumeListOptions{Filters: filtersFor(labels)})
	if err != nil {
		return nil, runtimeError(err)
	}
	out := []volume.Volume{}
	for _, item := range list.Items {
		view, err := r.inspectVolume(ctx, item.Name, item.Labels[WorkLabel], item.Labels[LogicalLabel])
		if err != nil {
			return nil, err
		}
		out = append(out, view)
	}
	return out, nil
}
func (r *Runtime) EnsureVolume(ctx context.Context, workID, logical string) (volume.Volume, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	labels, err := r.volumeLabels(workID, logical)
	if err != nil {
		return volume.Volume{}, err
	}
	list, err := r.engine.api.VolumeList(ctx, client.VolumeListOptions{Filters: filtersFor(labels)})
	if err != nil {
		return volume.Volume{}, runtimeError(err)
	}
	if len(list.Items) > 1 {
		return volume.Volume{}, ErrStateUnknown
	}
	if len(list.Items) == 1 {
		return r.inspectVolume(ctx, list.Items[0].Name, workID, logical)
	}
	name := resourceName("vol", r.installationID, workID, logical)
	view, err := r.engine.api.VolumeInspect(ctx, name, client.VolumeInspectOptions{})
	if err == nil {
		if err := checkLabels(view.Volume.Labels, labels); err != nil {
			return volume.Volume{}, err
		}
		return r.inspectVolume(ctx, name, workID, logical)
	}
	if !errdefs.IsNotFound(err) {
		return volume.Volume{}, runtimeError(err)
	}
	if err := r.register(ctx, ResourcePlan{WorkID: workID, Kind: "volume", LogicalID: logical, Name: name, Labels: labels}); err != nil {
		return volume.Volume{}, err
	}
	result, err := r.engine.api.VolumeCreate(ctx, client.VolumeCreateOptions{Name: name, Driver: "local", Labels: labels})
	if err != nil {
		return volume.Volume{}, runtimeError(err)
	}
	if err := checkLabels(result.Volume.Labels, labels); err != nil {
		return volume.Volume{}, err
	}
	return result.Volume, nil
}
func (r *Runtime) RemoveVolume(ctx context.Context, name, workID, logical string) error {
	if _, err := r.inspectVolume(ctx, name, workID, logical); errors.Is(err, ErrResourceMissing) {
		return nil
	} else if err != nil {
		return err
	}
	_, err := r.engine.api.VolumeRemove(ctx, name, client.VolumeRemoveOptions{})
	if err != nil && !errdefs.IsNotFound(err) {
		return runtimeError(err)
	}
	if _, err := r.inspectVolume(ctx, name, workID, logical); errors.Is(err, ErrResourceMissing) {
		return nil
	} else if err != nil {
		return err
	}
	return ErrResourceRemovalUnconfirmed
}
