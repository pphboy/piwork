package corestore

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"golang.org/x/sys/unix"
	"piwork/internal/contracts"
	"piwork/internal/safefs"
)

type PlatformFiles struct {
	store                       *Store
	platform, secrets           *safefs.Root
	operatorRoot, operatorStage *safefs.Root
	operatorName                string
	operatorRootOwned           bool
	mu                          sync.Mutex
}

func (s *Store) OpenPlatformFiles() (*PlatformFiles, error) {
	parent, err := s.root.OpenDirectory("runtime")
	if err != nil {
		return nil, ErrStorage
	}
	platform, err := parent.OpenDirectory("platform")
	parent.Close()
	if err != nil {
		return nil, ErrStorage
	}
	secrets, err := s.root.OpenDirectory("secrets")
	if err != nil {
		platform.Close()
		return nil, ErrStorage
	}
	p := &PlatformFiles{store: s, platform: platform, secrets: secrets}
	p.operatorRoot, p.operatorStage, p.operatorName = s.root, platform, "operator.credential"
	// A crash before publication can only leave private files in this Core-only
	// staging namespace. No external or user Work directory is inspected.
	names, err := platform.Entries()
	if err != nil {
		p.Close()
		return nil, ErrStorage
	}
	for _, name := range names {
		if !strings.HasPrefix(name, "publish-") {
			continue
		}
		if !publishTemp.MatchString(name) || platform.CheckEntry(name, false) != nil {
			p.Close()
			return nil, ErrStorage
		}
		if err := platform.Remove(name); err != nil {
			p.Close()
			return nil, ErrStorage
		}
	}
	return p, nil
}

var publishTemp = regexp.MustCompile(`^publish-[a-f0-9]{32}\.tmp$`)
var modelSecret = regexp.MustCompile(`^model-[a-f0-9-]{36}\.secret$`)

func (p *PlatformFiles) Close() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.operatorStage != p.platform {
		p.operatorStage.Close()
	}
	if p.operatorRootOwned {
		p.operatorRoot.Close()
	}
	p.platform.Close()
	return p.secrets.Close()
}

// SetOperatorPath pins an existing private parent, including all ancestors.
// External publication uses a staging directory on the same filesystem. Its
// namespace is tied to this installation, so recovery never deletes another
// installation's files. The Core's existing root lock is reused when needed.
func (p *PlatformFiles) SetOperatorPath(path string) error {
	if path == "" {
		return nil
	}
	root, err := safefs.OpenExistingRoot(filepath.Dir(path))
	if err != nil {
		return ErrStorage
	}
	name := filepath.Base(path)
	if !safefs.ValidFileName(name) || root.CheckPrivate() != nil {
		root.Close()
		return ErrStorage
	}
	if root.SameDirectory(p.store.root) {
		root.Close()
		p.operatorRoot, p.operatorStage, p.operatorName = p.store.root, p.platform, name
		return nil
	}
	for _, existing := range []*safefs.Root{p.secrets, p.platform} {
		if root.SameDirectory(existing) {
			root.Close()
			if existing == p.platform && strings.HasPrefix(name, "publish-") {
				return ErrStorage
			}
			stage := p.platform
			if existing == p.secrets {
				stage, err = existing.OpenDirectory(".piwork-operator-" + p.store.InstallationID())
				if err != nil {
					return ErrStorage
				}
			}
			p.operatorRoot, p.operatorStage, p.operatorName = existing, stage, name
			return p.recoverOperatorStage()
		}
	}
	if err := lockOperatorParent(root); err != nil {
		root.Close()
		return ErrStorage
	}
	stage, err := root.OpenDirectory(".piwork-operator-" + p.store.InstallationID())
	if err != nil {
		root.Close()
		return ErrStorage
	}
	if root.Unlock() != nil {
		stage.Close()
		root.Close()
		return ErrStorage
	}
	p.operatorRoot, p.operatorStage, p.operatorName, p.operatorRootOwned = root, stage, name, true
	return p.recoverOperatorStage()
}
func (p *PlatformFiles) recoverOperatorStage() error {
	stage := p.operatorStage
	if stage == p.platform {
		return nil
	}
	names, err := stage.Entries()
	if err != nil {
		return ErrStorage
	}
	for _, temp := range names {
		if !publishTemp.MatchString(temp) || stage.CheckEntry(temp, false) != nil {
			return ErrStorage
		}
		if err := stage.Remove(temp); err != nil {
			return ErrStorage
		}
	}
	return nil
}

