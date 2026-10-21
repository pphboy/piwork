// Package app owns the unified Linux server's single startup and shutdown.
package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"piwork/internal/buildinfo"
	"piwork/internal/clientfs"
	"piwork/internal/coreapp"
	"piwork/internal/corestore"
	"piwork/internal/distribution"
	"piwork/internal/dockerengine"
	"piwork/internal/localweb"
	"piwork/internal/safefs"
	"piwork/internal/webapp"
)

const coreHelp = `Usage: piwork-core [OPTIONS]
Start Core, the browser workbench, administration, and first-time setup.

  --ui-port PORT    HTTP UI port, default 17891
  --core-port PORT  HTTP Core API port, default 17871
  --data-dir DIR    default user config directory/piwork/server
  --help, -h        show help
  --version         show build identity

Both HTTP services accept local and remote connections. Internal Agent mTLS
uses port 7172. Configure users, models and runtime in the browser.
Optional PIWORK_ADMIN_ACCOUNT and PIWORK_ADMIN_PASSWORD initialize only the
first administrator. User commands and Desktop: piwork-cli.
`

type startupOptions struct {
	uiPort, corePort int
	directory        string
}

// Parse the entire command before filesystem, credentials or network access.
// Diagnostics deliberately never echo option values (which may be secrets).
func parseStartup(args []string) (startupOptions, error) {
	options := startupOptions{uiPort: 17891, corePort: 17871}
	seen := map[string]bool{}
	for i := 0; i < len(args); i++ {
		name, value, inline := strings.Cut(args[i], "=")
		if name != "--ui-port" && name != "--core-port" && name != "--data-dir" || seen[name] {
			return options, errors.New("invalid startup options")
		}
		seen[name] = true
		if !inline {
			i++
			if i == len(args) {
				return options, errors.New("missing startup value")
			}
			value = args[i]
			if strings.HasPrefix(value, "--") || value == "-h" {
				return options, errors.New("missing startup value")
			}
		}
		if value == "" {
			return options, errors.New("empty startup value")
		}
		if name == "--data-dir" {
			options.directory = value
			continue
		}
		for _, c := range value {
			if c < '0' || c > '9' {
				return options, errors.New("invalid port")
			}
		}
		port, err := strconv.Atoi(value)
		if err != nil || port < 1 || port > 65535 || port == 7172 {
			return options, errors.New("invalid port")
		}
		if name == "--ui-port" {
			options.uiPort = port
		} else {
			options.corePort = port
		}
	}
	if options.uiPort == options.corePort {
		return options, errors.New("ports must differ")
	}
	return options, nil
}

func Run(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	if len(args) == 1 {
		switch args[0] {
		case "--help", "-h":
			fmt.Fprint(stdout, coreHelp)
			return 0
		case "--version":
			if json.NewEncoder(stdout).Encode(buildinfo.Read("piwork-core")) != nil {
				return 1
			}
			return 0
		}
	}
	options, err := parseStartup(args)
	if err != nil {
		fmt.Fprintln(stderr, "piwork-core: invalid startup options; use --help (user commands: piwork-cli)")
		return 2
	}
	return start(ctx, options, stdout, stderr)
}

func defaultDirectory() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(base, "piwork", "server"), nil
}

