package internaltls

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"piwork/internal/contracts"
	"piwork/internal/safefs"
)

type MaterialStore interface {
	InstallationID() string
	TLSMaterial(context.Context, string) ([]byte, error)
	CompareTLSMaterial(context.Context, string, []byte, []byte) error
}
type bundle struct {
	Version  int                `json:"version"`
	Scope    Scope              `json:"scope"`
	Pairs    map[string]keyPair `json:"pairs"`
	Previous map[string]keyPair `json:"previous,omitempty"`
}
type Manager struct {
	mu        sync.Mutex
	store     MaterialStore
	root      *safefs.Root
	directory string
	now       func() time.Time
	closed    bool
	// Tests inject failures only after durable boundaries.
	fault func(string) error
}

type GenerationIdentity struct {
	Scope                        Scope
	CACertificatePath            string
	ServerCertificatePath        string
	ServerPrivateKeyPath         string
	ClientCertificatePath        string
	ClientPrivateKeyPath         string
	ServiceClientCertificatePath string
	ServiceClientPrivateKeyPath  string
	ServerName                   string
	ClientCommonName             string
}
type CoreIdentity struct {
	CACertificatePath     string
	ServerCertificatePath string
	ServerPrivateKeyPath  string
	ServerName            string
}

func Open(directory string, store MaterialStore) (*Manager, error) {
	if store == nil || !(Scope{InstallationID: store.InstallationID()}).valid(false) {
		return nil, ErrIdentity
	}
	directory, err := filepath.Abs(directory)
	if err != nil {
		return nil, ErrMaterial
	}
	root, err := safefs.OpenRoot(directory)
	if err != nil {
		return nil, ErrMaterial
	}
	if root.CheckPrivate() != nil || root.Lock() != nil {
		root.Close()
		return nil, ErrMaterial
	}
	return &Manager{store: store, root: root, directory: directory, now: time.Now}, nil
}
func (m *Manager) Close() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed {
		return nil
	}
	m.closed = true
	return m.root.Close()
}

// RemoveWorkMaterial discards only the deleted Work's bind-mounted runtime
// files. The installation CA and other Works remain untouched. The manager's
// locked root keeps removal fd-relative and refuses linked entries.
func (m *Manager) RemoveWorkMaterial(workID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed || !safefs.ValidFileName(workID) {
		return ErrMaterial
	}
	if err := m.root.RemoveTree(workID); err != nil && !errors.Is(err, os.ErrNotExist) {
		return ErrMaterial
	}
	return nil
}

