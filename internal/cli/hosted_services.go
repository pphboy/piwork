package cli

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/tls"
	"encoding/hex"
	"encoding/json"
	"errors"
	"html"
	"io"
	"net"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"piwork/internal/clientfs"
)

type HostedServiceOptions struct {
	Origin, ListenHost, StateDirectory string
	FirstPort, LastPort                int
	TLS                                *tls.Config
}

type HostedServicePool struct {
	options  HostedServiceOptions
	origin   *url.URL
	mu       sync.Mutex
	bindings map[string]string
	slots    map[int]*hostedServiceSlot
	registry *clientfs.Directory
	closed   bool
	retired  map[[32]byte]hostedRetiredService
	ctx      context.Context
	cancel   context.CancelFunc
	wg       sync.WaitGroup
}
type hostedServiceSlot struct {
	port    int
	origin  string
	server  *http.Server
	entries map[string]hostedServiceRef
}
type hostedServiceRef struct {
	desktop *nativeDesktop
	id      string
}
type hostedRetiredService struct {
	port    int
	workID  string
	expires time.Time
}

// Origins are pinned to a logical owner/Work/Service/declared-port identity.
// Reusing an origin for a different app would expose old tabs/storage even if
// grants were rotated. Retired pins therefore remain reserved across restart;
// an exhausted installation can explicitly enlarge its bounded port range.
func NewHostedServicePool(parent context.Context, options HostedServiceOptions) (*HostedServicePool, error) {
	origin, err := url.Parse(options.Origin)
	if err != nil || origin.Hostname() == "" || options.FirstPort < 1 || options.LastPort > 65535 || options.LastPort < options.FirstPort || options.LastPort-options.FirstPort >= 1024 {
		return nil, errors.New("invalid Service entry port range")
	}
	root, err := clientfs.OpenPrivateDirectory(options.StateDirectory, true)
	if err != nil {
		return nil, err
	}
	bindings := map[string]string{}
	raw, err := root.ReadFile("origins.json", 512<<10)
	if err == nil {
		var record struct {
			Version  int               `json:"version"`
			Bindings map[string]string `json:"bindings"`
		}
		decoder := json.NewDecoder(bytes.NewReader(raw))
		decoder.DisallowUnknownFields()
		var extra any
		if decoder.Decode(&record) != nil || decoder.Decode(&extra) != io.EOF || record.Version != 1 || record.Bindings == nil || len(record.Bindings) > 4096 {
			root.Close()
			return nil, errors.New("invalid Service origin registry")
		}
		for port, key := range record.Bindings {
			n, err := strconv.Atoi(port)
			if err != nil || n < 1 || n > 65535 || strconv.Itoa(n) != port || len(key) != 64 {
				root.Close()
				return nil, errors.New("invalid Service origin binding")
			}
			if _, err := hex.DecodeString(key); err != nil {
				root.Close()
				return nil, errors.New("invalid Service origin binding")
			}
		}
		bindings = record.Bindings
	} else if !errors.Is(err, os.ErrNotExist) {
		root.Close()
		return nil, err
	}
	ctx, cancel := context.WithCancel(parent)
	p := &HostedServicePool{options: options, origin: origin, registry: root, bindings: bindings, slots: map[int]*hostedServiceSlot{}, retired: map[[32]byte]hostedRetiredService{}, ctx: ctx, cancel: cancel}
	p.wg.Add(1)
	go p.review()
	return p, nil
}

