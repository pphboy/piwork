package cli

import (
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"piwork/internal/client"
	"piwork/internal/desktopassets"
	"piwork/internal/localweb"
)

const desktopDefaultPort = 17891

type desktopOptions struct {
	port int
	open bool
}

func parseUserDesktopOptions(args []string) (desktopOptions, error) {
	options := desktopOptions{port: desktopDefaultPort, open: true}
	seenPort, seenNoOpen := false, false
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--no-open":
			if seenNoOpen {
				return options, errors.New("duplicate desktop option")
			}
			seenNoOpen = true
			options.open = false
		case "--port":
			if seenPort || i+1 >= len(args) {
				return options, errors.New("desktop port must be 1..65535")
			}
			seenPort = true
			i++
			for _, ch := range args[i] {
				if ch < '0' || ch > '9' {
					return options, errors.New("desktop port must be 1..65535")
				}
			}
			port, err := strconv.Atoi(args[i])
			if err != nil || port < 1 || port > 65535 {
				return options, errors.New("desktop port must be 1..65535")
			}
			options.port = port
		default:
			return options, errors.New("unknown desktop option")
		}
	}
	return options, nil
}

type nativeDesktop struct {
	api                *client.Client
	store              client.CredentialStore
	port               int
	origin             string
	ticket             string
	ticketEnd          time.Time
	used               bool
	mu                 sync.Mutex
	sessions           map[string]desktopSession
	fileWrites         map[string]bool
	serviceEntries     map[string]*desktopServiceEntry
	serviceGrants      map[string]string
	serviceConns       map[string]int
	transfers          *desktopTransfers
	identity           desktopIdentity
	pendingCleanup     *desktopCleanup
	logoutMu           sync.Mutex
	logoutFlight       *desktopLogoutFlight
	secret             func() (string, error)
	localGeneration    int
	activeAccess       map[*desktopAccess]bool
	preferencesStorage desktopPreferencesStorage
}

type desktopSession struct {
	id   string
	csrf string
	end  time.Time
}

func desktopSecret() (string, error) {
	return localweb.Secret()
}

func runUserDesktop(api *client.Client, store client.CredentialStore, saved *client.Credential, args []string, stdout, stderr io.Writer) int {
	container, err := cliContainerMode()
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 2
	}
	options, err := parseUserDesktopOptions(args)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 2
	}
	for _, path := range []string{"static/public/index.html", "static/public/style.css", "static/browser/app.js", "static/browser/files.js"} {
		if _, err := fs.Stat(desktopassets.FS, path); err != nil {
			fmt.Fprintln(stderr, "Desktop browser resources are missing; rebuild piwork-cli")
			return 5
		}
	}
	listener, err := listenCLILocal(options.port, container)
	if err != nil {
		fmt.Fprintln(stderr, "Desktop port is already in use or unavailable")
		return 6
	}
	origin := fmt.Sprintf("http://desktop.localhost:%d", options.port)
	d := &nativeDesktop{api: api, store: store, port: options.port, origin: origin,
		sessions: make(map[string]desktopSession), fileWrites: make(map[string]bool),
		serviceEntries: make(map[string]*desktopServiceEntry), serviceGrants: make(map[string]string), serviceConns: make(map[string]int),
		identity: desktopIdentity{coreURL: api.Base.Scheme + "://" + api.Base.Host}}
	if saved != nil && sameCoreOrigin(saved.CoreURL, api.Base.String()) {
		d.identity.credential = saved
	}
	launchURL := origin + "/"
	if !container {
		launchURL, err = d.issueTicket()
		if err != nil {
			_ = listener.Close()
			fmt.Fprintln(stderr, "Unable to create Desktop session")
			return 5
		}
	}
	control, err := startDesktopControl(d)
	if err != nil {
		_ = listener.Close()
		fmt.Fprintln(stderr, err)
		return 5
	}
	defer control.close()
	server := &http.Server{Handler: d, ReadHeaderTimeout: 10 * time.Second, MaxHeaderBytes: 32 << 10}
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(signals)
	done := make(chan error, 1)
	go func() { done <- server.Serve(listener) }()
	fmt.Fprintf(stdout, "Piwork Desktop: %s\n", launchURL)
	if container {
		fmt.Fprintln(stdout, "Run piwork-cli desktop open --no-open inside this running container, then open its URL in the browser on this computer.")
	}
	if options.open && !container {
		go openDesktopBrowser(launchURL, stderr)
	}
	exitCode := 0
	select {
	case caught := <-signals:
		if caught == syscall.SIGTERM {
			exitCode = 143
		} else {
			exitCode = 130
		}
	case err := <-done:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			fmt.Fprintln(stderr, "Desktop listener failed")
			return 5
		}
	}
	_ = server.Close()
	d.mu.Lock()
	d.sessions = make(map[string]desktopSession)
	d.mu.Unlock()
	if d.transfers != nil {
		d.transfers.clear()
	}
	return exitCode
}

