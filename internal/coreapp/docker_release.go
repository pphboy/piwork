package coreapp

import (
	"encoding/json"
	"errors"
	"io"
	"os"
	"regexp"
	"strings"

	"golang.org/x/sys/unix"
)

// DockerRelease contains only nonsecret defaults belonging to one image build.
// User initialization remains separate from these distribution references.
type DockerRelease struct {
	Version int `json:"version"`
	Release struct {
		Version         string `json:"version"`
		Commit          string `json:"commit"`
		Modified        bool   `json:"modified"`
		SourceInputHash string `json:"sourceInputHash"`
	} `json:"release"`
	Images struct {
		Agent          string `json:"agent"`
		PackageHelper  string `json:"packageHelper"`
		FileHelper     string `json:"fileHelper"`
		SnapshotHelper string `json:"snapshotHelper"`
	} `json:"images"`
}

var ErrDockerRelease = errors.New("Docker release defaults are invalid or unavailable; use a matching Core image")
var releaseCommitPattern = regexp.MustCompile(`^[a-f0-9]{40}$`)
var releaseHashPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)
var releaseVersionPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]*$`)
var releaseImagePattern = regexp.MustCompile(`^(?:[a-z0-9]+(?:[.-][a-z0-9]+)*(?::[0-9]+)?/)?[a-z0-9]+(?:[._-][a-z0-9]+)*(?:/[a-z0-9]+(?:[._-][a-z0-9]+)*)*(?::[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}|@sha256:[a-f0-9]{64})$`)

func ReadDockerRelease(path string) (DockerRelease, error) {
	var release DockerRelease
	fd, err := unix.Open(path, unix.O_RDONLY|unix.O_NOFOLLOW|unix.O_CLOEXEC|unix.O_NONBLOCK, 0)
	if err != nil {
		return release, ErrDockerRelease
	}
	f := os.NewFile(uintptr(fd), path)
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() > 64<<10 {
		return release, ErrDockerRelease
	}
	decoder := json.NewDecoder(io.LimitReader(f, (64<<10)+1))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&release); err != nil {
		return DockerRelease{}, ErrDockerRelease
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return DockerRelease{}, ErrDockerRelease
	}
	if release.Version != 1 || !releaseVersionPattern.MatchString(release.Release.Version) || !releaseCommitPattern.MatchString(release.Release.Commit) || !releaseHashPattern.MatchString(release.Release.SourceInputHash) {
		return DockerRelease{}, ErrDockerRelease
	}
	for _, image := range []string{release.Images.Agent, release.Images.PackageHelper, release.Images.FileHelper, release.Images.SnapshotHelper} {
		if len(image) > 255 || !releaseImagePattern.MatchString(image) || strings.HasSuffix(image, ":latest") {
			return DockerRelease{}, ErrDockerRelease
		}
	}
	return release, nil
}

func ApplyDockerReleaseDefaults(values map[string]string) (map[string]string, error) {
	path := values["PIWORK_RELEASE_CONFIG_PATH"]
	if path == "" {
		return values, nil
	}
	release, err := ReadDockerRelease(path)
	if err != nil {
		return nil, err
	}
	merged := make(map[string]string, len(values)+4)
	for key, value := range values {
		merged[key] = value
	}
	// A built-in Agent reference alone is not a submitted model initialization.
	for _, key := range []string{"PIWORK_MODEL_PROVIDER", "PIWORK_MODEL", "PIWORK_MODEL_ID", "PIWORK_API_KEY", "PIWORK_MODEL_API_KEY", "PIWORK_MODEL_BASE_URL"} {
		if _, supplied := values[key]; supplied {
			if _, explicit := values["PIWORK_AGENT_IMAGE"]; !explicit {
				merged["PIWORK_AGENT_IMAGE"] = release.Images.Agent
			}
			break
		}
	}
	for key, image := range map[string]string{
		"PIWORK_PACKAGE_HELPER_IMAGE":  release.Images.PackageHelper,
		"PIWORK_FILE_HELPER_IMAGE":     release.Images.FileHelper,
		"PIWORK_SNAPSHOT_HELPER_IMAGE": release.Images.SnapshotHelper,
	} {
		if _, explicit := values[key]; !explicit {
			merged[key] = image
		}
	}
	return merged, nil
}
