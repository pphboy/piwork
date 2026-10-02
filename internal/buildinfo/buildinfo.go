// Package buildinfo describes the native executable without invoking build tools.
package buildinfo

import (
	"runtime"
	"runtime/debug"
)

// Version is set by the native build entry point.
var Version = "0.1.0-dev"

// Commit and Modified are supplied explicitly by the build script so worktree
// builds remain traceable even when the Go tool omits automatic VCS metadata.
var Commit = "unknown"
var Modified = "false"

type Info struct {
	Program      string `json:"program"`
	Version      string `json:"version"`
	Commit       string `json:"commit"`
	Modified     bool   `json:"modified"`
	GoVersion    string `json:"goVersion"`
	OS           string `json:"os"`
	Architecture string `json:"architecture"`
}

func Read(program string) Info {
	info := Info{Program: program, Version: Version, Commit: Commit, Modified: Modified == "true", GoVersion: runtime.Version(), OS: runtime.GOOS, Architecture: runtime.GOARCH}
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
	return info
}