func (p *PlatformFiles) ReadOperator() ([]byte, error) {
	return p.operatorRoot.ReadFile(p.operatorName, 512)
}
func (p *PlatformFiles) PublishOperator(data []byte) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	// A shared external parent can hold credentials for independent Core
	// installations. Only publication holds that parent lock; the installation's
	// own staging/root locks remain held for its lifetime.
	if p.operatorRootOwned {
		if err := lockOperatorParent(p.operatorRoot); err != nil {
			return ErrStorage
		}
		defer p.operatorRoot.Unlock()
	}
	return p.publish(p.operatorStage, p.operatorRoot, p.operatorName, data, false)
}
func lockOperatorParent(root *safefs.Root) error {
	deadline := time.Now().Add(2 * time.Second)
	for {
		if err := root.Lock(); err == nil {
			return nil
		}
		if time.Now().After(deadline) {
			return ErrStorage
		}
		time.Sleep(5 * time.Millisecond)
	}
}
func (p *PlatformFiles) Read(name string, limit int64) ([]byte, error) {
	if name != "operator.credential" && name != "runtime-profile.json" {
		return nil, ErrStorage
	}
	return p.store.root.ReadFile(name, limit)
}
func (p *PlatformFiles) Publish(name string, data []byte, overwrite bool) error {
	if name != "operator.credential" && name != "runtime-profile.json" {
		return ErrStorage
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.publish(p.platform, p.store.root, name, data, overwrite)
}
func (p *PlatformFiles) publish(stage, destination *safefs.Root, name string, data []byte, overwrite bool) error {
	var nonce [16]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		return ErrStorage
	}
	temp := "publish-" + hex.EncodeToString(nonce[:]) + ".tmp"
	f, err := stage.OpenFile(temp, unix.O_CREAT|unix.O_EXCL|unix.O_WRONLY)
	if err != nil {
		return ErrStorage
	}
	defer stage.Remove(temp)
	_, err = f.Write(data)
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		return ErrStorage
	}
	if err := stage.PublishTo(temp, destination, name, overwrite); err != nil {
		return ErrStorage
	}
	return nil
}
func (p *PlatformFiles) WriteSecret(name string, data []byte) error {
	if !modelSecret.MatchString(name) || len(data) > 3*65536+1 {
		return ErrStorage
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	f, err := p.secrets.OpenFile(name, unix.O_CREAT|unix.O_EXCL|unix.O_WRONLY)
	if err != nil {
		return ErrStorage
	}
	_, err = f.Write(data)
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		return ErrStorage
	}
	return p.secrets.Sync()
}
func (p *PlatformFiles) ReadSecret(name string) ([]byte, error) {
	if !modelSecret.MatchString(name) {
		return nil, ErrStorage
	}
	return p.secrets.ReadFile(name, 3*65536+1)
}
func (p *PlatformFiles) RemoveSecret(name string) error {
	if !modelSecret.MatchString(name) {
		return ErrStorage
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.secrets.CheckEntry(name, false) != nil {
		return ErrStorage
	}
	return p.secrets.Remove(name)
}
func (p *PlatformFiles) OpenInspectionRoot() (*safefs.Root, error) {
	return p.platform.OpenDirectory("image-inspection")
}

// OpenSkillsRoot pins the Core-owned immutable Skill artifact namespace.
func (s *Store) OpenSkillsRoot() (*safefs.Root, error) {
	return s.root.OpenDirectory("skills")
}

func (s *Store) OpenWorksRoot() (*safefs.Root, error) {
	return s.root.OpenDirectory("works")
}

func (s *Store) OpenPackageUploadsRoot() (*safefs.Root, error) {
	if err := s.root.EnsureDirectory("pi-packages"); err != nil {
		return nil, err
	}
	packages, err := s.root.OpenPrivateDirectory("pi-packages")
	if err != nil {
		return nil, err
	}
	defer packages.Close()
	if err := packages.EnsureDirectory("uploads"); err != nil {
		return nil, err
	}
	return packages.OpenPrivateDirectory("uploads")
}

func (s *Store) OpenPackageArea(name string) (*safefs.Root, error) {
	if name != "jobs" && name != "artifacts" {
		return nil, ErrStorage
	}
	packages, err := s.root.OpenDirectory("pi-packages")
	if err != nil {
		return nil, err
	}
	defer packages.Close()
	return packages.OpenDirectory(name)
}

var controlKey = regexp.MustCompile(`^[a-z][a-z0-9_]{0,127}$`)

func (s *Store) ControlMetadata(ctx context.Context, key string) ([]byte, error) {
	if !controlKey.MatchString(key) {
		return nil, ErrStorage
	}
	var raw string
	err := s.Read(ctx, func(tx *sql.Tx) error {
		return tx.QueryRowContext(ctx, "SELECT value_json FROM control_metadata WHERE key=?", key).Scan(&raw)
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if _, err := contracts.ParseJSON(strings.NewReader(raw), 2<<20); err != nil {
		return nil, ErrStorage
	}
	return []byte(raw), nil
}
func (s *Store) PutControlMetadataIfAbsent(ctx context.Context, key string, data []byte) (bool, error) {
	if !controlKey.MatchString(key) {
		return false, ErrStorage
	}
	if _, err := contracts.ParseJSON(strings.NewReader(string(data)), 2<<20); err != nil {
		return false, ErrStorage
	}
	inserted := false
	err := s.Write(ctx, func(tx *sql.Tx) error {
		result, err := tx.ExecContext(ctx, "INSERT INTO control_metadata(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO NOTHING", key, string(data), time.Now().UTC().Format(time.RFC3339Nano))
		if err != nil {
			return err
		}
		n, err := result.RowsAffected()
		inserted = n == 1
		return err
	})
	return inserted, err
}
func IsMissingPlatformFile(err error) bool { return errors.Is(err, os.ErrNotExist) }

// Snapshot areas are private installation-owned namespaces. Callers use
// pinned roots for publication and never inspect Docker host mountpoints.
func (s *Store) OpenSnapshotArea(name string) (*safefs.Root, error) {
	if name != "jobs" && name != "packages" && name != "transfers" {
		return nil, ErrStorage
	}
	if err := s.root.EnsureDirectory("snapshots"); err != nil {
		return nil, err
	}
	parent, err := s.root.OpenPrivateDirectory("snapshots")
	if err != nil {
		return nil, err
	}
	defer parent.Close()
	if err := parent.EnsureDirectory(name); err != nil {
		return nil, err
	}
	return parent.OpenPrivateDirectory(name)
}
