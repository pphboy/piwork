package coreapp

import (
	"piwork/internal/contracts"
	"piwork/internal/distribution"
)

// RuntimeDefaults is tied to the running Core build, including when an older
// standalone Console connects. It is never inferred from a browser input.
func (a *Application) RuntimeDefaults() (contracts.WebRuntimeDefaults, error) {
	images, err := distribution.Defaults()
	if err != nil {
		return contracts.WebRuntimeDefaults{}, contracts.NewError("RELEASE_DEFAULTS_UNAVAILABLE", "")
	}
	return contracts.WebRuntimeDefaults{AgentImage: images.Agent}, nil
}

// runtimeImage resolves only this Core's release. A legacy field can confirm
// the same reference, but cannot choose another image or a client's release.
func (a *Application) runtimeImage(requested string) (string, error) {
	defaults, err := a.RuntimeDefaults()
	if err != nil {
		return "", err
	}
	if requested != "" && requested != defaults.AgentImage {
		return "", contracts.NewError("INVALID_REQUEST", "agentImage")
	}
	return defaults.AgentImage, nil
}

// ConfigureRuntime is the release-bound legacy model write used by HTTP and
// offline operators. Settings also supports internal, already-resolved inputs.
func (a *Application) ConfigureRuntime(input RuntimeInput, authorize func() error) (RuntimeView, error) {
	image, err := a.runtimeImage(input.AgentImage)
	if err != nil {
		return RuntimeView{}, err
	}
	input.AgentImage = image
	return a.Settings.ConfigureRuntimeAuthorized(input, authorize)
}
