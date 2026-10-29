package coreapp

import (
	"context"
	"sync"

	"piwork/internal/agentclient"
	"piwork/internal/internaltls"
	"piwork/internal/workruntime"
)

// A route is an in-memory proof for one observed Engine connection. This
// mutex is separate from Application.mu so a database publication cannot
// block health queries or invert the application/store lock order.
type workRouteFence struct {
	mu         sync.Mutex
	epoch      uint64
	online     bool
	scope      string
	generation uint64
}

type workRouteEpochKey struct{}

func (a *Application) captureWorkRouteEpoch(ctx context.Context) context.Context {
	a.routeFence.mu.Lock()
	epoch := a.routeFence.epoch
	if !a.routeFence.online {
		epoch = 0
	}
	a.routeFence.mu.Unlock()
	return context.WithValue(ctx, workRouteEpochKey{}, epoch)
}

func (a *Application) publishWorkRoute(ctx context.Context, scope internaltls.Scope, contextID string, started workruntime.Started) error {
	epoch, _ := ctx.Value(workRouteEpochKey{}).(uint64)
	a.routeFence.mu.Lock()
	defer a.routeFence.mu.Unlock()
	if ctx.Err() != nil || epoch == 0 || !a.routeFence.online || epoch != a.routeFence.epoch {
		return errWorkSuperseded
	}
	publish := func() error { return a.agentRoutes.Publish(scope, contextID, started) }
	if a.engine != nil && a.routeFence.scope != "" {
		if err := a.engine.WithVerificationIdentity(a.routeFence.scope, a.routeFence.generation, publish); err != nil {
			return errWorkSuperseded
		}
		return nil
	}
	return publish()
}

// Called while Application.mu protects the preparation transition. It never
// performs I/O; client closing happens only after both locks are released.
func (a *Application) setWorkRoutesOnline(scope string, generation uint64) {
	a.routeFence.mu.Lock()
	defer a.routeFence.mu.Unlock()
	if !a.routeFence.online {
		a.routeFence.epoch++
	}
	a.routeFence.online = true
	a.routeFence.scope, a.routeFence.generation = scope, generation
}

func (a *Application) revokeEngineWorkRoutes() []*agentclient.Client {
	a.routeFence.mu.Lock()
	defer a.routeFence.mu.Unlock()
	if a.routeFence.online {
		a.routeFence.epoch++
	}
	a.routeFence.online = false
	a.routeFence.scope, a.routeFence.generation = "", 0
	return a.agentRoutes.RevokeAll()
}

func closeAgentClients(clients []*agentclient.Client) {
	for _, client := range clients {
		_ = client.Close()
	}
}
