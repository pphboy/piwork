// Package testsupport contains development-only, installation-scoped acceptance
// drivers. It is not imported by any production command.
package testsupport

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"regexp"

	"github.com/containerd/errdefs"
	"github.com/moby/moby/client"
)

const InstallationLabel = "piwork.installation_id"
const DeterministicProvider = "piwork-deterministic"
const DeterministicModel = "fixture-v1"
const AcceptanceImage = "piwork-agentd:acceptance"

var installationPattern = regexp.MustCompile(`^piwork-test-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
var ErrUnsafeTestScope = errors.New("Docker tests require a generated installation scope")
var ErrRealModel = errors.New("acceptance tests require the deterministic SDK model")

type Scope struct{ id string }

func NewScope() (*Scope, error) {
	var identity [16]byte
	if _, err := rand.Read(identity[:]); err != nil {
		return nil, err
	}
	identity[6] = identity[6]&0x0f | 0x40
	identity[8] = identity[8]&0x3f | 0x80
	id := hex.EncodeToString(identity[:])
	return &Scope{id: "piwork-test-" + id[:8] + "-" + id[8:12] + "-" + id[12:16] + "-" + id[16:20] + "-" + id[20:]}, nil
}
func ExistingScope(id string) (*Scope, error) {
	if !installationPattern.MatchString(id) {
		return nil, ErrUnsafeTestScope
	}
	return &Scope{id: id}, nil
}
func (s *Scope) ID() string { return s.id }
func (s *Scope) Labels() (map[string]string, error) {
	if s == nil || !installationPattern.MatchString(s.id) {
		return nil, ErrUnsafeTestScope
	}
	return map[string]string{InstallationLabel: s.id, "piwork.managed": "true", "piwork.test_fixture": "true"}, nil
}
func (s *Scope) Filters() (client.Filters, error) {
	if _, err := s.Labels(); err != nil {
		return nil, err
	}
	return make(client.Filters).Add("label", InstallationLabel+"="+s.id), nil
}
func RequireDeterministicModel(provider, model, variant string) error {
	if provider != DeterministicProvider || model != DeterministicModel || variant != "acceptance" {
		return ErrRealModel
	}
	return nil
}

// Cleanup rechecks every resource's label immediately before removing it.
// It never prunes, never deletes images, and never removes attached volumes
// indirectly. An unavailable Engine is an error, not proof of cleanup.
func (s *Scope) Cleanup(ctx context.Context, engine *client.Client) error {
	filters, err := s.Filters()
	if err != nil {
		return err
	}
	var failures []error
	containers, err := engine.ContainerList(ctx, client.ContainerListOptions{All: true, Filters: filters})
	if err != nil {
		failures = append(failures, err)
	} else {
		for _, item := range containers.Items {
			view, err := engine.ContainerInspect(ctx, item.ID, client.ContainerInspectOptions{})
			if errdefs.IsNotFound(err) {
				continue
			}
			if err != nil {
				failures = append(failures, err)
				continue
			}
			if view.Container.Config == nil || view.Container.Config.Labels[InstallationLabel] != s.id {
				failures = append(failures, ErrUnsafeTestScope)
				continue
			}
			if _, err := engine.ContainerRemove(ctx, item.ID, client.ContainerRemoveOptions{Force: true}); err != nil && !errdefs.IsNotFound(err) {
				failures = append(failures, err)
			}
		}
	}
	networks, err := engine.NetworkList(ctx, client.NetworkListOptions{Filters: filters})
	if err != nil {
		failures = append(failures, err)
	} else {
		for _, item := range networks.Items {
			view, err := engine.NetworkInspect(ctx, item.ID, client.NetworkInspectOptions{})
			if errdefs.IsNotFound(err) {
				continue
			}
			if err != nil {
				failures = append(failures, err)
				continue
			}
			if view.Network.Labels[InstallationLabel] != s.id {
				failures = append(failures, ErrUnsafeTestScope)
				continue
			}
			if _, err := engine.NetworkRemove(ctx, item.ID, client.NetworkRemoveOptions{}); err != nil && !errdefs.IsNotFound(err) {
				failures = append(failures, err)
			}
		}
	}
	volumes, err := engine.VolumeList(ctx, client.VolumeListOptions{Filters: filters})
	if err != nil {
		failures = append(failures, err)
	} else {
		for _, item := range volumes.Items {
			view, err := engine.VolumeInspect(ctx, item.Name, client.VolumeInspectOptions{})
			if errdefs.IsNotFound(err) {
				continue
			}
			if err != nil {
				failures = append(failures, err)
				continue
			}
			if view.Volume.Labels[InstallationLabel] != s.id {
				failures = append(failures, ErrUnsafeTestScope)
				continue
			}
			if _, err := engine.VolumeRemove(ctx, item.Name, client.VolumeRemoveOptions{}); err != nil && !errdefs.IsNotFound(err) {
				failures = append(failures, err)
			}
		}
	}
	return errors.Join(failures...)
}
