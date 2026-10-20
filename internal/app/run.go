// Package app owns the unified Linux server's single startup and shutdown.
package app

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"piwork/internal/clientfs"
	"piwork/internal/coreapp"
	"piwork/internal/coreoperator"
	"piwork/internal/corestore"
	"piwork/internal/distribution"
	"piwork/internal/dockerengine"
	"piwork/internal/localweb"
	"piwork/internal/safefs"
	"piwork/internal/webapp"
)

const serveHelp = `Usage: piwork [serve] [OPTIONS]
Start Core, the browser workbench, administration, and first-time setup.

  --listen HOST:PORT             browser ControlPlane, default 0.0.0.0:17891
  --core-listen HOST:PORT        Core API for CLI/backend, default 127.0.0.1:17871
  --data-dir DIR                 default user config directory/piwork/server
  --public-origin URL            exact browser origin; override for NAT/proxy
  --no-open                      print the URL without opening a browser
  --tls-cert FILE --tls-key FILE  serve HTTPS with an explicit certificate
  --docker-host UNIX_URL         explicit local Docker Engine endpoint
  --docker-context NAME          explicit local Docker context
  --package-helper-image IMAGE   advanced helper override
  --file-helper-image IMAGE      advanced helper override
  --snapshot-helper-image IMAGE  advanced helper override
  --agent-grpc-listen HOST:PORT   default 0.0.0.0:7172
  --agent-grpc-advertise HOST:PORT default piwork-core:<bound RPC port>

No business environment variables are required. Optional PIWORK_ADMIN_ACCOUNT
and PIWORK_ADMIN_PASSWORD create only the first administrator on an empty
installation; model connections are configured in the browser.
Operator commands: status, admin, config. User commands: piwork-cli.
`

func Run(ctx context.Context, args []string, stdin io.Reader, stdout, stderr io.Writer) int {
	if len(args) == 1 && (args[0] == "--help" || args[0] == "-h" || args[0] == "help") {
		fmt.Fprint(stdout, serveHelp, "\n", coreoperator.Usage)
		return 0
	}
	// Consume option values before locating the command: a directory named
	// "status" is still a directory, and globals may precede "serve".
	values := map[string]bool{"--listen": true, "--core-listen": true, "--data-dir": true, "--public-origin": true, "--tls-cert": true, "--tls-key": true, "--docker-host": true, "--docker-context": true, "--agent-grpc-listen": true, "--agent-grpc-advertise": true, "--agent-image": true, "--package-helper-image": true, "--file-helper-image": true, "--snapshot-helper-image": true, "--core": true, "--env-file": true, "--operator-credential-file": true}
	command, index := "", -1
	explicitDirectory := false
	for i := 0; i < len(args); i++ {
		name, _, inline := strings.Cut(args[i], "=")
		if name == "--data-dir" {
			explicitDirectory = true
		}
		if values[name] {
			if !inline {
				i++
			}
			continue
		}
		if strings.HasPrefix(args[i], "-") {
			continue
		}
		command, index = args[i], i
		break
	}
	if command == "" || command == "serve" {
		for _, arg := range args {
			if arg == "--version" {
				return coreoperator.Run(ctx, args, stdin, stdout, stderr)
			}
		}
		if index >= 0 {
			args = append(append([]string{}, args[:index]...), args[index+1:]...)
		}
		return RunServe(ctx, args, stdout, stderr)
	}
	// Operator defaults follow the unified server; explicit selections retain
	// their previous precedence and never consult user CLI credentials.
	if !explicitDirectory && os.Getenv("PIWORK_DATA_DIR") == "" {
		directory, err := defaultDirectory()
		if err != nil {
			fmt.Fprintln(stderr, "piwork: default data directory is unavailable")
			return 1
		}
		args = append([]string{"--data-dir", directory}, args...)
	}
	return coreoperator.Run(ctx, args, stdin, stdout, stderr)
}

func defaultDirectory() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(base, "piwork", "server"), nil
}