func (p *HostedServicePool) register(d *nativeDesktop, entry *desktopServiceEntry) error {
	keyBytes := sha256.Sum256([]byte(d.hosted.Credential.User.ID + "\x00" + entry.workID + "\x00" + entry.serviceID + "\x00" + strconv.Itoa(entry.port)))
	key := hex.EncodeToString(keyBytes[:])
	p.mu.Lock()
	if p.closed {
		p.mu.Unlock()
		return errors.New("SERVICE_ENTRY_UNAVAILABLE")
	}
	count := 0
	for _, slot := range p.slots {
		count += len(slot.entries)
	}
	if count >= 1024 {
		p.mu.Unlock()
		return errors.New("SERVICE_ENTRY_LIMIT")
	}
	var slot *hostedServiceSlot
	var listener net.Listener
	for pass := 0; pass < 2 && slot == nil; pass++ {
		for port := p.options.FirstPort; port <= p.options.LastPort; port++ {
			binding := p.bindings[strconv.Itoa(port)]
			if pass == 0 && binding != key || pass == 1 && binding != "" {
				continue
			}
			if existing := p.slots[port]; existing != nil {
				slot = existing
				break
			}
			var err error
			listener, err = net.Listen("tcp", net.JoinHostPort(p.options.ListenHost, strconv.Itoa(port)))
			if err != nil {
				continue
			}
			if binding == "" {
				if len(p.bindings) >= 4096 {
					_ = listener.Close()
					p.mu.Unlock()
					return errors.New("SERVICE_ORIGIN_CAPACITY")
				}
				p.bindings[strconv.Itoa(port)] = key
				raw, _ := json.Marshal(map[string]any{"version": 1, "bindings": p.bindings})
				if err := p.registry.AtomicWrite(p.ctx, "origins.json", raw); err != nil {
					// An unsuccessful fsync can leave a durable rename behind.
					// Keep the pin rather than reassigning an uncertain origin.
					_ = listener.Close()
					p.mu.Unlock()
					return errors.New("SERVICE_ORIGIN_STORAGE_UNAVAILABLE")
				}
			}
			slot = &hostedServiceSlot{port: port, origin: p.origin.Scheme + "://" + net.JoinHostPort(p.origin.Hostname(), strconv.Itoa(port)), entries: map[string]hostedServiceRef{}}
			slot.server = &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { p.serve(slot, w, r) }), ReadHeaderTimeout: 10 * time.Second, MaxHeaderBytes: 32 << 10, IdleTimeout: 90 * time.Second}
			p.slots[port] = slot
			break
		}
	}
	if slot == nil {
		p.mu.Unlock()
		return errors.New("SERVICE_ORIGIN_CAPACITY")
	}
	slot.entries[entry.id] = hostedServiceRef{desktop: d, id: entry.id}
	p.mu.Unlock()
	d.mu.Lock()
	current := d.serviceEntries[entry.id] == entry && d.identity.credential != nil && d.identity.checked && d.identity.generation == entry.generation
	if current {
		entry.remotePort = slot.port
		if entry.jar == nil {
			entry.jar, _ = cookiejar.New(nil)
		}
	}
	d.mu.Unlock()
	if listener != nil {
		if p.options.TLS != nil {
			listener = tls.NewListener(listener, p.options.TLS)
		}
		go func() { _ = slot.server.Serve(listener) }()
	}
	if !current {
		p.drop(hostedServiceRef{desktop: d, id: entry.id})
		return errors.New("CONNECTION_CHANGED")
	}
	return nil
}

func (p *HostedServicePool) references(slot *hostedServiceSlot) []hostedServiceRef {
	p.mu.Lock()
	defer p.mu.Unlock()
	items := make([]hostedServiceRef, 0, len(slot.entries))
	for _, ref := range slot.entries {
		items = append(items, ref)
	}
	return items
}