func (m *Manager) decode(ctx context.Context, key string, scope Scope, roles []string) (bundle, []byte, error) {
	raw, err := m.store.TLSMaterial(ctx, key)
	if err != nil {
		return bundle{}, nil, ErrMaterial
	}
	if len(raw) == 0 {
		return bundle{}, nil, nil
	}
	if _, err := contracts.ParseJSON(bytes.NewReader(raw), 128<<10); err != nil {
		return bundle{}, nil, ErrMaterial
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var b bundle
	if decoder.Decode(&b) != nil || b.Version != 1 || b.Scope != scope || len(b.Pairs) != len(roles) || (len(b.Previous) != 0 && len(b.Previous) != len(roles)) {
		return bundle{}, nil, ErrMaterial
	}
	for _, role := range roles {
		if _, ok := b.Pairs[role]; !ok {
			return bundle{}, nil, ErrMaterial
		}
		if len(b.Previous) != 0 {
			if _, ok := b.Previous[role]; !ok {
				return bundle{}, nil, ErrMaterial
			}
		}
	}
	return b, raw, nil
}
func (m *Manager) persist(ctx context.Context, key string, old []byte, b bundle) error {
	raw, err := json.Marshal(b)
	if err != nil || m.store.CompareTLSMaterial(ctx, key, old, raw) != nil {
		return ErrMaterial
	}
	if m.fault != nil {
		return m.fault("bundle-committed")
	}
	return nil
}

type publication struct {
	name         string
	value, prior []byte
	mode         os.FileMode
}

// A bundle is committed before publishing its projections. A crash may leave
// files absent, old, or new, but never makes a half certificate/key pair the
// durable identity. Unknown bytes, links, owners, or modes fail closed.
func (m *Manager) publish(root *safefs.Root, files []publication) error {
	for _, file := range files {
		raw, err := root.ReadMaterial(file.name, 1<<20, file.mode)
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			return ErrMaterial
		}
		if err == nil && !bytes.Equal(raw, file.value) && (len(file.prior) == 0 || !bytes.Equal(raw, file.prior)) {
			return ErrMaterial
		}
		temp := "." + file.name + ".pending"
		pending, pendingErr := root.ReadMaterial(temp, 1<<20, 0600)
		if pendingErr != nil && !errors.Is(pendingErr, os.ErrNotExist) {
			pending, pendingErr = root.ReadMaterial(temp, 1<<20, file.mode)
		}
		if pendingErr != nil && !errors.Is(pendingErr, os.ErrNotExist) {
			return ErrMaterial
		}
		if pendingErr == nil && !bytes.HasPrefix(file.value, pending) && (len(file.prior) == 0 || !bytes.HasPrefix(file.prior, pending)) {
			return ErrMaterial
		}
	}
	for _, file := range files {
		temp := "." + file.name + ".pending"
		if _, err := root.ReadMaterial(temp, 1<<20, 0600); err == nil {
			if root.Remove(temp) != nil {
				return ErrMaterial
			}
		} else if _, err := root.ReadMaterial(temp, 1<<20, file.mode); err == nil {
			if root.Remove(temp) != nil {
				return ErrMaterial
			}
		}
		if raw, err := root.ReadMaterial(file.name, 1<<20, file.mode); err == nil && bytes.Equal(raw, file.value) {
			continue
		}
		if root.AtomicMaterialWrite(file.name, temp, file.value, file.mode) != nil {
			return ErrMaterial
		}
		if m.fault != nil {
			if err := m.fault("file-published"); err != nil {
				return err
			}
		}
	}
	return nil
}
func pairPublications(b bundle, modes map[string]os.FileMode) []publication {
	roles := make([]string, 0, len(b.Pairs))
	for role := range b.Pairs {
		roles = append(roles, role)
	}
	sort.Strings(roles)
	result := make([]publication, 0, len(roles)*2)
	for _, role := range roles {
		pair, prior := b.Pairs[role], b.Previous[role]
		mode := modes[role]
		if mode == 0 {
			mode = 0600
		}
		result = append(result, publication{role + ".crt", []byte(pair.Certificate), []byte(prior.Certificate), mode}, publication{role + ".key", []byte(pair.PrivateKey), []byte(prior.PrivateKey), mode})
	}
	return result
}
func (m *Manager) authority(ctx context.Context) (keyPair, error) {
	scope := Scope{InstallationID: m.store.InstallationID()}
	key := "internal_tls/authority"
	b, old, err := m.decode(ctx, key, scope, []string{"installation-ca"})
	if err != nil {
		return keyPair{}, err
	}
	if len(old) == 0 {
		pair, err := issueAuthority(scope.InstallationID, m.now())
		if err != nil {
			return keyPair{}, err
		}
		b = bundle{Version: 1, Scope: scope, Pairs: map[string]keyPair{"installation-ca": pair}}
		if err := m.persist(ctx, key, nil, b); err != nil {
			return keyPair{}, err
		}
	}
	pair := b.Pairs["installation-ca"]
	if _, _, err := validateAuthority(pair, scope.InstallationID, m.now()); err != nil {
		return keyPair{}, err
	}
	root, err := m.root.OpenDirectory("pki")
	if err != nil {
		return keyPair{}, ErrMaterial
	}
	defer root.Close()
	files := pairPublications(b, nil)
	files[0].mode = 0644
	if err := m.publish(root, files); err != nil {
		return keyPair{}, err
	}
	return pair, nil
}
func (m *Manager) leaves(ctx context.Context, key string, scope Scope, roles []string, ca keyPair, root *safefs.Root, modes map[string]os.FileMode) (bundle, error) {
	b, old, err := m.decode(ctx, key, scope, roles)
	if err != nil {
		return bundle{}, err
	}
	caCert, _, err := validateAuthority(ca, scope.InstallationID, m.now())
	if err != nil {
		return bundle{}, err
	}
	current := len(old) != 0
	for _, pairs := range []map[string]keyPair{b.Pairs, b.Previous} {
		for role, pair := range pairs {
			cert, _, err := parsePair(pair)
			if err != nil || cert.CheckSignatureFrom(caCert) != nil || verifyRole(cert, scope, role) != nil || cert.KeyUsage != x509.KeyUsageDigitalSignature|x509.KeyUsageKeyEncipherment || len(cert.ExtKeyUsage) != 1 {
				return bundle{}, ErrMaterial
			}
			usage := x509.ExtKeyUsageClientAuth
			if role == AgentServer || role == CoreServiceServer {
				usage = x509.ExtKeyUsageServerAuth
			}
			if cert.ExtKeyUsage[0] != usage {
				return bundle{}, ErrMaterial
			}
			if pairs != nil && (!m.now().Add(time.Minute).Before(cert.NotAfter) || m.now().Before(cert.NotBefore)) {
				current = false
			}
		}
	}
	// Finish a previous interrupted rotation before considering a further one.
	if len(b.Previous) != 0 {
		if err := m.publish(root, pairPublications(b, modes)); err != nil {
			return bundle{}, err
		}
		b.Previous = nil
		if err := m.persist(ctx, key, old, b); err != nil {
			return bundle{}, err
		}
		old, _ = json.Marshal(b)
		current = true
		for _, pair := range b.Pairs {
			cert, _, _ := parsePair(pair)
			if m.now().Before(cert.NotBefore) || !m.now().Add(time.Minute).Before(cert.NotAfter) {
				current = false
			}
		}
	}
	if !current {
		next := bundle{Version: 1, Scope: scope, Pairs: make(map[string]keyPair), Previous: b.Pairs}
		for _, role := range roles {
			pair, err := issueLeaf(ca, scope, role, m.now())
			if err != nil {
				return bundle{}, err
			}
			next.Pairs[role] = pair
		}
		if err := m.persist(ctx, key, old, next); err != nil {
			return bundle{}, err
		}
		b = next
	}
	if err := m.publish(root, pairPublications(b, modes)); err != nil {
		return bundle{}, err
	}
	if len(b.Previous) != 0 {
		raw, _ := json.Marshal(b)
		b.Previous = nil
		if err := m.persist(ctx, key, raw, b); err != nil {
			return bundle{}, err
		}
	}
	return b, nil
}

