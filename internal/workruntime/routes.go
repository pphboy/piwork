package workruntime

import (
	"context"
	"errors"
	"sync"

	"piwork/internal/agentclient"
	"piwork/internal/internaltls"
)

var ErrRouteUnavailable = errors.New("Work Agent route is unavailable")

type route struct {
	scope       internaltls.Scope
	contextID   string
	containerID string
	client      *agentclient.Client
	lifetime    context.Context
	cancel      context.CancelFunc
}

// Routes are published only after static image inspection, captured-context
// binding, the Docker launch, and the full TS Agent readiness check succeed.
// Owner authorization and desired-state checks belong to the Work coordinator.
type Routes struct {
	mu    sync.RWMutex
	works map[string]route
}

func (r *Routes) Publish(scope internaltls.Scope, contextID string, started Started) error {
	if !started.verified || started.scope != scope || started.contextID != contextID || started.Client == nil || scope.InstallationID == "" || scope.WorkID == "" || scope.Generation < 1 || scope.InstanceID == "" || contextID == "" || started.ContainerID == "" || started.Address == "" {
		return ErrRouteUnavailable
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.works == nil {
		r.works = make(map[string]route)
	}
	if _, exists := r.works[scope.WorkID]; exists {
		return ErrRouteUnavailable
	}
	lifetime, cancel := context.WithCancel(context.Background())
	r.works[scope.WorkID] = route{scope: scope, contextID: contextID, containerID: started.ContainerID, client: started.Client, lifetime: lifetime, cancel: cancel}
	return nil
}

func (r *Routes) Agent(scope internaltls.Scope, contextID string) (*agentclient.Client, error) {
	client, _, err := r.Admission(scope, contextID)
	return client, err
}

// Admission returns a cancellation signal for requests already using this
// route. Revoking a Work closes its observations and RPC attempts without
// sending CancelRun to the retained Agent harness.
func (r *Routes) Admission(scope internaltls.Scope, contextID string) (*agentclient.Client, context.Context, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	entry, ok := r.works[scope.WorkID]
	if !ok || entry.scope != scope || entry.contextID != contextID {
		return nil, nil, ErrRouteUnavailable
	}
	return entry.client, entry.lifetime, nil
}

// Revoke removes admission before drain/stop. The coordinator owns the
// returned client and closes it only after outstanding requests have ended.
func (r *Routes) Revoke(workID string) *agentclient.Client {
	r.mu.Lock()
	defer r.mu.Unlock()
	entry, ok := r.works[workID]
	if !ok {
		return nil
	}
	delete(r.works, workID)
	entry.cancel()
	return entry.client
}
