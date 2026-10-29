package dockerengine

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"

	"github.com/moby/moby/client"
)

// ErrEngineIdentity indicates that a daemon did not provide enough information
// to safely reuse verification results across Core process lifetimes.
var ErrEngineIdentity = errors.New("Docker Engine identity is unavailable")

// VerificationScope returns an opaque identity for the current daemon and its
// storage. It must be rechecked after reconnecting; the socket is not an identity.
func (e *Engine) VerificationScope(ctx context.Context) (string, error) {
	scope, _, err := e.VerificationIdentity(ctx)
	return scope, err
}

// VerificationIdentity returns the current daemon scope and a process-local
// generation. A failed observation invalidates the generation even if the same
// daemon later returns, so callers can fence work begun before disconnection.
func (e *Engine) VerificationIdentity(ctx context.Context) (string, uint64, error) {
	if e == nil || e.api == nil {
		return "", 0, ErrUnavailable
	}
	for {
		e.identityMu.Lock()
		observedGeneration := e.identityGeneration
		e.identityMu.Unlock()
		result, err := e.api.Info(ctx, client.InfoOptions{})
		e.identityMu.Lock()
		// An invalidation or another identity observation completed while the
		// request was in flight. Re-read rather than publishing stale data.
		if observedGeneration != e.identityGeneration {
			e.identityMu.Unlock()
			if ctx.Err() != nil {
				return "", 0, ctx.Err()
			}
			continue
		}
		if err != nil {
			e.invalidateIdentityLocked()
			generation := e.identityGeneration
			e.identityMu.Unlock()
			return "", generation, ErrUnavailable
		}
		scope, err := verificationScope(result.Info.ID, result.Info.Driver, result.Info.DockerRootDir)
		if err != nil {
			e.invalidateIdentityLocked()
			generation := e.identityGeneration
			e.identityMu.Unlock()
			return "", generation, err
		}
		if scope != e.identityScope {
			e.identityGeneration++
			e.identityScope = scope
		}
		generation := e.identityGeneration
		e.identityMu.Unlock()
		return scope, generation, nil
	}
}

func (e *Engine) invalidateIdentityLocked() {
	if e.identityScope != "" {
		e.identityScope = ""
		e.identityGeneration++
	}
}

func (e *Engine) invalidateVerificationIdentity() {
	e.identityMu.Lock()
	defer e.identityMu.Unlock()
	e.invalidateIdentityLocked()
}

// withVerificationIdentity serializes publication with observed Engine
// invalidation. The callback must not call VerificationIdentity, Ping, or
// acquire a Store transaction. Durable callers acquire the writer first and
// keep this fence through commit (Store.WritePreparationFenced).
func (e *Engine) withVerificationIdentity(scope string, generation uint64, publish func() error) error {
	e.identityMu.Lock()
	defer e.identityMu.Unlock()
	if scope == "" || e.identityScope != scope || e.identityGeneration != generation {
		return ErrUnavailable
	}
	return publish()
}

// WithVerificationIdentity fences a durable publication against a daemon
// disconnect or identity change observed by this Engine.
func (e *Engine) WithVerificationIdentity(scope string, generation uint64, publish func() error) error {
	return e.withVerificationIdentity(scope, generation, publish)
}

func verificationScope(id, driver, root string) (string, error) {
	if id == "" || driver == "" || !filepath.IsAbs(root) || filepath.Clean(root) == "/" ||
		strings.ContainsAny(id+driver+root, "\x00\r\n") {
		return "", ErrEngineIdentity
	}
	// JSON provides unambiguous framing even if individual fields contain
	// punctuation. The digest keeps private daemon identity and paths out of keys.
	data, err := json.Marshal([]string{"piwork-engine-scope-v1", id, driver, filepath.Clean(root)})
	if err != nil {
		return "", ErrEngineIdentity
	}
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:]), nil
}