func (m *Manager) generation(ctx context.Context, scope Scope) (GenerationIdentity, keyPair, bundle, error) {
	if m.closed || !scope.valid(true) || scope.InstallationID != m.store.InstallationID() {
		return GenerationIdentity{}, keyPair{}, bundle{}, ErrIdentity
	}
	ca, err := m.authority(ctx)
	if err != nil {
		return GenerationIdentity{}, keyPair{}, bundle{}, err
	}
	work, err := m.root.OpenDirectory(scope.WorkID)
	if err != nil {
		return GenerationIdentity{}, keyPair{}, bundle{}, ErrMaterial
	}
	defer work.Close()
	name := fmt.Sprintf("tls-generation-%d", scope.Generation)
	root, err := work.OpenDirectory(name)
	if err != nil {
		return GenerationIdentity{}, keyPair{}, bundle{}, ErrMaterial
	}
	defer root.Close()
	b, err := m.leaves(ctx, fmt.Sprintf("internal_tls/generation/%s/%d", scope.WorkID, scope.Generation), scope, []string{AgentServer, CoreClient, AgentServiceClient}, ca, root, map[string]os.FileMode{AgentServer: 0644, AgentServiceClient: 0644})
	if err != nil {
		return GenerationIdentity{}, keyPair{}, bundle{}, err
	}
	directory := filepath.Join(m.directory, scope.WorkID, name)
	identity := GenerationIdentity{Scope: scope, CACertificatePath: filepath.Join(m.directory, "pki", "installation-ca.crt"), ServerCertificatePath: filepath.Join(directory, "agent-server.crt"), ServerPrivateKeyPath: filepath.Join(directory, "agent-server.key"), ClientCertificatePath: filepath.Join(directory, "core-client.crt"), ClientPrivateKeyPath: filepath.Join(directory, "core-client.key"), ServiceClientCertificatePath: filepath.Join(directory, "agent-service-client.crt"), ServiceClientPrivateKeyPath: filepath.Join(directory, "agent-service-client.key"), ServerName: scope.commonName(AgentServer), ClientCommonName: scope.commonName(CoreClient)}
	return identity, ca, b, nil
}
func (m *Manager) EnsureGeneration(ctx context.Context, scope Scope) (GenerationIdentity, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	identity, _, _, err := m.generation(ctx, scope)
	return identity, err
}
func (m *Manager) core(ctx context.Context) (CoreIdentity, keyPair, bundle, error) {
	if m.closed {
		return CoreIdentity{}, keyPair{}, bundle{}, ErrMaterial
	}
	scope := Scope{InstallationID: m.store.InstallationID()}
	ca, err := m.authority(ctx)
	if err != nil {
		return CoreIdentity{}, keyPair{}, bundle{}, err
	}
	root, err := m.root.OpenDirectory("pki")
	if err != nil {
		return CoreIdentity{}, keyPair{}, bundle{}, ErrMaterial
	}
	defer root.Close()
	b, err := m.leaves(ctx, "internal_tls/core_service", scope, []string{CoreServiceServer}, ca, root, nil)
	identity := CoreIdentity{CACertificatePath: filepath.Join(m.directory, "pki", "installation-ca.crt"), ServerCertificatePath: filepath.Join(m.directory, "pki", "core-service-server.crt"), ServerPrivateKeyPath: filepath.Join(m.directory, "pki", "core-service-server.key"), ServerName: "piwork-core"}
	return identity, ca, b, err
}
func (m *Manager) EnsureCoreService(ctx context.Context) (CoreIdentity, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	identity, _, _, err := m.core(ctx)
	return identity, err
}

