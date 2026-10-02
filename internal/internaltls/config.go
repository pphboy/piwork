package internaltls

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strconv"

	"piwork/internal/contracts"
)

const AgentCAPath = "/etc/piwork/tls/installation-ca.crt"
const AgentCertificatePath = "/etc/piwork/tls/agent-server.crt"
const AgentKeyPath = "/etc/piwork/tls/agent-server.key"

type ControlConfig struct {
	ServiceControl struct {
		Endpoint              string `json:"endpoint"`
		ServerName            string `json:"serverName"`
		CACertificatePath     string `json:"caCertificatePath"`
		ClientCertificatePath string `json:"clientCertificatePath"`
		ClientPrivateKeyPath  string `json:"clientPrivateKeyPath"`
	} `json:"serviceControl"`
}

// WriteAgentConfig accepts the retained v1 wire contract and fixed Agent mount
// paths. Model credentials remain a separate read-only secret file.
func (m *Manager) WriteAgentConfig(ctx context.Context, scope Scope, config contracts.AgentRuntimeConfig) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed || !scope.valid(true) || scope.InstallationID != m.store.InstallationID() || config.WorkId != scope.WorkID || config.Generation != scope.Generation || config.InstanceId != scope.InstanceID || config.Version != 1 || config.Listen != "0.0.0.0:7443" || config.DataDirectory != "/var/data" || config.Tls.CaCertificatePath != AgentCAPath || config.Tls.ServerCertificatePath != AgentCertificatePath || config.Tls.ServerPrivateKeyPath != AgentKeyPath || config.Tls.ExpectedClientCommonName != scope.commonName(CoreClient) {
		return "", ErrIdentity
	}
	if config.ContextConfigPath.Present && (config.ContextConfigPath.Null || config.ContextConfigPath.Value != "/run/piwork/config.json") || config.AgentsMdPath.Present && (config.AgentsMdPath.Null || config.AgentsMdPath.Value != "/run/piwork/AGENTS.md") || config.Model.CredentialPath.Present && (config.Model.CredentialPath.Null || config.Model.CredentialPath.Value != "/run/secrets/model-api-key") {
		return "", ErrIdentity
	}
	raw, err := json.Marshal(config)
	if err != nil {
		return "", ErrMaterial
	}
	if _, err := contracts.Decode[contracts.AgentRuntimeConfig](bytes.NewReader(raw), "AgentRuntimeConfigSchema", 1<<20); err != nil {
		return "", ErrMaterial
	}
	return m.writeConfig(ctx, scope, "agent-config.json", raw)
}

func (m *Manager) WriteServiceControlConfig(ctx context.Context, scope Scope, endpoint string) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed || !scope.valid(true) || scope.InstallationID != m.store.InstallationID() || len(endpoint) == 0 || len(endpoint) > 2048 {
		return "", ErrIdentity
	}
	host, port, err := net.SplitHostPort(endpoint)
	number, parseErr := strconv.ParseUint(port, 10, 16)
	if err != nil || parseErr != nil || number == 0 || host == "" {
		return "", ErrIdentity
	}
	// The endpoint is selected by Core; the helper receives no caller-selected
	// TLS names, file paths, or runtime principal.
	var config ControlConfig
	config.ServiceControl.Endpoint = endpoint
	config.ServiceControl.ServerName = "piwork-core"
	config.ServiceControl.CACertificatePath = "/etc/piwork/control/installation-ca.crt"
	config.ServiceControl.ClientCertificatePath = "/etc/piwork/control/agent-service-client.crt"
	config.ServiceControl.ClientPrivateKeyPath = "/etc/piwork/control/agent-service-client.key"
	raw, _ := json.Marshal(config)
	return m.writeConfig(ctx, scope, "service-control.json", raw)
}

// WriteModelCredential publishes a generation-owned, read-only bind source.
// The host directories stay private; only the individual file is readable by
// the fixed container UID. A generation cannot silently change credentials.
func (m *Manager) WriteModelCredential(ctx context.Context, scope Scope, credential []byte) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed || !scope.valid(true) || scope.InstallationID != m.store.InstallationID() || len(credential) == 0 || len(credential) > 65536 || bytes.IndexByte(credential, 0) >= 0 || ctx.Err() != nil {
		return "", ErrMaterial
	}
	if _, _, _, err := m.generation(ctx, scope); err != nil {
		return "", err
	}
	work, err := m.root.OpenDirectory(scope.WorkID)
	if err != nil {
		return "", ErrMaterial
	}
	defer work.Close()
	name := fmt.Sprintf("tls-generation-%d", scope.Generation)
	root, err := work.OpenDirectory(name)
	if err != nil {
		return "", ErrMaterial
	}
	defer root.Close()
	data := append(bytes.TrimRight(append([]byte(nil), credential...), "\r\n"), '\n')
	const file = "model-credential.secret"
	prior, err := root.ReadMaterial(file, 65537, 0644)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return "", ErrMaterial
	}
	if err == nil {
		if !bytes.Equal(prior, data) {
			return "", ErrMaterial
		}
		return filepath.Join(m.directory, scope.WorkID, name, file), nil
	}
	if err := m.publish(root, []publication{{name: file, value: data, mode: 0644}}); err != nil {
		return "", err
	}
	return filepath.Join(m.directory, scope.WorkID, name, file), nil
}

func (m *Manager) writeConfig(ctx context.Context, scope Scope, name string, raw []byte) (string, error) {
	if ctx.Err() != nil {
		return "", ctx.Err()
	}
	root, err := m.root.OpenDirectory(scope.WorkID)
	if err != nil {
		return "", ErrMaterial
	}
	defer root.Close()
	prior, err := root.ReadMaterial(name, 1<<20, 0644)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return "", ErrMaterial
	}
	if err == nil {
		if _, err := contracts.ParseJSON(bytes.NewReader(prior), 1<<20); err != nil {
			return "", ErrMaterial
		}
	}
	if err := m.publish(root, []publication{{name, append(raw, '\n'), prior, 0644}}); err != nil {
		return "", err
	}
	return filepath.Join(m.directory, scope.WorkID, name), nil
}