func RunServe(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	for _, arg := range args {
		if arg == "--help" || arg == "-h" {
			fmt.Fprint(stdout, serveHelp)
			return 0
		}
	}
	defaults, err := distribution.Defaults()
	if err != nil {
		fmt.Fprintln(stderr, "piwork: embedded release dependencies are invalid")
		return 1
	}
	flags := flag.NewFlagSet("piwork", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	listen := flags.String("listen", "0.0.0.0:17891", "")
	coreListen := flags.String("core-listen", "127.0.0.1:17871", "")
	directory := flags.String("data-dir", "", "")
	publicOrigin := flags.String("public-origin", "", "")
	noOpen := flags.Bool("no-open", false, "")
	_ = flags.Bool("allow-insecure-remote", false, "") // Accepted previous explicit spelling.
	certPath := flags.String("tls-cert", "", "")
	keyPath := flags.String("tls-key", "", "")
	dockerHost := flags.String("docker-host", os.Getenv("DOCKER_HOST"), "")
	dockerContext := flags.String("docker-context", os.Getenv("DOCKER_CONTEXT"), "")
	grpcListen := flags.String("agent-grpc-listen", "0.0.0.0:7172", "")
	grpcAdvertise := flags.String("agent-grpc-advertise", "", "")
	packageHelper := flags.String("package-helper-image", defaults.PackageHelper, "")
	fileHelper := flags.String("file-helper-image", defaults.FileHelper, "")
	snapshotHelper := flags.String("snapshot-helper-image", defaults.SnapshotHelper, "")
	seen := map[string]bool{}
	for _, arg := range args {
		if strings.HasPrefix(arg, "--") {
			name, _, _ := strings.Cut(arg, "=")
			if seen[name] {
				fmt.Fprintln(stderr, "piwork: repeated startup option; use --help")
				return 2
			}
			seen[name] = true
		}
	}
	if flags.Parse(args) != nil || flags.NArg() != 0 {
		fmt.Fprintln(stderr, "piwork: invalid startup options; use --help")
		return 2
	}
	if *directory == "" {
		*directory, err = defaultDirectory()
		if err != nil {
			fmt.Fprintln(stderr, "piwork: default data directory is unavailable")
			return 1
		}
	}
	*directory, err = filepath.Abs(*directory)
	if err != nil {
		fmt.Fprintln(stderr, "piwork: data directory is invalid")
		return 2
	}
	address, err := coreapp.ParseListen(*listen, true)
	if err != nil {
		fmt.Fprintln(stderr, "piwork: listen address is invalid")
		return 2
	}
	coreAddress, err := coreapp.ParseListen(*coreListen, true)
	if err != nil {
		fmt.Fprintln(stderr, "piwork: Core listen address is invalid")
		return 2
	}
	var tlsConfig *tls.Config
	if (*certPath == "") != (*keyPath == "") {
		fmt.Fprintln(stderr, "piwork: --tls-cert and --tls-key must be provided together")
		return 2
	}
	if *certPath != "" {
		info, err := os.Lstat(*keyPath)
		if err != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 {
			fmt.Fprintln(stderr, "piwork: TLS key is unavailable or unsafe")
			return 2
		}
		certificate, err := tls.LoadX509KeyPair(*certPath, *keyPath)
		if err != nil {
			fmt.Fprintln(stderr, "piwork: TLS certificate/key are invalid")
			return 2
		}
		tlsConfig = &tls.Config{MinVersion: tls.VersionTLS12, Certificates: []tls.Certificate{certificate}}
	}
	if *publicOrigin != "" {
		parsed, parseErr := url.Parse(*publicOrigin)
		if parseErr != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Hostname() == "" || parsed.User != nil || parsed.Path != "" && parsed.Path != "/" || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.Opaque != "" {
			fmt.Fprintln(stderr, "piwork: --public-origin must be an HTTP(S) origin")
			return 2
		}
		if tlsConfig != nil && parsed.Scheme != "https" {
			fmt.Fprintln(stderr, "piwork: TLS requires an HTTPS public origin")
			return 2
		}
		*publicOrigin = parsed.Scheme + "://" + parsed.Host
	}
	admin := map[string]string{}
	for _, name := range []string{"PIWORK_ADMIN_ACCOUNT", "PIWORK_ADMIN_PASSWORD"} {
		if value, ok := os.LookupEnv(name); ok {
			admin[name] = value
		}
	}
	initialization, err := coreapp.InitializationFromEnvironment(admin)
	if err != nil {
		fmt.Fprintln(stderr, "piwork:", err)
		return 2
	}
	if ctx.Err() != nil {
		return 0
	}
	home, _ := os.UserHomeDir()
	// Core deliberately creates only its final directory. Prepare missing
	// parents without following symlinks, including on a fresh user account.
	parent, err := clientfs.EnsureDirectory(filepath.Dir(*directory))
	if err != nil {
		fmt.Fprintln(stderr, "piwork: data directory parent is unavailable or unsafe")
		return 1
	}
	_ = parent.Close()
	setupSecret, err := localweb.Secret()
	if err != nil {
		fmt.Fprintln(stderr, "piwork: startup identity unavailable")
		return 1
	}
	core, err := coreapp.New(ctx, coreapp.Options{DataDirectory: *directory, Initialization: initialization, SetupSecret: setupSecret,
		PackageHelperImage: *packageHelper, FileHelperImage: *fileHelper, SnapshotHelperImage: *snapshotHelper,
		AgentGRPCListen: *grpcListen, AgentGRPCAdvertise: *grpcAdvertise,
		DockerOptions: dockerengine.SelectionOptions{DockerHost: *dockerHost, DockerContext: *dockerContext, DockerConfig: os.Getenv("DOCKER_CONFIG"), HomeDirectory: home}})
	if err != nil {
		switch {
		case errors.Is(err, safefs.ErrLocked):
			fmt.Fprintln(stderr, "piwork: another Core owns this data directory")
		case errors.Is(err, corestore.ErrUnsupported):
			fmt.Fprintln(stderr, "piwork:", corestore.ErrUnsupported)
		default:
			fmt.Fprintln(stderr, "piwork: initialization failed; verify private data and PIWORK_ADMIN_ACCOUNT/PIWORK_ADMIN_PASSWORD")
		}
		return 1
	}
	coreBound, err := core.Bind(coreAddress)
	if err != nil {
		_ = closeApplication(core, nil)
		fmt.Fprintln(stderr, "piwork: Core listener is unavailable")
		return 1
	}
	browserListener, err := net.Listen("tcp", address.Address())
	if err != nil {
		_ = closeApplication(core, nil)
		fmt.Fprintln(stderr, "piwork: browser listener is unavailable")
		return 1
	}
	defer browserListener.Close()
	actual := browserListener.Addr().(*net.TCPAddr)
	origin := *publicOrigin
	if origin == "" {
		origin = browserOrigin(coreapp.ListenAddress{Host: actual.IP.String(), Port: actual.Port}, tlsConfig != nil)
	}
	coreURL := backendOrigin(coreBound)
	web, err := webapp.New(ctx, webapp.Options{Origin: origin, CoreURL: coreURL, SetupSecret: setupSecret, DataDirectory: *directory})
	if err != nil {
		_ = closeApplication(core, nil)
		fmt.Fprintln(stderr, "piwork: browser initialization failed")
		return 1
	}
	browserServer := &http.Server{Handler: web, ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 31 * time.Minute, IdleTimeout: 90 * time.Second, MaxHeaderBytes: 32 << 10,
		BaseContext: func(net.Listener) context.Context { return ctx }}
	if tlsConfig != nil {
		browserListener = tls.NewListener(browserListener, tlsConfig)
	}
	browserDone := make(chan error, 1)
	// Both listeners and the installation lock are acquired before recovery or
	// requests are admitted. There is one shutdown owner and one total budget.
	if ctx.Err() != nil {
		_ = closeApplication(core, web, browserServer)
		return 0
	}
	if err := core.Serve(); err != nil {
		_ = closeApplication(core, web, browserServer)
		return 1
	}
	go func() { browserDone <- browserServer.Serve(browserListener) }()
	if json.NewEncoder(stdout).Encode(map[string]any{"event": "app.listening", "url": origin, "coreUrl": coreURL, "pid": os.Getpid(), "dataDirectory": *directory}) != nil {
		_ = closeApplication(core, web, browserServer)
		return 1
	}

	if !*noOpen && (os.Getenv("DISPLAY") != "" || os.Getenv("WAYLAND_DISPLAY") != "") {
		go openBrowser(ctx, origin, stderr)
	}
	return awaitApplication(ctx, core, web, browserServer, browserDone, stderr)
}

// Both servers have one supervisor. Any unexpected serving exit withdraws the
// other entry and closes this installation through the same bounded path.
func awaitApplication(ctx context.Context, core *coreapp.Application, web *webapp.Server, browserServer *http.Server, browserDone <-chan error, stderr io.Writer) int {
	var serveErr error
	select {
	case <-ctx.Done():
	case serveErr = <-core.ServeDone():
		if serveErr == nil {
			serveErr = errors.New("Core listener ended")
		}
	case serveErr = <-browserDone:
		if serveErr == nil {
			serveErr = errors.New("browser listener ended")
		}
	}
	if closeApplication(core, web, browserServer) != nil {
		fmt.Fprintln(stderr, "piwork: shutdown was not confirmed")
		return 1
	}
	if serveErr != nil {
		fmt.Fprintln(stderr, "piwork: HTTP listener stopped unexpectedly")
		return 1
	}
	return 0
}

// Web resource cleanup and Core workload shutdown share the total budget.
// Large transfer spool deletion must not postpone stopping managed Works.
func closeApplication(core *coreapp.Application, web *webapp.Server, servers ...*http.Server) error {
	closing, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	webDone := make(chan struct{})
	go func() {
		if web != nil {
			web.Close()
		}
		for _, server := range servers {
			_ = server.Close()
		}
		close(webDone)
	}()
	err := core.Close(closing)
	select {
	case <-webDone:
	case <-closing.Done():
		return errors.New("browser cleanup was not confirmed")
	}
	return err
}

// Wildcards bind interfaces; backend requests use a concrete local address.
func backendOrigin(address coreapp.ListenAddress) string {
	if ip := net.ParseIP(address.Host); ip != nil && ip.IsUnspecified() {
		if ip.To4() != nil {
			address.Host = "127.0.0.1"
		} else {
			address.Host = "::1"
		}
	}
	return address.URL()
}

func browserOrigin(address coreapp.ListenAddress, secure bool) string {
	host := address.Host
	if ip := net.ParseIP(host); ip != nil && ip.IsUnspecified() {
		host = "127.0.0.1"
		interfaces, _ := net.Interfaces()
		for _, device := range interfaces {
			if device.Flags&net.FlagUp == 0 || device.Flags&net.FlagLoopback != 0 || strings.HasPrefix(device.Name, "br-") || strings.HasPrefix(device.Name, "docker") || strings.HasPrefix(device.Name, "veth") {
				continue
			}
			addresses, _ := device.Addrs()
			for _, item := range addresses {
				if network, ok := item.(*net.IPNet); ok && network.IP.To4() != nil && network.IP.IsPrivate() {
					host = network.IP.String()
					break
				}
			}
			if host != "127.0.0.1" {
				break
			}
		}
	}
	scheme := "http"
	if secure {
		scheme = "https"
	}
	return scheme + "://" + net.JoinHostPort(host, fmt.Sprint(address.Port))
}

func openBrowser(parent context.Context, address string, stderr io.Writer) {
	ctx, cancel := context.WithTimeout(parent, 10*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, "xdg-open", address)
	command.Stdout, command.Stderr = io.Discard, io.Discard
	if command.Run() != nil && parent.Err() == nil {
		fmt.Fprintf(stderr, "Could not open a browser. Open %s manually.\n", address)
	}
}