func roots(pair keyPair) (*x509.CertPool, error) {
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM([]byte(pair.Certificate)) {
		return nil, ErrMaterial
	}
	return pool, nil
}
func (m *Manager) AgentClientConfig(ctx context.Context, scope Scope) (*tls.Config, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	identity, ca, b, err := m.generation(ctx, scope)
	if err != nil {
		return nil, err
	}
	cert, err := certificatePair(b.Pairs[CoreClient])
	if err != nil {
		return nil, err
	}
	pool, err := roots(ca)
	if err != nil {
		return nil, err
	}
	return &tls.Config{MinVersion: tls.VersionTLS12, ServerName: identity.ServerName, RootCAs: pool, Certificates: []tls.Certificate{cert}, VerifyConnection: func(state tls.ConnectionState) error {
		if len(state.PeerCertificates) == 0 {
			return ErrIdentity
		}
		return verifyRole(state.PeerCertificates[0], scope, AgentServer)
	}}, nil
}
func (m *Manager) ServiceClientConfig(ctx context.Context, scope Scope) (*tls.Config, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	_, ca, b, err := m.generation(ctx, scope)
	if err != nil {
		return nil, err
	}
	cert, err := certificatePair(b.Pairs[AgentServiceClient])
	if err != nil {
		return nil, err
	}
	pool, err := roots(ca)
	if err != nil {
		return nil, err
	}
	coreScope := Scope{InstallationID: scope.InstallationID}
	return &tls.Config{MinVersion: tls.VersionTLS12, ServerName: "piwork-core", RootCAs: pool, Certificates: []tls.Certificate{cert}, VerifyConnection: func(state tls.ConnectionState) error {
		if len(state.PeerCertificates) == 0 {
			return ErrIdentity
		}
		return verifyRole(state.PeerCertificates[0], coreScope, CoreServiceServer)
	}}, nil
}
func (m *Manager) CoreServerConfig(ctx context.Context, active func(Scope) bool) (*tls.Config, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	_, ca, b, err := m.core(ctx)
	if err != nil {
		return nil, err
	}
	cert, err := certificatePair(b.Pairs[CoreServiceServer])
	if err != nil {
		return nil, err
	}
	pool, err := roots(ca)
	if err != nil {
		return nil, err
	}
	installation := m.store.InstallationID()
	return &tls.Config{MinVersion: tls.VersionTLS12, ClientCAs: pool, ClientAuth: tls.RequireAndVerifyClientCert, Certificates: []tls.Certificate{cert}, VerifyConnection: func(state tls.ConnectionState) error {
		if len(state.PeerCertificates) == 0 {
			return ErrIdentity
		}
		_, err := AuthorizeServicePeer(state.PeerCertificates[0], installation, active)
		return err
	}}, nil
}
