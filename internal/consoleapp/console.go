// Package consoleapp implements the Linux operator browser console.
package consoleapp

import (
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"golang.org/x/sys/unix"

	"piwork/internal/buildinfo"
	"piwork/internal/client"
	"piwork/internal/consoleassets"
	"piwork/internal/localweb"
)

const consoleHelp = "usage: piwork-console serve --public-origin <https-origin> --tls-cert <file> --tls-key <file>\n  [--core <loopback-url>] [--listen <host:port>] [--data-dir <directory>]\n"

type consoleOptions struct {
	coreURL, listen, publicOrigin, dataDir string
	certificate                            tls.Certificate
}

func parseConsoleOptions(args []string) (consoleOptions, error) {
	var options consoleOptions
	if len(args) == 0 || args[0] != "serve" || len(args)%2 != 1 {
		return options, errors.New("expected serve command")
	}
	values := map[string]string{}
	for i := 1; i < len(args); i += 2 {
		name, value := args[i], args[i+1]
		if value == "" || strings.HasPrefix(value, "--") || values[name] != "" {
			return options, errors.New("invalid or repeated option")
		}
		switch name {
		case "--core", "--listen", "--public-origin", "--tls-cert", "--tls-key", "--data-dir":
			values[name] = value
		default:
			return options, errors.New("unknown option")
		}
	}
	if values["--public-origin"] == "" || values["--tls-cert"] == "" || values["--tls-key"] == "" {
		return options, errors.New("public-origin, TLS certificate and key are required")
	}
	options.listen = values["--listen"]
	if options.listen == "" {
		options.listen = "0.0.0.0:7173"
	}
	_, port, err := net.SplitHostPort(options.listen)
	if err != nil {
		return options, errors.New("invalid listen address")
	}
	portNumber, err := strconv.Atoi(port)
	if err != nil || portNumber < 1 || portNumber > 65535 {
		return options, errors.New("invalid listen address")
	}
	origin, err := url.Parse(values["--public-origin"])
	if err != nil || origin.Scheme != "https" || origin.Hostname() == "" || origin.User != nil || origin.Path != "" && origin.Path != "/" || origin.RawQuery != "" || origin.Fragment != "" || origin.Opaque != "" {
		return options, errors.New("public-origin must be an HTTPS origin")
	}
	originPort := origin.Port()
	if originPort == "" {
		originPort = "443"
	}
	if originPort != port {
		return options, errors.New("public-origin must use the listen port")
	}
	options.publicOrigin = origin.Scheme + "://" + origin.Host
	options.coreURL = values["--core"]
	if options.coreURL == "" {
		options.coreURL = "http://127.0.0.1:7171"
	}
	core, err := client.ParseCoreURL(options.coreURL)
	if err != nil || !localweb.IsLocalCoreHost(core.Hostname()) {
		return options, errors.New("Core URL must be a plain loopback origin")
	}
	options.coreURL = core.Scheme + "://" + core.Host
	for _, item := range []struct {
		path, label string
		key         bool
	}{{values["--tls-cert"], "certificate", false}, {values["--tls-key"], "key", true}} {
		info, err := os.Lstat(item.path)
		if err != nil || !info.Mode().IsRegular() || item.key && info.Mode().Perm()&0077 != 0 {
			return options, fmt.Errorf("TLS %s is unavailable or unsafe", item.label)
		}
	}
	options.certificate, err = tls.LoadX509KeyPair(values["--tls-cert"], values["--tls-key"])
	if err != nil {
		return options, errors.New("TLS certificate or key is invalid")
	}
	options.dataDir = values["--data-dir"]
	if options.dataDir == "" {
		cwd, err := os.Getwd()
		if err != nil {
			return options, err
		}
		options.dataDir = filepath.Join(cwd, ".piwork", "console")
	}
	options.dataDir, err = filepath.Abs(options.dataDir)
	return options, err
}

func consoleDataLock(directory string) (func(), error) {
	if err := os.MkdirAll(directory, 0700); err != nil {
		return nil, err
	}
	info, err := os.Lstat(directory)
	if err != nil || !info.IsDir() || info.Mode().Perm()&0077 != 0 {
		return nil, errors.New("unsafe Console data directory")
	}
	fd, err := unix.Open(filepath.Join(directory, "console.lock"), unix.O_CREAT|unix.O_RDWR|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0600)
	if err != nil {
		return nil, err
	}
	if err := unix.Flock(fd, unix.LOCK_EX|unix.LOCK_NB); err != nil {
		unix.Close(fd)
		return nil, errors.New("Console data directory is already in use")
	}
	staging := filepath.Join(directory, "staging")
	if err := os.RemoveAll(staging); err != nil {
		_ = unix.Flock(fd, unix.LOCK_UN)
		_ = unix.Close(fd)
		return nil, err
	}
	if err := os.Mkdir(staging, 0700); err != nil {
		_ = unix.Flock(fd, unix.LOCK_UN)
		_ = unix.Close(fd)
		return nil, err
	}
	return func() { _ = os.RemoveAll(staging); _ = unix.Flock(fd, unix.LOCK_UN); _ = unix.Close(fd) }, nil
}

