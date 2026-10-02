package dockerengine

import (
	"context"
	"errors"
	"strings"

	"github.com/distribution/reference"
	"github.com/moby/moby/client"
)

type PreparedImage struct {
	Reference, ID, OS, Architecture, Variant string
	RepoDigests                              []string
	Labels                                   map[string]string
}

func (e *Engine) InspectImage(ctx context.Context, imageReference string) (PreparedImage, error) {
	if !imageIDPattern.MatchString(imageReference) {
		if _, err := reference.ParseNormalizedNamed(imageReference); err != nil || strings.ContainsRune(imageReference, 0) {
			return PreparedImage{}, ErrImageReference
		}
	}
	result, err := e.api.ImageInspect(ctx, imageReference)
	if err != nil {
		return PreparedImage{}, runtimeError(err)
	}
	if !imageIDPattern.MatchString(result.ID) || result.Os != "linux" || (imageIDPattern.MatchString(imageReference) && imageReference != result.ID) {
		return PreparedImage{}, ErrSpecification
	}
	labels := map[string]string{}
	if result.Config != nil {
		for key, value := range result.Config.Labels {
			labels[key] = value
		}
	}
	return PreparedImage{Reference: imageReference, ID: result.ID, OS: result.Os, Architecture: result.Architecture, Variant: result.Variant, RepoDigests: append([]string(nil), result.RepoDigests...), Labels: labels}, nil
}
func (e *Engine) PrepareImage(ctx context.Context, imageReference string) (PreparedImage, error) {
	existing, err := e.InspectImage(ctx, imageReference)
	if err == nil {
		return existing, nil
	}
	if !errors.Is(err, ErrResourceMissing) {
		return PreparedImage{}, err
	}
	// Captured identities are never replaced by a new tag resolution.
	if imageIDPattern.MatchString(imageReference) {
		return PreparedImage{}, ErrResourceMissing
	}
	auth, err := RegistryAuth(e.Endpoint.ConfigDirectory, imageReference)
	if err != nil {
		return PreparedImage{}, err
	}
	stream, err := e.api.ImagePull(ctx, imageReference, client.ImagePullOptions{RegistryAuth: auth})
	if err != nil {
		return PreparedImage{}, ErrImagePull
	}
	defer stream.Close()
	stop := context.AfterFunc(ctx, func() { stream.Close() })
	defer stop()
	if err := readImageProgress(ctx, stream, ErrImagePull); err != nil {
		return PreparedImage{}, err
	}
	return e.InspectImage(ctx, imageReference)
}
