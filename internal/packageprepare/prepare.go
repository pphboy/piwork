// Package packageprepare coordinates native helpers. The Core remains the
// publisher and owns every durable job, resource intent and artifact lease.
package packageprepare

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"time"

	"golang.org/x/sys/unix"
	"piwork/internal/contracts"
	"piwork/internal/dockerengine"
	"piwork/internal/packagehelper"
	"piwork/internal/pipackage"
)

var ErrResult = errors.New("package helper result is invalid")
var ErrCleanup = errors.New("package resource cleanup is unconfirmed")

type CleanupError struct{ Primary error }

func (e *CleanupError) Error() string   { return ErrCleanup.Error() }
func (e *CleanupError) Unwrap() []error { return []error{ErrCleanup, e.Primary} }

type Runtime interface {
	EnsurePackageResources(context.Context, dockerengine.PackageIdentity) (dockerengine.PackageResources, error)
	EnsurePackageHelper(context.Context, dockerengine.PackageHelperSpec) (string, error)
	RunPackageHelper(context.Context, dockerengine.PackageHelperSpec) (json.RawMessage, error)
	RemovePackageHelper(context.Context, dockerengine.PackageHelperSpec) error
	RemovePackageResources(context.Context, dockerengine.PackageIdentity) error
}

type Input struct {
	Runtime                                                         Runtime
	Identity                                                        dockerengine.PackageIdentity
	Epoch                                                           int64
	PrepareImageID, TrustedImageID, SourceDirectory, SpoolDirectory string
	Environment                                                     contracts.PiPackagePreparedEnvironment
	BrainSourceVolume, ExpectedSourceDigest                         string
	// Called before creation and after confirmed absence respectively. These
	// callbacks must commit the job phase and release its resource intent.
	OnPlanned          func(context.Context, dockerengine.PackageHelperSpec) error
	OnRemoved          func(context.Context, dockerengine.PackageHelperSpec) error
	OnResourcesRemoved func(context.Context) error
	// Test injection only; production uses the documented two second interval.
	monitorInterval time.Duration
}

type Result struct {
	Artifact  pipackage.Artifact
	ZipPath   string
	ZipBytes  int64
	ZipSHA256 string
}

func decodeResult(raw []byte, target any) error {
	if _, err := contracts.ParseJSON(bytes.NewReader(raw), 64<<10); err != nil {
		return ErrResult
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return ErrResult
	}
	return nil
}