func (p *HostedServicePool) serve(slot *hostedServiceSlot, w http.ResponseWriter, r *http.Request) {
	expected, _ := url.Parse(slot.origin)
	if r.Host != expected.Host {
		desktopError(w, 403, "SERVICE_HOST_DENIED")
		return
	}
	items := p.references(slot)
	var ticket string
	if r.URL.Path == desktopServiceReserved+"redeem" {
		if r.Method != http.MethodPost || r.Header.Get("Origin") != slot.origin || r.Header.Get("Content-Type") != "application/json" {
			desktopError(w, 403, "LOCAL_ENTRY_DENIED")
			return
		}
		raw, err := io.ReadAll(io.LimitReader(r.Body, 4097))
		if err != nil || len(raw) > 4096 {
			desktopError(w, 403, "LOCAL_ENTRY_DENIED")
			return
		}
		r.Body = io.NopCloser(bytes.NewReader(raw))
		var value struct {
			Ticket string `json:"ticket"`
		}
		if json.Unmarshal(raw, &value) != nil {
			desktopError(w, 403, "LOCAL_ENTRY_DENIED")
			return
		}
		ticket = value.Ticket
	}
	bootstrap := r.URL.Path == desktopServiceReserved+"enter" || r.URL.Path == desktopServiceReserved+"entry.js"
	grant := desktopSessionID(r, p.routeCookie(slot.port))
	for _, ref := range items {
		d := ref.desktop
		d.mu.Lock()
		entry := d.serviceEntries[ref.id]
		valid := entry != nil && entry.remotePort == slot.port && (bootstrap || ticket != "" && equalDesktopSecret(entry.ticket, ticket) || grant != "" && equalDesktopSecret(entry.grant, grant))
		d.mu.Unlock()
		if valid {
			d.serveServiceOrigin(w, r)
			return
		}
	}
	p.mu.Lock()
	prior, known := p.retired[sha256.Sum256([]byte(grant))]
	p.mu.Unlock()
	if known && prior.port == slot.port && time.Now().Before(prior.expires) {
		serviceUnavailablePage(w, r, p.options.Origin, prior.workID, 401, "Service access ended. Open this Service again from its Work.")
		return
	}
	serviceUnavailablePage(w, r, p.options.Origin, "", 401, "Service access is unavailable. Open the current Service from your workbench.")
}

func (p *HostedServicePool) routeCookie(port int) string {
	prefix := "piwork-route-"
	if p.origin.Scheme == "https" {
		prefix = "__Host-piwork-route-"
	}
	return prefix + strconv.Itoa(port)
}

func (p *HostedServicePool) drop(ref hostedServiceRef) {
	d := ref.desktop
	var retired hostedRetiredService
	var hash [32]byte
	d.mu.Lock()
	if entry := d.serviceEntries[ref.id]; entry != nil {
		if entry.grant != "" {
			hash = sha256.Sum256([]byte(entry.grant))
			retired = hostedRetiredService{port: entry.remotePort, workID: entry.workID, expires: time.Now().Add(10 * time.Minute)}
		}
		delete(d.serviceGrants, entry.grant)
		delete(d.serviceEntries, ref.id)
	}
	d.mu.Unlock()
	p.mu.Lock()
	for key, value := range p.retired {
		if !time.Now().Before(value.expires) {
			delete(p.retired, key)
		}
	}
	if retired.port != 0 && len(p.retired) < 1024 {
		p.retired[hash] = retired
	}
	for _, slot := range p.slots {
		delete(slot.entries, ref.id)
	}
	p.mu.Unlock()
}

