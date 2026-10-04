package cli

import (
	"context"
	"time"

	"piwork/internal/client"
)

func (d *nativeDesktop) newSecret() (string, error) {
	if d.secret != nil {
		return d.secret()
	}
	return desktopSecret()
}
func (d *nativeDesktop) pruneSessionsLocked() {
	for id, session := range d.sessions {
		if !time.Now().Before(session.end) {
			delete(d.sessions, id)
		}
	}
}
func (d *nativeDesktop) issueTicket() (string, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	ticket, err := d.newSecret()
	if err != nil {
		return "", err
	}
	d.pruneSessionsLocked()
	d.ticket = ticket
	d.ticketEnd = time.Now().Add(5 * time.Minute)
	d.used = false
	return d.origin + "/#ticket=" + ticket, nil
}

type desktopCleanup struct{ coreURL, token string }
type desktopLogoutResult struct {
	LocalCleared              bool           `json:"localCleared"`
	RemoteRevocationConfirmed bool           `json:"remoteRevocationConfirmed"`
	CredentialCleared         bool           `json:"credentialCleared"`
	Error                     string         `json:"error,omitempty"`
	View                      map[string]any `json:"view,omitempty"`
}
type desktopLogoutFlight struct {
	done   chan struct{}
	result desktopLogoutResult
}

func copyDesktopLogoutResult(value desktopLogoutResult) desktopLogoutResult {
	copy := value
	copy.View = make(map[string]any, len(value.View))
	for key, field := range value.View {
		copy.View[key] = field
	}
	return copy
}

// Capture and revoke first. The independent bounded cleanup survives a browser
// or Unix helper disconnect, and never changes a subsequently logged-in identity.
func (d *nativeDesktop) logoutIdentity() desktopLogoutResult {
	d.logoutMu.Lock()
	if flight := d.logoutFlight; flight != nil {
		d.logoutMu.Unlock()
		<-flight.done
		return copyDesktopLogoutResult(flight.result)
	}
	flight := &desktopLogoutFlight{done: make(chan struct{})}
	d.logoutFlight = flight
	d.logoutMu.Unlock()
	result := d.cleanupIdentity()
	d.logoutMu.Lock()
	flight.result = result
	d.logoutFlight = nil
	close(flight.done)
	d.logoutMu.Unlock()
	return copyDesktopLogoutResult(result)
}
func (d *nativeDesktop) cleanupIdentity() desktopLogoutResult {
	d.mu.Lock()
	cleanup := d.pendingCleanup
	if cleanup == nil && d.identity.credential != nil {
		cleanup = &desktopCleanup{coreURL: d.identity.coreURL, token: d.identity.credential.Token}
	}
	coreURL := d.identity.coreURL
	d.revokeLocked()
	generation := d.identity.generation
	// Prevent login/switch from replacing the capture until conditional cleanup finishes.
	d.pendingCleanup = cleanup
	d.mu.Unlock()
	result := desktopLogoutResult{LocalCleared: true, CredentialCleared: true, RemoteRevocationConfirmed: cleanup == nil,
		View: map[string]any{"state": "signed-out", "coreUrl": coreURL, "generation": generation}}
	if cleanup == nil {
		return result
	}
	if api, err := client.New(cleanup.coreURL, cleanup.token); err == nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		err = api.Logout(ctx)
		cancel()
		result.RemoteRevocationConfirmed = err == nil || confirmedInvalidLogoutSession(err)
	}
	if err := d.store.ClearSession(cleanup.coreURL, cleanup.token); err != nil {
		result.CredentialCleared = false
		result.Error = "CREDENTIAL_CLEANUP_REQUIRED"
	} else {
		d.mu.Lock()
		if d.pendingCleanup == cleanup {
			d.pendingCleanup = nil
		}
		d.mu.Unlock()
	}
	if !result.RemoteRevocationConfirmed && result.Error == "" {
		result.Error = "REMOTE_REVOCATION_UNCONFIRMED"
	}
	return result
}

func (d *nativeDesktop) rememberCleanupLocked(coreURL, token string) {
	if err := d.store.ClearSession(coreURL, token); err != nil && d.pendingCleanup == nil {
		d.pendingCleanup = &desktopCleanup{coreURL: coreURL, token: token}
	}
}
