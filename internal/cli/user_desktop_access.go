package cli

import (
	"context"
	"errors"
	"net/http"
	"sync"
	"time"
)

type desktopAccess struct {
	session                             string
	localGeneration, identityGeneration int
	identityBound                       bool
	cancel                              context.CancelFunc
}

func (d *nativeDesktop) accessCurrentLocked(a *desktopAccess) bool {
	ss, ok := d.sessions[a.session]
	return ok && time.Now().Before(ss.end) && d.localGeneration == a.localGeneration && (!a.identityBound || d.identity.generation == a.identityGeneration)
}
func (d *nativeDesktop) cancelPlatformAccessLocked() {
	for a := range d.activeAccess {
		if a.identityBound {
			a.cancel()
		}
	}
}
func (d *nativeDesktop) cancelAccessLocked() {
	for a := range d.activeAccess {
		a.cancel()
	}
}

// Content requests are bounded separately from short authentication requests.
// Cancellation closes the upstream context, incoming upload body and stalled
// browser writes; the expiry observer also catches an otherwise idle stream.
func (d *nativeDesktop) guardContent(w http.ResponseWriter, r *http.Request, session desktopSession) (http.ResponseWriter, *http.Request, func(), bool) {
	return d.guardAccess(w, r, session, true)
}
func (d *nativeDesktop) guardAccess(w http.ResponseWriter, r *http.Request, session desktopSession, identityBound bool) (http.ResponseWriter, *http.Request, func(), bool) {
	d.mu.Lock()
	if len(d.activeAccess) >= 256 {
		d.mu.Unlock()
		desktopError(w, 503, "LOCAL_CONTENT_BUSY")
		return w, r, func() {}, false
	}
	ctx, cancel := context.WithCancel(r.Context())
	a := &desktopAccess{session: session.id, localGeneration: d.localGeneration, identityGeneration: d.identity.generation, identityBound: identityBound, cancel: cancel}
	if !d.accessCurrentLocked(a) {
		d.mu.Unlock()
		cancel()
		desktopError(w, 401, "LOCAL_AUTH_REQUIRED")
		return w, r, func() {}, false
	}
	if d.activeAccess == nil {
		d.activeAccess = map[*desktopAccess]bool{}
	}
	d.activeAccess[a] = true
	d.mu.Unlock()
	stopped := make(chan struct{})
	stopClose := context.AfterFunc(ctx, func() {
		controller := http.NewResponseController(w)
		_ = controller.SetReadDeadline(time.Now())
		_ = controller.SetWriteDeadline(time.Now())
		if r.Body != nil {
			_ = r.Body.Close()
		}
	})
	go func() {
		ticker := time.NewTicker(250 * time.Millisecond)
		defer ticker.Stop()
		defer close(stopped)
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				d.mu.Lock()
				current := d.accessCurrentLocked(a)
				d.mu.Unlock()
				if !current {
					cancel()
					return
				}
			}
		}
	}()
	var once sync.Once
	finish := func() {
		once.Do(func() {
			stopClose()
			cancel()
			<-stopped
			d.mu.Lock()
			delete(d.activeAccess, a)
			d.mu.Unlock()
		})
	}
	return &desktopContentWriter{ResponseWriter: w, d: d, access: a, ctx: ctx}, r.WithContext(ctx), finish, true
}

type desktopContentWriter struct {
	http.ResponseWriter
	d                *nativeDesktop
	access           *desktopAccess
	ctx              context.Context
	started, blocked bool
}

func (w *desktopContentWriter) valid() bool {
	w.d.mu.Lock()
	current := w.d.accessCurrentLocked(w.access)
	w.d.mu.Unlock()
	return current && w.ctx.Err() == nil
}
func (w *desktopContentWriter) WriteHeader(status int) {
	if w.started {
		return
	}
	w.started = true
	if !w.valid() {
		w.blocked = true
		w.ResponseWriter.Header().Del("Content-Length")
		w.d.mu.Lock()
		ss, exists := w.d.sessions[w.access.session]
		localValid := exists && time.Now().Before(ss.end) && w.d.localGeneration == w.access.localGeneration
		identityChanged := w.d.identity.generation != w.access.identityGeneration
		w.d.mu.Unlock()
		if !localValid {
			desktopError(w.ResponseWriter, 401, "LOCAL_AUTH_REQUIRED")
		} else if identityChanged {
			desktopError(w.ResponseWriter, 401, "AUTH_REQUIRED")
		} else {
			desktopError(w.ResponseWriter, 409, "CONNECTION_CHANGED")
		}
		return
	}
	w.ResponseWriter.WriteHeader(status)
}
func (w *desktopContentWriter) Write(raw []byte) (int, error) {
	if !w.started {
		w.WriteHeader(200)
	}
	if w.blocked || !w.valid() {
		return 0, errors.New("Desktop content access revoked")
	}
	return w.ResponseWriter.Write(raw)
}
func (w *desktopContentWriter) Flush() {
	if !w.started {
		w.WriteHeader(200)
	}
	if !w.blocked && w.valid() {
		if flusher, ok := w.ResponseWriter.(http.Flusher); ok {
			flusher.Flush()
		}
	}
}
func (w *desktopContentWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

func (d *nativeDesktop) resetBrowserAccess(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		desktopError(w, 405, "METHOD_NOT_ALLOWED")
		return
	}
	input, err := readDesktopObject(r, 1024)
	if err != nil {
		desktopInputError(w, err)
		return
	}
	if len(input) != 0 {
		desktopError(w, 400, "INVALID_INPUT")
		return
	}
	d.mu.Lock()
	d.localGeneration++
	d.sessions = map[string]desktopSession{}
	d.ticket = ""
	d.ticketEnd = time.Time{}
	d.used = true
	d.serviceEntries = map[string]*desktopServiceEntry{}
	d.serviceGrants = map[string]string{}
	d.serviceConns = map[string]int{}
	d.cancelAccessLocked()
	if d.transfers != nil {
		d.transfers.clear()
		d.transfers = nil
	}
	d.mu.Unlock()
	w.Header().Set("Set-Cookie", d.cookieName()+"=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0")
	desktopJSON(w, 200, map[string]bool{"browserAccessCleared": true, "coreSessionRetained": true})
}
