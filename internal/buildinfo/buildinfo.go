// Package buildinfo describes the native executable without invoking build tools.
package buildinfo

import (
	"encoding/json"
	"runtime"
	"runtime/debug"
	"strings"
)

// Version is set by the native build entry point.
var Version = "0.1.0-dev"

// Commit and Modified are supplied explicitly by the build script so worktree
// builds remain traceable even when the Go tool omits automatic VCS metadata.
var Commit = "unknown"
var Modified = "false"

// DesktopUIHash binds standalone client releases to their browser build inputs.
var DesktopUIHash = ""

// Go omits linker flags from trimmed build metadata. The client stamp is kept
// as one identifiable value so the packager can verify it without executing a
// foreign target. Read uses the same value as the source of release identity.
var ClientReleaseIdentity = ""

type Info struct {
	Program       string `json:"program"`
	Version       string `json:"version"`
	Commit        string `json:"commit"`
	Modified      bool   `json:"modified"`
	GoVersion     string `json:"goVersion"`
	OS            string `json:"os"`
	Architecture  string `json:"architecture"`
	DesktopUIHash string `json:"desktopUIHash,omitempty"`
}

func Read(program string) Info {
	info := Info{Program: program, Version: Version, Commit: Commit, Modified: Modified == "true", GoVersion: runtime.Version(), OS: runtime.GOOS, Architecture: runtime.GOARCH, DesktopUIHash: DesktopUIHash}
	if build, ok := debug.ReadBuildInfo(); ok {
		for _, setting := range build.Settings {
			switch setting.Key {
			case "vcs.revision":
				info.Commit = setting.Value
			case "vcs.modified":
				info.Modified = setting.Value == "true"
			}
		}
	}
	if strings.HasPrefix(ClientReleaseIdentity, "piwork-cli-release-v1:") {
		var identity struct {
			Version       string `json:"releaseVersion"`
			Commit        string `json:"commit"`
			Modified      bool   `json:"modified"`
			DesktopUIHash string `json:"desktopUIHash"`
		}
		if json.Unmarshal([]byte(strings.TrimPrefix(ClientReleaseIdentity, "piwork-cli-release-v1:")), &identity) == nil {
			info.Version, info.Commit, info.Modified, info.DesktopUIHash = identity.Version, identity.Commit, identity.Modified, identity.DesktopUIHash
		}
	}
	return info
}