func openDesktopBrowser(address string, stderr io.Writer) {
	openDesktopBrowserContext(context.Background(), address, stderr)
}
func openDesktopBrowserContext(ctx context.Context, address string, stderr io.Writer) {
	command, args := "xdg-open", []string{address}
	switch runtime.GOOS {
	case "darwin":
		command = "open"
	case "windows":
		command, args = "rundll32.exe", []string{"url.dll,FileProtocolHandler", address}
	}
	process := exec.CommandContext(ctx, command, args...)
	process.Stdout, process.Stderr = io.Discard, io.Discard
	if err := process.Start(); err != nil {
		fmt.Fprintf(stderr, "Could not open a browser. Open %s manually.\n", address)
		return
	}
	if err := process.Wait(); err != nil {
		if ctx.Err() != nil {
			return
		}
		fmt.Fprintf(stderr, "Could not open a browser. Open %s manually.\n", address)
	}
}

func (d *nativeDesktop) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Host != fmt.Sprintf("desktop.localhost:%d", d.port) {
		if !d.serveServiceOrigin(w, r) {
			desktopError(w, 403, "LOCAL_HOST_DENIED")
		}
		return
	}
	if r.Method == http.MethodConnect || r.Header.Get("Upgrade") != "" {
		desktopError(w, 403, "LOCAL_REQUEST_DENIED")
		return
	}
	if strings.HasPrefix(r.URL.Path, "/_desktop/api/") {
		d.serveAPI(w, r)
		return
	}
	if strings.HasPrefix(r.URL.Path, "/_desktop/files/") {
		d.serveFiles(w, r)
		return
	}
	if strings.HasPrefix(r.URL.Path, "/_desktop/") {
		desktopError(w, 501, "DESKTOP_ROUTE_UNAVAILABLE")
		return
	}
	d.serveStatic(w, r)
}

func (d *nativeDesktop) serveStatic(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		desktopError(w, 405, "METHOD_NOT_ALLOWED")
		return
	}
	path := ""
	contentType := "text/html; charset=utf-8"
	switch {
	case r.URL.Path == "/style.css":
		path, contentType = "static/public/style.css", "text/css; charset=utf-8"
	case strings.HasPrefix(r.URL.Path, "/desktop/browser/") && nativeBrowserAsset.MatchString(strings.TrimPrefix(r.URL.Path, "/desktop/browser/")):
		path, contentType = "static/browser/"+strings.TrimPrefix(r.URL.Path, "/desktop/browser/"), "text/javascript; charset=utf-8"
	case r.URL.Path == "/" || desktopWorkRoute(r.URL.Path):
		path = "static/public/index.html"
	default:
		desktopError(w, 404, "NOT_FOUND")
		return
	}
	content, err := desktopassets.FS.ReadFile(path)
	if err != nil {
		desktopError(w, 404, "DESKTOP_ASSET_UNAVAILABLE")
		return
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Length", strconv.Itoa(len(content)))
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Origin-Agent-Cluster", "?1")
	w.Header().Set("Cross-Origin-Opener-Policy", "same-origin")
	w.Header().Set("Content-Security-Policy", fmt.Sprintf("default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-src http://*.desktop.localhost:%d; object-src 'none'; base-uri 'none'; frame-ancestors 'none'", d.port))
	w.WriteHeader(200)
	if r.Method != http.MethodHead {
		_, _ = w.Write(content)
	}
}

func desktopWorkRoute(path string) bool {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	return len(parts) == 2 && parts[0] == "works" && parts[1] != "" ||
		len(parts) == 4 && parts[0] == "works" && parts[1] != "" && parts[2] == "services" && parts[3] != ""
}
