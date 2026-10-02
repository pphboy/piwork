package dockerengine

import (
	"context"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/moby/moby/client"
)

var probeTransport = &http.Transport{Proxy: nil, DialContext: (&net.Dialer{Timeout: 2 * time.Second, KeepAlive: 30 * time.Second}).DialContext, MaxIdleConns: 16, MaxIdleConnsPerHost: 2, IdleConnTimeout: 30 * time.Second, ResponseHeaderTimeout: 2 * time.Second, MaxResponseHeaderBytes: 32768}
var probeHTTP = &http.Client{Transport: probeTransport, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}

type Probe struct {
	Kind, NetworkName, Path string
	Port                    int
	Command                 []string
	Timeout                 time.Duration
}

// ContainerAddress derives a target only from current inspected ownership and a
// matching Work bridge; callers cannot supply an IP or external proxy target.
func (r *Runtime) ContainerAddress(ctx context.Context, identity ContainerIdentity, networkName string) (string, error) {
	view, err := r.findContainer(ctx, identity)
	if err != nil {
		return "", err
	}
	if view == nil {
		return "", ErrResourceMissing
	}
	if view.State == nil || !view.State.Running || view.NetworkSettings == nil {
		return "", ErrStateUnknown
	}
	bridge, err := r.inspectNetwork(ctx, networkName, identity.WorkID)
	if err != nil {
		return "", err
	}
	endpoint, ok := view.NetworkSettings.Networks[bridge.Name]
	if !ok || endpoint == nil || endpoint.NetworkID != bridge.ID {
		return "", ErrIdentity
	}
	ip := endpoint.IPAddress
	if !ip.IsValid() || !ip.Is4() || ip.IsLoopback() || ip.IsUnspecified() {
		return "", ErrIdentity
	}
	return ip.String(), nil
}
func (r *Runtime) Probe(ctx context.Context, identity ContainerIdentity, probe Probe) (bool, error) {
	timeout := probe.Timeout
	if timeout == 0 {
		timeout = 2 * time.Second
	}
	if timeout <= 0 || timeout > 2*time.Second {
		return false, ErrSpecification
	}
	request, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	if probe.Kind == "exec" {
		return r.probeExec(request, identity, probe.Command)
	}
	if (probe.Kind != "http" && probe.Kind != "tcp") || probe.Port < 1 || probe.Port > 65535 || probe.NetworkName == "" {
		return false, ErrSpecification
	}
	address, err := r.ContainerAddress(request, identity, probe.NetworkName)
	if err != nil {
		return false, err
	}
	target := net.JoinHostPort(address, strconv.Itoa(probe.Port))
	if probe.Kind == "tcp" {
		connection, err := (&net.Dialer{}).DialContext(request, "tcp", target)
		if err != nil {
			return false, nil
		}
		connection.Close()
		return true, nil
	}
	path, err := url.ParseRequestURI(probe.Path)
	if err != nil || path.IsAbs() || path.Host != "" || !strings.HasPrefix(probe.Path, "/") || strings.HasPrefix(probe.Path, "//") || len(probe.Path) > 2048 {
		return false, ErrSpecification
	}
	req, err := http.NewRequestWithContext(request, http.MethodGet, "http://"+target+probe.Path, nil)
	if err != nil {
		return false, ErrSpecification
	}
	response, err := probeHTTP.Do(req)
	if err != nil {
		return false, nil
	}
	defer response.Body.Close()
	// Readiness is determined from status, never from an unbounded response body.
	return response.StatusCode >= 200 && response.StatusCode < 300, nil
}
func (r *Runtime) probeExec(ctx context.Context, identity ContainerIdentity, command []string) (bool, error) {
	if len(command) == 0 || len(command) > 128 {
		return false, ErrSpecification
	}
	for _, arg := range command {
		if len(arg) == 0 || len(arg) > 4096 || strings.ContainsRune(arg, 0) {
			return false, ErrSpecification
		}
	}
	view, err := r.findContainer(ctx, identity)
	if err != nil {
		return false, err
	}
	if view == nil {
		return false, ErrResourceMissing
	}
	if view.State == nil || !view.State.Running {
		return false, ErrStateUnknown
	}
	created, err := r.engine.api.ExecCreate(ctx, view.ID, client.ExecCreateOptions{Cmd: command, AttachStdout: true, AttachStderr: true})
	if err != nil {
		return false, runtimeError(err)
	}
	attached, err := r.engine.api.ExecAttach(ctx, created.ID, client.ExecAttachOptions{})
	if err != nil {
		return false, runtimeError(err)
	}
	defer attached.Close()
	stop := context.AfterFunc(ctx, func() { attached.Close() })
	defer stop()
	if err := Demultiplex(ctx, attached.Reader, io.Discard, newTail(65536)); err != nil {
		if ctx.Err() != nil {
			return false, nil
		}
		return false, err
	}
	result, err := r.engine.api.ExecInspect(ctx, created.ID, client.ExecInspectOptions{})
	if err != nil {
		return false, runtimeError(err)
	}
	if result.ContainerID != view.ID {
		return false, ErrIdentity
	}
	return !result.Running && result.ExitCode == 0, nil
}
