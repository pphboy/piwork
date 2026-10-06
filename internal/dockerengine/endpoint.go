// Package dockerengine talks directly to the selected local Docker Engine.
// No command runner, credential helper, or alternate endpoint is used.
package dockerengine

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/containerd/errdefs"
	"github.com/moby/moby/client"
	"piwork/internal/contracts"
)

var ErrConfiguration = errors.New("Docker configuration is invalid")
var ErrUnknownContext = errors.New("selected Docker context is unavailable")
var ErrEndpoint = errors.New("Docker requires a local Unix socket endpoint")
var ErrUnavailable = errors.New("selected Docker Engine is unavailable")
var ErrAPIVersion = errors.New("Docker Engine API version is unsupported")
var ErrRegistryAuth = errors.New("Docker registry authentication is invalid")
var ErrCredentialHelper = errors.New("Docker registry credential helpers are unsupported")
var ErrImageReference = errors.New("Docker image reference is invalid")

type SelectionOptions struct{ DockerContext, DockerHost, DockerConfig, HomeDirectory string }
type Endpoint struct{ Host, Source, ContextName, ConfigDirectory string }

func EnvironmentOptions() SelectionOptions {
	home, _ := os.UserHomeDir()
	return SelectionOptions{DockerContext: os.Getenv("DOCKER_CONTEXT"), DockerHost: os.Getenv("DOCKER_HOST"), DockerConfig: os.Getenv("DOCKER_CONFIG"), HomeDirectory: home}
}

type dockerConfig struct {
	CurrentContext string                `json:"currentContext"`
	Auths          map[string]staticAuth `json:"auths"`
	CredsStore     string                `json:"credsStore"`
	CredHelpers    map[string]string     `json:"credHelpers"`
}

func readDockerJSON(path string, out any) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	value, err := contracts.ParseJSON(file, 4<<20)
	if err != nil {
		return ErrConfiguration
	}
	if _, ok := value.(map[string]any); !ok {
		return ErrConfiguration
	}
	data, err := json.Marshal(value)
	if err != nil {
		return ErrConfiguration
	}
	if json.Unmarshal(data, out) != nil {
		return ErrConfiguration
	}
	return nil
}
func readDockerConfig(directory string) (dockerConfig, error) {
	var config dockerConfig
	err := readDockerJSON(filepath.Join(directory, "config.json"), &config)
	if errors.Is(err, os.ErrNotExist) {
		return config, nil
	}
	if err != nil {
		return config, ErrConfiguration
	}
	return config, nil
}
func ValidateLocalEndpoint(value string) (string, error) {
	endpoint, err := url.Parse(value)
	if err != nil || endpoint.Scheme != "unix" || endpoint.Host != "" || endpoint.User != nil || endpoint.RawQuery != "" || endpoint.ForceQuery || endpoint.Fragment != "" || !filepath.IsAbs(endpoint.Path) || endpoint.Path == "/" || strings.ContainsAny(endpoint.Path, "\x00\r\n") {
		return "", ErrEndpoint
	}
	return "unix://" + filepath.Clean(endpoint.Path), nil
}
func SelectEndpoint(options SelectionOptions) (Endpoint, error) {
	directory := options.DockerConfig
	if directory == "" {
		if options.HomeDirectory == "" {
			return Endpoint{}, ErrConfiguration
		}
		directory = filepath.Join(options.HomeDirectory, ".docker")
	}
	absolute, err := filepath.Abs(directory)
	if err != nil {
		return Endpoint{}, ErrConfiguration
	}
	endpoint := Endpoint{ConfigDirectory: absolute}
	name := options.DockerContext
	switch {
	case name != "":
		endpoint.Source = "DOCKER_CONTEXT"
	case options.DockerHost != "":
		endpoint.Source = "DOCKER_HOST"
		endpoint.Host, err = ValidateLocalEndpoint(options.DockerHost)
		return endpoint, err
	default:
		config, configErr := readDockerConfig(absolute)
		if configErr != nil {
			return Endpoint{}, configErr
		}
		name = config.CurrentContext
		endpoint.Source = "currentContext"
	}
	if name == "" || name == "default" {
		endpoint.Host = "unix:///var/run/docker.sock"
		endpoint.ContextName = "default"
		if name == "" {
			endpoint.Source = "default"
		}
		return endpoint, nil
	}
	if len(name) > 256 || strings.ContainsAny(name, "\x00\r\n") {
		return Endpoint{}, ErrUnknownContext
	}
	key := sha256.Sum256([]byte(name))
	metadataPath := filepath.Join(absolute, "contexts", "meta", hex.EncodeToString(key[:]), "meta.json")
	var metadata struct {
		Name      string
		Endpoints map[string]struct {
			Host          string
			SkipTLSVerify bool
		}
	}
	if err := readDockerJSON(metadataPath, &metadata); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return Endpoint{}, ErrUnknownContext
		}
		return Endpoint{}, ErrConfiguration
	}
	if metadata.Name != name {
		return Endpoint{}, ErrConfiguration
	}
	selected, ok := metadata.Endpoints["docker"]
	if !ok {
		return Endpoint{}, ErrConfiguration
	}
	endpoint.Host, err = ValidateLocalEndpoint(selected.Host)
	endpoint.ContextName = name
	return endpoint, err
}

type Engine struct {
	api        *client.Client
	Endpoint   Endpoint
	APIVersion string
}

func Connect(ctx context.Context, endpoint Endpoint) (*Engine, error) {
	host, err := ValidateLocalEndpoint(endpoint.Host)
	if err != nil {
		return nil, err
	}
	// Deliberately do not use FromEnv: endpoint precedence and API negotiation are
	// controlled here, rather than by Docker CLI/global environment overrides.
	api, err := client.NewClientWithOpts(client.WithHost(host), client.WithAPIVersionNegotiation())
	if err != nil {
		return nil, ErrConfiguration
	}
	fail := func(err error) (*Engine, error) { api.Close(); return nil, err }
	handshake, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	ping, err := api.Ping(handshake, client.PingOptions{NegotiateAPIVersion: true})
	if err != nil {
		if errdefs.IsInvalidArgument(err) {
			return fail(ErrAPIVersion)
		}
		return fail(ErrUnavailable)
	}
	if ping.APIVersion == "" {
		return fail(ErrAPIVersion)
	}
	version, err := api.ServerVersion(handshake, client.ServerVersionOptions{})
	if err != nil {
		return fail(ErrAPIVersion)
	}
	supported, err := parseAPIVersion(api.ClientVersion())
	if err != nil {
		return fail(ErrAPIVersion)
	}
	server, err := parseAPIVersion(version.APIVersion)
	if err != nil {
		return fail(ErrAPIVersion)
	}
	minimum, err := parseAPIVersion(version.MinAPIVersion)
	if err != nil {
		return fail(ErrAPIVersion)
	}
	if minimum > supported || minimum > server || server < supported || version.Os != "linux" {
		return fail(ErrAPIVersion)
	}
	return &Engine{api: api, Endpoint: endpoint, APIVersion: api.ClientVersion()}, nil
}
func (e *Engine) Close() error { return e.api.Close() }

// Ping uses the already selected endpoint without renegotiation or fallback.
// Callers set their own short liveness deadline independently of image pulls.
func (e *Engine) Ping(ctx context.Context) error {
	if _, err := e.api.Ping(ctx, client.PingOptions{}); err != nil {
		return ErrUnavailable
	}
	return nil
}
