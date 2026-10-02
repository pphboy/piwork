package workruntime

import (
	"context"
	"piwork/internal/agentclient"
	"piwork/internal/internaltls"
)

// OpenManagedAgent observes an exact retained generation during recovery.
// It neither publishes admission nor requires acceptingRuns: a crashed Apply
// may have closed Agent admission while retaining an active Run.
func (r *Runtime) OpenManagedAgent(ctx context.Context, scope internaltls.Scope, contextID string) (*agentclient.Client, error) {
	if r == nil || r.Docker == nil || r.TLS == nil {
		return nil, ErrContext
	}
	view, err := r.Docker.InspectContainer(ctx, agentIdentity(scope, contextID))
	if err != nil {
		return nil, err
	}
	if view == nil || view.State == nil || !view.State.Running {
		return nil, ErrAgentExited
	}
	network, err := r.Docker.EnsureNetwork(ctx, scope.WorkID)
	if err != nil {
		return nil, err
	}
	address, err := solePrivateAddress(view, network.Name)
	if err != nil {
		return nil, err
	}
	connection, err := agentclient.Open(ctx, r.TLS, scope, address)
	if err != nil {
		return nil, err
	}
	if _, err := connection.ObserveReadiness(ctx, contextID); err != nil {
		connection.Close()
		return nil, err
	}
	return connection, nil
}
