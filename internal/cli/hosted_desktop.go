package cli

import (
	"errors"
	"net/http"
	"net/url"
	"path/filepath"
	"strconv"
	"time"

	"piwork/internal/client"
)

// HostedDesktopOptions binds one reusable workbench handler to exactly one
// authenticated browser session. It never reads or writes CLI credentials.
type HostedDesktopOptions struct {
	Origin, SessionID, CSRF, CookieName string
	StateDirectory, RecordDirectory     string
	Credential                          client.Credential
	Transport                           *http.Transport
}

type HostedDesktop struct{ desktop *nativeDesktop }

func NewHostedDesktop(options HostedDesktopOptions) (*HostedDesktop, error) {
	origin, err := client.ParseCoreURL(options.Origin)
	if err != nil || options.SessionID == "" || options.CSRF == "" || options.CookieName == "" || !filepath.IsAbs(options.StateDirectory) || !filepath.IsAbs(options.RecordDirectory) {
		return nil, errors.New("invalid hosted workbench configuration")
	}
	expiry, err := time.Parse(time.RFC3339Nano, options.Credential.ExpiresAt)
	if err != nil || !expiry.After(time.Now()) || options.Credential.Token == "" {
		return nil, errors.New("invalid hosted workbench identity")
	}
	port, _ := strconv.Atoi(origin.Port())
	if port == 0 {
		port = 80
		if origin.Scheme == "https" {
			port = 443
		}
	}
	record := options.Credential
	d := &nativeDesktop{port: port, origin: options.Origin, hosted: &options,
		sessions:   map[string]desktopSession{options.SessionID: {id: options.SessionID, csrf: options.CSRF, end: expiry}},
		fileWrites: map[string]bool{}, serviceEntries: map[string]*desktopServiceEntry{}, serviceGrants: map[string]string{}, serviceConns: map[string]int{},
		identity: desktopIdentity{coreURL: options.Credential.CoreURL, credential: &record, checked: true}}
	return &HostedDesktop{desktop: d}, nil
}

func (h *HostedDesktop) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Login/logout and all connection editing belong to the shared web session.
	switch r.URL.Path {
	case "/_desktop/api/login", "/_desktop/api/logout", "/_desktop/api/connection", "/_desktop/api/preferences":
		desktopError(w, 404, "HOSTED_ROUTE_UNAVAILABLE")
		return
	}
	h.desktop.ServeHTTP(w, r)
}

// SuspendContent stops in-flight content when the remote identity cannot be
// confirmed, without discarding an otherwise unexpired login.
func (h *HostedDesktop) SuspendContent() {
	d := h.desktop
	d.mu.Lock()
	defer d.mu.Unlock()
	d.cancelAccessLocked()
}

func (h *HostedDesktop) Close() {
	d := h.desktop
	d.mu.Lock()
	d.revokeLocked()
	d.cancelAccessLocked()
	d.sessions = map[string]desktopSession{}
	if d.transfers != nil {
		d.transfers.clear()
		d.transfers = nil
	}
	d.mu.Unlock()
}

func (d *nativeDesktop) expectedHost() string {
	if d.hosted != nil {
		origin, _ := url.Parse(d.origin)
		return origin.Host
	}
	return "desktop.localhost:" + strconv.Itoa(d.port)
}

func (d *nativeDesktop) client(base, token string) (*client.Client, error) {
	api, err := client.New(base, token)
	if err == nil && d.hosted != nil && d.hosted.Transport != nil {
		api.HTTP.Transport = d.hosted.Transport
	}
	return api, err
}

func (d *nativeDesktop) operationRecords() desktopOperationRecords {
	if d.hosted != nil {
		return desktopOperationRecords{credentialPath: filepath.Join(d.hosted.RecordDirectory, "browser.json")}
	}
	return desktopOperationRecords{credentialPath: d.store.Path}
}

func (d *nativeDesktop) transferPath() string {
	if d.hosted != nil {
		return filepath.Join(d.hosted.StateDirectory, "browser.json")
	}
	return d.store.Path
}
