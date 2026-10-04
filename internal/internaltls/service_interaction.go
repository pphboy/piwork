package internaltls

import (
	"context"
	"encoding/json"
	"path/filepath"
	"regexp"

	"piwork/internal/safefs"
)

var serviceToken = regexp.MustCompile(`^[a-f0-9]{64}$`)

// Service interaction secrets live outside exported Work volumes. Each token
// has its own immutable bind source so a recreated container cannot inherit a
// replaced file inode from a prior instance.
func (m *Manager) WriteServiceInteractionConfig(ctx context.Context, workID, serviceID, name, token string) (string, string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed || !safefs.ValidFileName(workID) || !safefs.ValidFileName(serviceID) || !safefs.ValidFileName(name) || !serviceToken.MatchString(token) || ctx.Err() != nil {
		return "", "", ErrIdentity
	}
	ca, err := m.authority(ctx)
	if err != nil {
		return "", "", err
	}
	if err = m.root.EnsureDirectory(workID); err != nil {
		return "", "", ErrMaterial
	}
	work, err := m.root.OpenDirectory(workID)
	if err != nil {
		return "", "", ErrMaterial
	}
	defer work.Close()
	dir := "service-interaction-" + serviceID
	if err = work.EnsureDirectory(dir); err != nil {
		return "", "", ErrMaterial
	}
	root, err := work.OpenDirectory(dir)
	if err != nil {
		return "", "", ErrMaterial
	}
	defer root.Close()
	raw, err := json.Marshal(struct {
		ContractVersion int    `json:"contractVersion"`
		WorkID          string `json:"workId"`
		ServiceID       string `json:"serviceId"`
		ServiceName     string `json:"serviceName"`
		Token           string `json:"token"`
		AgentURL        string `json:"agentUrl"`
		CAPath          string `json:"caPath"`
	}{1, workID, serviceID, name, token, "https://agentd:7444", "/etc/piwork/interaction/installation-ca.crt"})
	if err != nil {
		return "", "", ErrMaterial
	}
	file := "config-" + token + ".json"
	if err = m.publish(root, []publication{{name: file, value: append(raw, '\n'), mode: 0644}, {name: "installation-ca.crt", value: []byte(ca.Certificate), mode: 0644}}); err != nil {
		return "", "", err
	}
	base := filepath.Join(m.directory, workID, dir)
	return filepath.Join(base, file), filepath.Join(base, "installation-ca.crt"), nil
}