func start(ctx context.Context, options startupOptions, stdout, stderr io.Writer) int {
	directory := options.directory
	var err error
	if directory == "" {
		directory, err = defaultDirectory()
		if err != nil {
			fmt.Fprintln(stderr, "piwork-core: default data directory is unavailable")
			return 1
		}
	}
	directory, err = filepath.Abs(directory)
	if err != nil {
		fmt.Fprintln(stderr, "piwork-core: data directory is invalid")
		return 2
	}
	address := coreapp.ListenAddress{Host: "0.0.0.0", Port: options.uiPort}
	coreAddress := coreapp.ListenAddress{Host: "0.0.0.0", Port: options.corePort}
	defaults, err := distribution.Defaults()
	if err != nil {
		fmt.Fprintln(stderr, "piwork-core: embedded release dependencies are invalid")
		return 1
	}
	admin := map[string]string{}
	for _, name := range []string{"PIWORK_ADMIN_ACCOUNT", "PIWORK_ADMIN_PASSWORD"} {
		if value, ok := os.LookupEnv(name); ok {
			admin[name] = value
		}
	}
	initialization, err := coreapp.InitializationFromEnvironment(admin)
	if err != nil {
		fmt.Fprintln(stderr, "piwork-core:", err)
		return 2
	}
	if ctx.Err() != nil {
		return 0
	}
	home, _ := os.UserHomeDir()
	// Core deliberately creates only its final directory. Prepare missing
	// parents without following symlinks, including on a fresh user account.
	parent, err := clientfs.EnsureDirectory(filepath.Dir(directory))
	if err != nil {
		fmt.Fprintln(stderr, "piwork-core: data directory parent is unavailable or unsafe")
		return 1
	}
	_ = parent.Close()
	setupSecret, err := localweb.Secret()
	if err != nil {
		fmt.Fprintln(stderr, "piwork-core: startup identity unavailable")
		return 1
	}
	core, err := coreapp.New(ctx, coreapp.Options{DataDirectory: directory, Initialization: initialization, SetupSecret: setupSecret, Stdout: stdout, Stderr: stderr,
		PackageHelperImage: defaults.PackageHelper, FileHelperImage: defaults.FileHelper, SnapshotHelperImage: defaults.SnapshotHelper,
		AgentGRPCListen: "0.0.0.0:7172", AgentGRPCAdvertise: "piwork-core:7172",
		DockerOptions: dockerengine.SelectionOptions{DockerHost: os.Getenv("DOCKER_HOST"), DockerContext: os.Getenv("DOCKER_CONTEXT"), DockerConfig: os.Getenv("DOCKER_CONFIG"), HomeDirectory: home}})
	if err != nil {
		switch {
		case errors.Is(err, safefs.ErrLocked):
			fmt.Fprintln(stderr, "piwork-core: another Core owns this data directory")
		case errors.Is(err, corestore.ErrUnsupported):
			fmt.Fprintln(stderr, "piwork-core:", corestore.ErrUnsupported)
		default:
			fmt.Fprintln(stderr, "piwork-core: initialization failed; verify private data and PIWORK_ADMIN_ACCOUNT/PIWORK_ADMIN_PASSWORD")
		}
		return 1
	}
	if err := core.BindRPC(ctx); err != nil {
		_ = closeApplication(core, nil)
		fmt.Fprintln(stderr, "piwork-core: Agent RPC listener is unavailable")
		return 1
	}
	coreBound, err := core.Bind(coreAddress)
	if err != nil {
		_ = closeApplication(core, nil)
		fmt.Fprintln(stderr, "piwork-core: Core listener is unavailable")
		return 1
	}
	browserListener, err := net.Listen("tcp4", address.Address())
	if err != nil {
		_ = closeApplication(core, nil)
		fmt.Fprintln(stderr, "piwork-core: browser listener is unavailable")
		return 1
	}
	defer browserListener.Close()
	actual := browserListener.Addr().(*net.TCPAddr)
	origin := browserOrigin(coreapp.ListenAddress{Host: actual.IP.String(), Port: actual.Port})
	coreURL := backendOrigin(coreBound)
	web, err := webapp.New(ctx, webapp.Options{Origin: origin, CoreURL: coreURL, SetupSecret: setupSecret, DataDirectory: directory})
	if err != nil {
		_ = closeApplication(core, nil)
		fmt.Fprintln(stderr, "piwork-core: browser initialization failed")
		return 1
	}
	browserServer := &http.Server{Handler: web, ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 31 * time.Minute, IdleTimeout: 90 * time.Second, MaxHeaderBytes: 32 << 10,
		BaseContext: func(net.Listener) context.Context { return ctx }}
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
	if json.NewEncoder(stdout).Encode(map[string]any{"event": "app.listening", "url": origin, "coreUrl": coreURL, "pid": os.Getpid(), "dataDirectory": directory}) != nil {
		_ = closeApplication(core, web, browserServer)
		return 1
	}
	// The file projection deliberately omits dataDirectory while retaining the
	// same safe listening identities as the existing stdout record.
	core.RecordAppEvent("app.listening", "info", map[string]string{"url": origin, "coreUrl": coreURL, "pid": strconv.Itoa(os.Getpid())})

	if os.Getenv("DISPLAY") != "" || os.Getenv("WAYLAND_DISPLAY") != "" {
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
		fmt.Fprintln(stderr, "piwork-core: shutdown was not confirmed")
		return 1
	}
	if serveErr != nil {
		fmt.Fprintln(stderr, "piwork-core: HTTP listener stopped unexpectedly")
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

func browserOrigin(address coreapp.ListenAddress) string {
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
	return "http" + "://" + net.JoinHostPort(host, fmt.Sprint(address.Port))
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
