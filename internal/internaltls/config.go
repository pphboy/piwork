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
	"slices"
	"strconv"

	"piwork/internal/contracts"
	"piwork/internal/safefs"
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

// ModelCredentialState describes a safely inspected generation material file.
type ModelCredentialState uint8

const (
	ModelCredentialUnpublished ModelCredentialState = iota
	ModelCredentialSame
	ModelCredentialChanged
)

// ExistingAgentFiles contains validated paths and non-secret configuration for
// inspecting an already running Agent. It never returns credential bytes.
type ExistingAgentFiles struct {
	Identity          GenerationIdentity
	AgentConfigPath   string
	ServiceConfigPath string
	CredentialPath    string
	AgentConfig       contracts.AgentRuntimeConfig
	ServiceConfig     ControlConfig
}

func (m *Manager) ExistingAgentFiles(ctx context.Context, scope Scope) (ExistingAgentFiles, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var result ExistingAgentFiles
	if m.closed || ctx.Err() != nil || !scope.valid(true) || scope.InstallationID != m.store.InstallationID() {
		return result, ErrIdentity
	}
	_, durable, err := m.decode(ctx, fmt.Sprintf("internal_tls/generation/%s/%d", scope.WorkID, scope.Generation), scope, []string{AgentServer, CoreClient, AgentServiceClient})
	if err != nil || len(durable) == 0 {
		return result, ErrMaterial
	}
	work, exists, err := openExistingPrivateChild(m.root, scope.WorkID)
	if err != nil || !exists {
		return result, ErrMaterial
	}
	defer work.Close()
	raw, err := work.ReadMaterial("agent-config.json", 1<<20, 0644)
	if err != nil {
		return result, ErrMaterial
	}
	config, err := contracts.Decode[contracts.AgentRuntimeConfig](bytes.NewReader(raw), "AgentRuntimeConfigSchema", 1<<20)
	if err != nil || config.WorkId != scope.WorkID || config.Generation != scope.Generation || config.InstanceId != scope.InstanceID {
		return result, ErrIdentity
	}
	serviceRaw, err := work.ReadMaterial("service-control.json", 1<<20, 0644)
	if err != nil {
		return result, ErrMaterial
	}
	decoder := json.NewDecoder(bytes.NewReader(serviceRaw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&result.ServiceConfig) != nil {
		return ExistingAgentFiles{}, ErrMaterial
	}
	name := fmt.Sprintf("tls-generation-%d", scope.Generation)
	root, exists, err := openExistingPrivateChild(work, name)
	if err != nil || !exists {
		return ExistingAgentFiles{}, ErrMaterial
	}
	defer root.Close()
	directory := filepath.Join(m.directory, scope.WorkID, name)
	if config.Model.CredentialPath.Present {
		if config.Model.CredentialPath.Null || config.Model.CredentialPath.Value != "/run/secrets/model-api-key" {
			return ExistingAgentFiles{}, ErrIdentity
		}
		prior, err := root.ReadMaterial("model-credential.secret", 65537, 0644)
		if err != nil {
			return ExistingAgentFiles{}, ErrMaterial
		}
		canonical, err := normalizedModelCredential(bytes.TrimSuffix(prior, []byte{'\n'}))
		if err != nil || !bytes.Equal(prior, canonical) {
			return ExistingAgentFiles{}, ErrMaterial
		}
		result.CredentialPath = filepath.Join(directory, "model-credential.secret")
	}
	result.AgentConfig = config
	result.AgentConfigPath = filepath.Join(m.directory, scope.WorkID, "agent-config.json")
	result.ServiceConfigPath = filepath.Join(m.directory, scope.WorkID, "service-control.json")
	result.Identity = GenerationIdentity{Scope: scope, CACertificatePath: filepath.Join(m.directory, "pki", "installation-ca.crt"), ServerCertificatePath: filepath.Join(directory, "agent-server.crt"), ServerPrivateKeyPath: filepath.Join(directory, "agent-server.key"), ClientCertificatePath: filepath.Join(directory, "core-client.crt"), ClientPrivateKeyPath: filepath.Join(directory, "core-client.key"), ServiceClientCertificatePath: filepath.Join(directory, "agent-service-client.crt"), ServiceClientPrivateKeyPath: filepath.Join(directory, "agent-service-client.key"), ServerName: scope.commonName(AgentServer), ClientCommonName: scope.commonName(CoreClient)}
	return result, nil
}

func normalizedModelCredential(credential []byte) ([]byte, error) {
	if len(credential) == 0 || len(credential) > 65536 || bytes.IndexByte(credential, 0) >= 0 {
		return nil, ErrMaterial
	}
	trimmed := bytes.TrimRight(credential, "\r\n")
	if len(trimmed) == 0 {
		return nil, ErrMaterial
	}
	return append(append([]byte(nil), trimmed...), '\n'), nil
}

// openExistingPrivateChild does not create or repair missing directories.
// A failed open after a positive directory lookup remains an unsafe error.
func openExistingPrivateChild(root *safefs.Root, name string) (*safefs.Root, bool, error) {
	entries, err := root.Entries()
	if err != nil {
		return nil, false, ErrMaterial
	}
	if !slices.Contains(entries, name) {
		return nil, false, nil
	}
	child, err := root.OpenPrivateDirectory(name)
	if err != nil {
		return nil, false, ErrMaterial
	}
	return child, true, nil
}

// CheckModelCredential compares a proposed launch credential without creating,
// repairing, or publishing any generation material. The caller must separately
// determine whether unpublished material is expected for the generation.
func (m *Manager) CheckModelCredential(ctx context.Context, scope Scope, credential []byte) (ModelCredentialState, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed || !scope.valid(true) || scope.InstallationID != m.store.InstallationID() || ctx.Err() != nil {
		return ModelCredentialUnpublished, ErrMaterial
	}
	data, err := normalizedModelCredential(credential)
	if err != nil {
		return ModelCredentialUnpublished, err
	}
	_, durable, err := m.decode(ctx, fmt.Sprintf("internal_tls/generation/%s/%d", scope.WorkID, scope.Generation), scope, []string{AgentServer, CoreClient, AgentServiceClient})
	if err != nil {
		return ModelCredentialUnpublished, err
	}
	work, exists, err := openExistingPrivateChild(m.root, scope.WorkID)
	if err != nil || !exists {
		return ModelCredentialUnpublished, err
	}
	defer work.Close()
	root, exists, err := openExistingPrivateChild(work, fmt.Sprintf("tls-generation-%d", scope.Generation))
	if err != nil || !exists {
		return ModelCredentialUnpublished, err
	}
	defer root.Close()
	prior, err := root.ReadMaterial("model-credential.secret", 65537, 0644)
	if errors.Is(err, os.ErrNotExist) {
		return ModelCredentialUnpublished, nil
	}
	if err != nil || len(durable) == 0 {
		return ModelCredentialUnpublished, ErrMaterial
	}
	canonical, err := normalizedModelCredential(bytes.TrimSuffix(prior, []byte{'\n'}))
	if err != nil || !bytes.Equal(prior, canonical) {
		return ModelCredentialUnpublished, ErrMaterial
	}
	if bytes.Equal(prior, data) {
		return ModelCredentialSame, nil
	}
	return ModelCredentialChanged, nil
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
	if m.closed || !scope.valid(true) || scope.InstallationID != m.store.InstallationID() || ctx.Err() != nil {
		return "", ErrMaterial
	}
	data, err := normalizedModelCredential(credential)
	if err != nil {
		return "", err
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
