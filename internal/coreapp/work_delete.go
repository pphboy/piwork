package coreapp

import (
	"context"
	"fmt"
	"sync"

	"piwork/internal/dockerengine"
)

// removeAcceptedWork performs only confirmed Engine effects. The caller
// atomically retains the two volumes and publishes the deleted Work state
// together with the terminal Operation after this function succeeds.
func (a *Application) removeAcceptedWork(ctx context.Context, workID string) (returned error) {
	step := "runtime"
	defer func() {
		if returned != nil {
			returned = fmt.Errorf("work deletion %s: %w", step, returned)
		}
	}()
	if a.dockerRuntime == nil {
		return errCapturedWork
	}
	if err := a.stopAcceptedWork(ctx, workID); err != nil {
		return err
	}
	if err := a.settleWorkPackageJobs(ctx, workID); err != nil {
		return err
	}
	step = "agent inspection"
	identity := dockerengine.ContainerIdentity{WorkID: workID, Kind: "agent", LogicalID: "agentd"}
	view, err := a.dockerRuntime.InspectContainer(ctx, identity)
	if err != nil {
		return err
	}
	if view != nil {
		if view.State == nil {
			return errCapturedWork
		}
		if view.State.Running {
			if err := a.stopAcceptedWork(ctx, workID); err != nil {
				return err
			}
		}
	}
	// A concurrent recovery Start holds the same Work lock and must finish
	// before the last Engine ownership check. A new Start sees desired=deleted.
	value, _ := a.workLocks.LoadOrStore(workID, &sync.Mutex{})
	lock := value.(*sync.Mutex)
	if err := lockWorkContext(ctx, lock); err != nil {
		return err
	}
	defer lock.Unlock()
	step = "services"
	if err := a.stopWorkServicesLocked(ctx, workID, true); err != nil {
		return err
	}
	managed, err := a.dockerRuntime.ListContainers(ctx, "")
	if err != nil {
		return err
	}
	step = "helper confirmation"
	for _, item := range managed {
		if item.Config == nil {
			return errCapturedWork
		}
		if item.Config.Labels[dockerengine.WorkLabel] == workID &&
			(item.Config.Labels[dockerengine.KindLabel] != "agent" || item.Config.Labels[dockerengine.LogicalLabel] != "agentd") {
			// File/snapshot helpers must be confirmed by their own coordinator.
			return errCapturedWork
		}
	}
	if err := a.dockerRuntime.RemoveContainer(ctx, identity); err != nil {
		return err
	}
	step = "container removal confirmation"
	managed, err = a.dockerRuntime.ListContainers(ctx, "")
	if err != nil {
		return err
	}
	for _, item := range managed {
		if item.Config == nil || item.Config.Labels[dockerengine.WorkLabel] == workID {
			return errCapturedWork
		}
	}
	networks, err := a.dockerRuntime.ListNetworks(ctx)
	if err != nil {
		return err
	}
	step = "networks"
	for _, network := range networks {
		if network.Labels[dockerengine.WorkLabel] == workID {
			if err := a.dockerRuntime.RemoveNetwork(ctx, network.ID, workID); err != nil {
				return err
			}
		}
	}
	networks, err = a.dockerRuntime.ListNetworks(ctx)
	if err != nil {
		return err
	}
	for _, network := range networks {
		if network.Labels[dockerengine.WorkLabel] == workID {
			return errCapturedWork
		}
	}
	if a.agentTLS == nil {
		return errCapturedWork
	}
	step = "runtime material"
	if err := a.agentTLS.RemoveWorkMaterial(workID); err != nil {
		return err
	}
	return nil
}