// Entry runs piwork-console without depending on the user CLI.
func Entry(args []string, stdout, stderr io.Writer) int {
	if len(args) == 1 && (args[0] == "--version" || args[0] == "version") {
		if err := json.NewEncoder(stdout).Encode(buildinfo.Read("piwork-console")); err != nil {
			return 1
		}
		return 0
	}
	if len(args) == 1 && (args[0] == "--help" || args[0] == "-h" || args[0] == "help") || len(args) == 2 && args[0] == "serve" && args[1] == "--help" {
		_, _ = io.WriteString(stdout, consoleHelp)
		return 0
	}
	options, err := parseConsoleOptions(args)
	if err != nil {
		fmt.Fprintf(stderr, "%v\n%s", err, consoleHelp)
		return 2
	}
	for _, path := range []string{"static/public/index.html", "static/public/style.css", "static/browser/app.js"} {
		if _, err := fs.Stat(consoleassets.FS, path); err != nil {
			fmt.Fprintln(stderr, "Console browser resources are missing; rebuild piwork-console")
			return 5
		}
	}
	unlock, err := consoleDataLock(options.dataDir)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	defer unlock()
	listener, err := net.Listen("tcp", options.listen)
	if err != nil {
		fmt.Fprintln(stderr, "Console listener is unavailable")
		return 1
	}
	app := &nativeConsole{options: options}
	server := &http.Server{Handler: app, ReadHeaderTimeout: 10 * time.Second, MaxHeaderBytes: 32 << 10}
	done := make(chan error, 1)
	go func() {
		done <- server.Serve(tls.NewListener(listener, &tls.Config{Certificates: []tls.Certificate{options.certificate}, MinVersion: tls.VersionTLS12}))
	}()
	fmt.Fprintf(stdout, "piwork-console listening at %s\n", options.publicOrigin)
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(signals)
	select {
	case <-signals:
	case err := <-done:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			fmt.Fprintln(stderr, "Console listener stopped")
			return 1
		}
	}
	_ = server.Close()
	return 0
}

type nativeConsole struct {
	options    consoleOptions
	mu         sync.Mutex
	sessions   map[string]consoleSession
	challenges map[string]consoleChallenge
	failures   map[string]consoleFailureBucket
	uploads    int
}

func consoleShellRoute(escapedPath string) bool {
	parts := strings.Split(escapedPath, "/")
	if len(parts) == 4 && parts[0] == "" && parts[1] == "models" && parts[2] == "providers" {
		_, valid := localweb.ResourcePart(parts[3], localweb.IDPattern)
		return valid
	}
	if len(parts) != 3 || parts[0] != "" {
		return false
	}
	pattern := localweb.IDPattern
	switch parts[1] {
	case "skills", "packages":
		pattern = localweb.NamePattern
	case "operations", "models":
	default:
		return false
	}
	_, valid := localweb.ResourcePart(parts[2], pattern)
	return valid
}

func (c *nativeConsole) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'")
	w.Header().Set("Strict-Transport-Security", "max-age=31536000")
	origin, _ := url.Parse(c.options.publicOrigin)
	if r.Host != origin.Host {
		consoleFailure(w, 400, "INVALID_HOST")
		return
	}
	if r.URL.RawQuery != "" || r.URL.Fragment != "" {
		consoleFailure(w, 404, "NOT_FOUND")
		return
	}
	if strings.HasPrefix(r.URL.Path, "/console/api/") {
		c.serveAPI(w, r)
		return
	}
	if r.Method != http.MethodGet {
		consoleFailure(w, 501, "CONSOLE_ROUTE_UNAVAILABLE")
		return
	}
	var path, contentType string
	switch {
	case r.URL.Path == "/healthz":
		consoleJSON(w, 200, map[string]string{"status": "healthy"})
		return
	case r.URL.Path == "/style.css":
		path, contentType = "static/public/style.css", "text/css; charset=utf-8"
	case strings.HasPrefix(r.URL.Path, "/browser/") && localweb.BrowserAsset.MatchString(strings.TrimPrefix(r.URL.Path, "/browser/")):
		path, contentType = "static/browser/"+strings.TrimPrefix(r.URL.Path, "/browser/"), "text/javascript; charset=utf-8"
	default:
		if strings.Contains("|/|/login|/users|/runtime|/default-work|/skills|/packages|/operations|/models|", "|"+r.URL.Path+"|") || consoleShellRoute(r.URL.EscapedPath()) {
			path, contentType = "static/public/index.html", "text/html; charset=utf-8"
		} else {
			consoleFailure(w, 404, "NOT_FOUND")
			return
		}
	}
	content, err := consoleassets.FS.ReadFile(path)
	if err != nil {
		consoleFailure(w, 404, "CONSOLE_ASSET_UNAVAILABLE")
		return
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Length", strconv.Itoa(len(content)))
	w.WriteHeader(200)
	_, _ = w.Write(content)
}

func consoleJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func consoleFailure(w http.ResponseWriter, status int, code string) {
	consoleJSON(w, status, map[string]string{"code": code, "message": code})
}