// Prepare never invokes a host executable. Cancellation only interrupts the
// transport; cleanup separately confirms that every helper has really exited.
func Prepare(ctx context.Context, input Input) (result Result, returned error) {
	if input.Runtime == nil || input.Epoch < 1 || input.OnPlanned == nil || input.OnRemoved == nil || input.OnResourcesRemoved == nil {
		return result, ErrResult
	}
	if _, err := input.Runtime.EnsurePackageResources(ctx, input.Identity); err != nil {
		// Resources may have been created despite a lost reply. Run the same
		// conservative cleanup as for later failures.
		cleanup, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if cleanupErr := input.Runtime.RemovePackageResources(cleanup, input.Identity); cleanupErr != nil {
			return result, &CleanupError{err}
		}
		if cleanupErr := input.OnResourcesRemoved(cleanup); cleanupErr != nil {
			return result, &CleanupError{err}
		}
		return result, err
	}
	live := map[string]dockerengine.PackageHelperSpec{}
	defer func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		failed := false
		for _, spec := range live {
			if err := input.Runtime.RemovePackageHelper(cleanup, spec); err != nil {
				failed = true
				continue
			}
			if err := input.OnRemoved(cleanup, spec); err != nil {
				failed = true
			}
		}
		if !failed {
			if err := input.Runtime.RemovePackageResources(cleanup, input.Identity); err != nil {
				failed = true
			} else if err := input.OnResourcesRemoved(cleanup); err != nil {
				failed = true
			}
		}
		if failed {
			result = Result{}
			returned = &CleanupError{returned}
		}
	}()
	// execute itself is called concurrently by the monitor and prepare. The
	// monitor uses its own tracked helper, joined before any deferred cleanup.
	var measureLive *dockerengine.PackageHelperSpec
	execute := func(ctx context.Context, action, image string) (json.RawMessage, error) {
		spec := dockerengine.PackageHelperSpec{PackageIdentity: input.Identity, Epoch: input.Epoch, Action: action, ImageID: image}
		if action == "prepare" {
			spec.SourceDirectory = input.SourceDirectory
		}
		if action == "source-capture" {
			spec.SourceVolume = input.BrainSourceVolume
			spec.SpoolDirectory = input.SourceDirectory
		}
		if action == "capture" {
			spec.SpoolDirectory = input.SpoolDirectory
		}
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if err := input.OnPlanned(ctx, spec); err != nil {
			return nil, err
		}
		if action == "measure" {
			measureLive = &spec
		} else {
			live[action] = spec
		}
		if _, err := input.Runtime.EnsurePackageHelper(ctx, spec); err != nil {
			return nil, err
		}
		raw, err := input.Runtime.RunPackageHelper(ctx, spec)
		if err != nil {
			return nil, err
		}
		if err := input.Runtime.RemovePackageHelper(ctx, spec); err != nil {
			return nil, err
		}
		if err := input.OnRemoved(ctx, spec); err != nil {
			return nil, err
		}
		if action == "measure" {
			measureLive = nil
		} else {
			delete(live, action)
		}
		return raw, nil
	}
	defer func() {
		if measureLive != nil {
			live["measure"] = *measureLive
		}
	}()
	if input.BrainSourceVolume != "" {
		raw, err := execute(ctx, "source-capture", input.TrustedImageID)
		if err != nil {
			return result, err
		}
		var captured packagehelper.BrainSourceCapture
		if decodeResult(raw, &captured) != nil || captured.SourceDigest != input.ExpectedSourceDigest {
			return result, ErrResult
		}
		archive, err := pipackage.OpenArchive(ctx, filepath.Join(input.SourceDirectory, "input.zip"))
		if err != nil {
			return result, err
		}
		digest, err := archive.Digest()
		archive.Close()
		if err != nil || digest != input.ExpectedSourceDigest {
			return result, ErrResult
		}
	}
	if _, err := execute(ctx, "init", input.TrustedImageID); err != nil {
		return result, err
	}
	measure := func(ctx context.Context) error {
		request, cancel := context.WithTimeout(ctx, 30*time.Second)
		defer cancel()
		raw, err := execute(request, "measure", input.TrustedImageID)
		if err != nil {
			return err
		}
		var measured struct {
			Bytes contracts.Field[int64] `json:"bytes"`
		}
		if err := decodeResult(raw, &measured); err != nil {
			return err
		}
		if !measured.Bytes.Present || measured.Bytes.Null || measured.Bytes.Value < 0 || measured.Bytes.Value > contracts.MaxSafeInteger {
			return ErrResult
		}
		if measured.Bytes.Value > pipackage.PreparationBytes {
			return pipackage.ErrLimit
		}
		return nil
	}
	prepareCtx, cancelPrepare := context.WithCancel(ctx)
	defer cancelPrepare()
	monitorCtx, cancelMonitor := context.WithCancel(ctx)
	monitorDone := make(chan error, 1)
	interval := input.monitorInterval
	if interval <= 0 {
		interval = 2 * time.Second
	}
	go func() {
		for {
			if err := measure(monitorCtx); err != nil {
				if monitorCtx.Err() != nil {
					monitorDone <- nil
				} else {
					cancelPrepare()
					monitorDone <- err
				}
				return
			}
			select {
			case <-monitorCtx.Done():
				monitorDone <- nil
				return
			case <-time.After(interval):
			}
		}
	}()
	raw, prepareErr := execute(prepareCtx, "prepare", input.PrepareImageID)
	cancelMonitor()
	monitorErr := <-monitorDone
	// A space/validation failure takes precedence over the cancelled prepare.
	if monitorErr != nil {
		return result, monitorErr
	}
	if prepareErr != nil {
		return result, prepareErr
	}
	if measureLive != nil {
		// A monitor request cancelled at normal completion may leave a helper;
		// settle it before reusing its deterministic measurement identity.
		cleanup, cancel := context.WithTimeout(ctx, 10*time.Second)
		err := input.Runtime.RemovePackageHelper(cleanup, *measureLive)
		if err == nil {
			err = input.OnRemoved(cleanup, *measureLive)
		}
		cancel()
		if err != nil {
			return result, err
		}
		measureLive = nil
	}
	if err := measure(ctx); err != nil {
		return result, err
	}
	var prepared struct {
		Name           contracts.Field[string] `json:"name"`
		Version        contracts.Field[string] `json:"version"`
		SourceKind     contracts.Field[string] `json:"sourceKind"`
		ResolvedSource contracts.Field[string] `json:"resolvedSource"`
	}
	if err := decodeResult(raw, &prepared); err != nil {
		return result, err
	}
	if !prepared.Name.Present || prepared.Name.Null || !pipackage.ValidName(prepared.Name.Value) || !prepared.Version.Present || !prepared.SourceKind.Present || prepared.SourceKind.Null || !prepared.ResolvedSource.Present || prepared.ResolvedSource.Null || prepared.ResolvedSource.Value == "" {
		return result, ErrResult
	}
	switch prepared.SourceKind.Value {
	case "npm", "git", "local", "zip":
	default:
		return result, ErrResult
	}
	root, err := os.OpenRoot(input.SpoolDirectory)
	if err != nil {
		return result, err
	}
	defer root.Close()
	request, err := json.Marshal(map[string]any{"sourceKind": prepared.SourceKind.Value, "resolvedSource": prepared.ResolvedSource.Value, "preparedEnvironment": input.Environment})
	if err != nil {
		return result, ErrResult
	}
	f, err := root.OpenFile("request.json", os.O_CREATE|os.O_EXCL|os.O_WRONLY|unix.O_NOFOLLOW, 0600)
	if err != nil {
		return result, err
	}
	_, writeErr := f.Write(request)
	syncErr := f.Sync()
	closeErr := f.Close()
	if err := errors.Join(writeErr, syncErr, closeErr); err != nil {
		return result, err
	}
	raw, err = execute(ctx, "capture", input.TrustedImageID)
	if err != nil {
		return result, err
	}
	var captured packagehelper.Captured
	if err := decodeResult(raw, &captured); err != nil {
		return result, err
	}
	var version *string
	if !prepared.Version.Null {
		version = &prepared.Version.Value
	}
	expectedVersion, _ := json.Marshal(version)
	if string(captured.Metadata.Name) != prepared.Name.Value || !bytes.Equal(captured.Metadata.Version, expectedVersion) || string(captured.Metadata.SourceKind) != prepared.SourceKind.Value || captured.Metadata.ResolvedSource != prepared.ResolvedSource.Value {
		return result, ErrResult
	}
	return ValidateCapture(ctx, input.SpoolDirectory, input.Identity.JobID, input.Environment, captured)
}

