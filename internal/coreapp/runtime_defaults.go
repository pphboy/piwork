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