func serviceUnavailablePage(w http.ResponseWriter, r *http.Request, origin, workID string, status int, reason string) {
	if r.Method != http.MethodGet || !strings.Contains(r.Header.Get("Accept"), "text/html") {
		desktopError(w, status, "LOCAL_SERVICE_AUTH_REQUIRED")
		return
	}
	back := origin + "/"
	if workID != "" {
		back = origin + "/#/work/" + url.PathEscape(workID)
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'")
	w.WriteHeader(status)
	_, _ = io.WriteString(w, `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Service unavailable</title><h1>Service unavailable</h1><p>`+html.EscapeString(reason)+`</p><p>`+html.EscapeString(workID)+`</p><a href="`+html.EscapeString(back)+`" rel="noopener">Back to Work</a></html>`)
}

func (p *HostedServicePool) release(d *nativeDesktop) {
	p.mu.Lock()
	var refs []hostedServiceRef
	for _, slot := range p.slots {
		for _, ref := range slot.entries {
			if ref.desktop == d {
				refs = append(refs, ref)
			}
		}
	}
	p.mu.Unlock()
	for _, ref := range refs {
		p.drop(ref)
	}
}

func (p *HostedServicePool) review() {
	defer p.wg.Done()
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-p.ctx.Done():
			return
		case <-ticker.C:
		}
		p.mu.Lock()
		slots := make([]*hostedServiceSlot, 0, len(p.slots))
		for _, slot := range p.slots {
			slots = append(slots, slot)
		}
		p.mu.Unlock()
		for _, slot := range slots {
			if p.ctx.Err() != nil {
				return
			}
			refs := p.references(slot)
			for _, ref := range refs {
				d := ref.desktop
				d.mu.Lock()
				entry := d.serviceEntries[ref.id]
				var copy desktopServiceEntry
				var base, token string
				if entry != nil && d.identity.credential != nil {
					copy = *entry
					base = d.identity.coreURL
					token = d.identity.credential.Token
				}
				d.mu.Unlock()
				if entry == nil || token == "" || !d.serviceLive(copy) {
					p.drop(ref)
					continue
				}
				api, _ := d.client(base, token)
				ctx, cancel := context.WithTimeout(p.ctx, 500*time.Millisecond)
				resolved, err := desktopResolveService(ctx, api, copy.hostname, copy.port)
				cancel()
				if err != nil {
					p.drop(ref)
					continue
				}
				for _, candidate := range refs {
					candidate.desktop.mu.Lock()
					current := candidate.desktop.serviceEntries[candidate.id]
					changed := current != nil && (current.workID != resolved.WorkID || current.serviceID != resolved.ServiceID || current.runtimeGeneration != "" && current.runtimeGeneration != resolved.Generation)
					candidate.desktop.mu.Unlock()
					if changed {
						p.drop(candidate)
					}
				}
				break
			}
		}
	}
}

func (p *HostedServicePool) Close() {
	p.cancel()
	p.wg.Wait()
	p.mu.Lock()
	if p.closed {
		p.mu.Unlock()
		return
	}
	p.closed = true
	servers := make([]*http.Server, 0, len(p.slots))
	for _, slot := range p.slots {
		servers = append(servers, slot.server)
	}
	p.slots = map[int]*hostedServiceSlot{}
	p.mu.Unlock()
	for _, server := range servers {
		_ = server.Close()
	}
	_ = p.registry.Close()
}

func (d *nativeDesktop) remoteServiceEntry(host string) (desktopServiceEntry, bool) {
	d.mu.Lock()
	defer d.mu.Unlock()
	for _, entry := range d.serviceEntries {
		if entry.remotePort != 0 {
			expected, _ := url.Parse(d.serviceOrigin(*entry))
			if expected.Host == host {
				return *entry, true
			}
		}
	}
	return desktopServiceEntry{}, false
}

func (d *nativeDesktop) routeCookieName(entry desktopServiceEntry) string {
	if d.hosted != nil && d.hosted.Services != nil {
		return d.hosted.Services.routeCookie(entry.remotePort)
	}
	return "__Host-piwork-route"
}

func (d *nativeDesktop) logicalServiceURL(entry desktopServiceEntry, path string) *url.URL {
	host := entry.hostname
	if entry.port != 80 {
		host = net.JoinHostPort(host, strconv.Itoa(entry.port))
	}
	scheme := "http"
	if d.hosted != nil && d.hosted.Services != nil {
		scheme = d.hosted.Services.origin.Scheme
	}
	return &url.URL{Scheme: scheme, Host: host, Path: path}
}

func (d *nativeDesktop) invalidateServiceEntry(entry desktopServiceEntry) {
	if d.hosted != nil && d.hosted.Services != nil {
		d.hosted.Services.drop(hostedServiceRef{desktop: d, id: entry.id})
	}
}