// ValidateCapture performs static result recovery without running package code
// or trusting the helper's manifest, inventory or content checksum.
func ValidateCapture(ctx context.Context, spoolDirectory, validationID string, environment contracts.PiPackagePreparedEnvironment, captured packagehelper.Captured) (result Result, returned error) {
	if !regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$`).MatchString(validationID) {
		return result, ErrResult
	}
	root, err := os.OpenRoot(spoolDirectory)
	if err != nil {
		return result, err
	}
	defer root.Close()
	metadata, err := json.Marshal(captured.Metadata)
	if err != nil {
		return result, ErrResult
	}
	if _, err := contracts.Decode[contracts.PiPackageArtifactMetadata](bytes.NewReader(metadata), "PiPackageArtifactMetadataSchema", pipackage.ManifestBytes); err != nil {
		return result, ErrResult
	}
	if pipackage.AssertEnvironment(captured.Metadata.PreparedEnvironment, environment) != nil || captured.ZipBytes <= 0 || captured.ZipBytes > pipackage.CompressedBytes || !regexp.MustCompile(`^[a-f0-9]{64}$`).MatchString(captured.ZipSHA256) {
		return result, ErrResult
	}
	zip, err := root.OpenFile("artifact.zip", os.O_RDONLY|unix.O_NOFOLLOW|unix.O_NONBLOCK, 0)
	if err != nil {
		return result, err
	}
	defer zip.Close()
	info, err := zip.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() != captured.ZipBytes {
		return result, ErrResult
	}
	hash := sha256.New()
	n, err := io.CopyBuffer(hash, io.LimitReader(zip, pipackage.CompressedBytes+1), make([]byte, 32<<10))
	if err != nil {
		return result, err
	}
	if n != captured.ZipBytes || hex.EncodeToString(hash.Sum(nil)) != captured.ZipSHA256 {
		return result, ErrResult
	}
	// Reopen through the pinned file descriptor, never the helper's path text.
	zipPath := filepath.Join(spoolDirectory, "artifact.zip")
	validationName := "validation-" + validationID
	if _, err := root.Lstat(validationName); !errors.Is(err, os.ErrNotExist) {
		return result, ErrResult
	}
	defer root.RemoveAll(validationName)
	if _, err := pipackage.ExtractArchiveAt(ctx, zip, root, validationName); err != nil {
		return result, err
	}
	tree, err := pipackage.OpenTreeAt(ctx, root, validationName)
	if err != nil {
		return result, err
	}
	defer tree.Close()
	artifact, err := pipackage.ValidateArtifact(tree, string(captured.Metadata.SourceKind), captured.Metadata.ResolvedSource, environment, string(captured.Metadata.ContentDigest))
	if err != nil {
		return result, err
	}
	left, _ := json.Marshal(artifact)
	right, _ := json.Marshal(captured.Artifact)
	if !bytes.Equal(left, right) {
		return result, ErrResult
	}
	return Result{Artifact: artifact, ZipPath: zipPath, ZipBytes: captured.ZipBytes, ZipSHA256: captured.ZipSHA256}, nil
}
