package dockerengine

import (
	"context"
	"github.com/moby/moby/client"
	"strings"
)

// HostPlatform reads the selected Engine, rather than the CLI host architecture.
func (e *Engine) HostPlatform(ctx context.Context) (string, string, error) {
	v, err := e.api.ServerVersion(ctx, client.ServerVersionOptions{})
	if err != nil {
		return "", "", runtimeError(err)
	}
	arch := strings.ToLower(v.Arch)
	switch arch {
	case "x86_64":
		arch = "amd64"
	case "aarch64":
		arch = "arm64"
	}
	if v.Os != "linux" || arch == "" {
		return "", "", ErrSpecification
	}
	return v.Os, arch, nil
}
