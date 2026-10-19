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
