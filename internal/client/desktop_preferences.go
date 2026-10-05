package client

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"sync"

	"piwork/internal/clientfs"
)

const DesktopPreferencesLimit = 64 << 10

var ErrDesktopPreferencesInvalid = errors.New("invalid Desktop default Core configuration")
var ErrDesktopPreferencesUnavailable = errors.New("Desktop default Core configuration is unavailable; use --core to start and restore automatic selection if the record is corrupt")

type DesktopPreferencesStore struct {
	CredentialPath string
	write          func(context.Context, *clientfs.Directory, []byte, func() error) error
}

var desktopPreferenceLocks sync.Map

// DesktopCoreURL applies the existing HTTP(S) origin grammar.
func DesktopCoreURL(raw string) (string, error) {
	u, err := ParseCoreURL(raw)
	if err != nil {
		return "", ErrDesktopPreferencesInvalid
	}
	return u.Scheme + "://" + u.Host, nil
}

func preferenceObject(raw []byte, fields ...string) (map[string]json.RawMessage, error) {
	if len(raw) > DesktopPreferencesLimit {
		return nil, ErrDesktopPreferencesInvalid
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	token, err := d.Token()
	if err != nil || token != json.Delim('{') {
		return nil, ErrDesktopPreferencesInvalid
	}
	allowed := map[string]bool{}
	for _, field := range fields {
		allowed[field] = true
	}
	result := map[string]json.RawMessage{}
	for d.More() {
		token, err := d.Token()
		name, ok := token.(string)
		if err != nil || !ok || !allowed[name] || result[name] != nil {
			return nil, ErrDesktopPreferencesInvalid
		}
		var value json.RawMessage
		if d.Decode(&value) != nil {
			return nil, ErrDesktopPreferencesInvalid
		}
		result[name] = value
	}
	if token, err = d.Token(); err != nil || token != json.Delim('}') {
		return nil, ErrDesktopPreferencesInvalid
	}
	if _, err = d.Token(); err != io.EOF || len(result) != len(fields) {
		return nil, ErrDesktopPreferencesInvalid
	}
	return result, nil
}

func ParseDesktopPreferenceInput(raw []byte) (string, error) {
	value, err := preferenceObject(raw, "coreUrl")
	if err != nil {
		return "", err
	}
	var core string
	if json.Unmarshal(value["coreUrl"], &core) != nil {
		return "", ErrDesktopPreferencesInvalid
	}
	return DesktopCoreURL(core)
}

func parseDesktopPreferences(raw []byte) (string, error) {
	value, err := preferenceObject(raw, "version", "coreUrl")
	if err != nil {
		return "", err
	}
	var version int
	var core string
	if json.Unmarshal(value["version"], &version) != nil || version != 1 || json.Unmarshal(value["coreUrl"], &core) != nil {
		return "", ErrDesktopPreferencesInvalid
	}
	return DesktopCoreURL(core)
}

func (s DesktopPreferencesStore) directory() (string, error) {
	if s.CredentialPath == "" {
		return "", ErrDesktopPreferencesUnavailable
	}
	return filepath.Abs(filepath.Join(filepath.Dir(s.CredentialPath), "desktop"))
}

func readDesktopPreferences(d *clientfs.Directory) (*string, error) {
	raw, err := d.ReadFile("preferences.json", DesktopPreferencesLimit)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, ErrDesktopPreferencesUnavailable
	}
	core, err := parseDesktopPreferences(raw)
	if err != nil {
		return nil, ErrDesktopPreferencesUnavailable
	}
	return &core, nil
}

func (s DesktopPreferencesStore) Load() (*string, error) {
	path, err := s.directory()
	if err != nil {
		return nil, err
	}
	d, err := clientfs.OpenPrivateDirectory(path, false)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, ErrDesktopPreferencesUnavailable
	}
	defer d.Close()
	return readDesktopPreferences(d)
}

func (s DesktopPreferencesStore) mutate(ctx context.Context, core *string, check func() error) error {
	path, err := s.directory()
	if err != nil {
		return err
	}
	entry, _ := desktopPreferenceLocks.LoadOrStore(path, &sync.Mutex{})
	mu := entry.(*sync.Mutex)
	if !mu.TryLock() {
		return clientfs.ErrBusy
	}
	defer mu.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	d, err := clientfs.OpenPrivateDirectory(path, core != nil)
	if errors.Is(err, os.ErrNotExist) && core == nil {
		return nil
	}
	if err != nil {
		return ErrDesktopPreferencesUnavailable
	}
	defer d.Close()
	lock, err := d.TryLock(".lock")
	if errors.Is(err, clientfs.ErrBusy) {
		return err
	}
	if err != nil {
		return ErrDesktopPreferencesUnavailable
	}
	defer lock.Close()
	if core == nil {
		if err := ctx.Err(); err != nil {
			return err
		}
		if check != nil {
			if err := check(); err != nil {
				return err
			}
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		return d.Remove("preferences.json")
	}
	if _, err := readDesktopPreferences(d); err != nil {
		return err
	}
	raw, _ := json.Marshal(struct {
		Version int    `json:"version"`
		CoreURL string `json:"coreUrl"`
	}{1, *core})
	if s.write != nil {
		return s.write(ctx, d, append(raw, '\n'), check)
	}
	return d.AtomicWriteChecked(ctx, "preferences.json", append(raw, '\n'), check)
}

func (s DesktopPreferencesStore) Save(ctx context.Context, raw string, check func() error) (string, error) {
	core, err := DesktopCoreURL(raw)
	if err != nil {
		return "", err
	}
	err = s.mutate(ctx, &core, check)
	return core, err
}

func (s DesktopPreferencesStore) Clear(ctx context.Context, check func() error) error {
	return s.mutate(ctx, nil, check)
}

// ResolveDesktopCoreURL reads preferences only when flags/environment have
// not selected an endpoint. Business CLI keeps ResolveCoreURL unchanged.
func ResolveDesktopCoreURL(explicit, saved string, preferences DesktopPreferencesStore) (string, error) {
	selected := explicit
	if selected == "" {
		selected = os.Getenv("PIWORK_CORE_URL")
	}
	if selected != "" {
		return DesktopCoreURL(selected)
	}
	core, err := preferences.Load()
	if err != nil {
		return "", err
	}
	if core != nil {
		return *core, nil
	}
	resolved, err := ResolveCoreURL("", saved)
	if err != nil {
		return "", err
	}
	return DesktopCoreURL(resolved)
}
