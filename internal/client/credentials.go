package client

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

type Identity struct {
	ID      string `json:"id"`
	Account string `json:"account"`
	Role    string `json:"role"`
}

type Credential struct {
	Version   int      `json:"version"`
	CoreURL   string   `json:"coreUrl"`
	Token     string   `json:"token"`
	ExpiresAt string   `json:"expiresAt"`
	User      Identity `json:"user"`
}

func CredentialPath() (string, error) {
	if path := os.Getenv("PIWORK_CONFIG_PATH"); path != "" {
		return filepath.Abs(path)
	}
	if base := os.Getenv("XDG_CONFIG_HOME"); base != "" {
		return filepath.Abs(filepath.Join(base, "piwork", "client.json"))
	}
	return defaultCredentialPath()
}

type CredentialStore struct{ Path string }

func (s CredentialStore) Load() (*Credential, error) {
	directory, err := openCredentialDirectory(s.Path, false)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	defer directory.close()
	return directory.load()
}

func (d *credentialDirectory) load() (*Credential, error) {
	raw, err := d.read()
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var value Credential
	if len(raw) > 64<<10 || json.Unmarshal(raw, &value) != nil || !value.valid() {
		return nil, errors.New("credential file has an unsupported shape or version")
	}
	return &value, nil
}

func (s CredentialStore) Save(value Credential) error {
	if !value.valid() {
		return errors.New("credential record is invalid")
	}
	directory, err := openCredentialDirectory(s.Path, true)
	if err != nil {
		return err
	}
	defer directory.close()
	if err := directory.lock(); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	return directory.replace(append(raw, '\n'))
}

func (s CredentialStore) Clear() error {
	directory, err := openCredentialDirectory(s.Path, false)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	defer directory.close()
	if err := directory.lock(); err != nil {
		return err
	}
	return directory.remove()
}

// ClearSession only removes the session captured by the caller. Saving and
// checking/removing use the same directory lock, including across processes.
// An absent or superseded record is a successful no-op; unsafe storage is not.
func (s CredentialStore) ClearSession(coreURL, token string) error {
	if _, err := ParseCoreURL(coreURL); err != nil || strings.TrimSpace(token) == "" {
		return errors.New("credential session identity is invalid")
	}
	directory, err := openCredentialDirectory(s.Path, false)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	defer directory.close()
	if err := directory.lock(); err != nil {
		return err
	}
	return directory.clearSession(coreURL, token)
}

// The caller holds the directory's exclusive lock until close.
func (d *credentialDirectory) clearSession(coreURL, token string) error {
	current, err := d.load()
	if err != nil {
		return err
	}
	if current != nil {
		if _, err := ParseCoreURL(current.CoreURL); err != nil {
			return errors.New("credential file has an invalid Core origin")
		}
	}
	if current == nil || current.Token != token || !SameCoreOrigin(current.CoreURL, coreURL) {
		return nil
	}
	return d.remove()
}

func SameCoreOrigin(left, right string) bool {
	a, errA := ParseCoreURL(left)
	b, errB := ParseCoreURL(right)
	return errA == nil && errB == nil && a.Scheme == b.Scheme && a.Host == b.Host
}

func (v Credential) valid() bool {
	return v.Version == 1 && strings.TrimSpace(v.CoreURL) != "" && strings.TrimSpace(v.Token) != "" &&
		v.ExpiresAt != "" && v.User.ID != "" && v.User.Account != "" && (v.User.Role == "user" || v.User.Role == "admin")
}
