package corestore

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"piwork/internal/contracts"
)

const preparationNamespace = "internal_preparation_v1/"
const PreparationResultLimit = 64 << 10
const PreparationResultCapacity = 64

// PreparationKey describes immutable image facts, never Work readiness.
type PreparationKey struct {
	Engine   string `json:"engine"`
	Image    string `json:"image"`
	Kind     string `json:"kind"`
	Platform string `json:"platform"`
	Version  int    `json:"version"`
}
type preparationRecord struct {
	Format       int             `json:"format"`
	Installation string          `json:"installation"`
	Key          PreparationKey  `json:"key"`
	Value        json.RawMessage `json:"value"`
}

func (k PreparationKey) valid() bool {
	if len(k.Engine) != 64 || !inspectionImagePattern.MatchString(k.Image) || k.Version < 1 || len(k.Platform) > 128 || k.Platform == "" || strings.ContainsAny(k.Platform, "\x00\r\n") {
		return false
	}
	if _, err := hex.DecodeString(k.Engine); err != nil {
		return false
	}
	switch k.Kind {
	case "agent", "file", "snapshot", "environment":
		return true
	}
	return false
}
func (k PreparationKey) storageKey() string {
	data, _ := json.Marshal(k)
	sum := sha256.Sum256(data)
	return preparationNamespace + k.Kind + "/" + hex.EncodeToString(sum[:])
}

// ReadPreparation returns a cache miss for malformed derived data. Storage
// failures remain errors; no caller may interpret them as verified capabilities.
func (s *Store) ReadPreparation(ctx context.Context, k PreparationKey) (json.RawMessage, bool, error) {
	if !k.valid() {
		return nil, false, ErrStorage
	}
	var raw string
	err := s.Read(ctx, func(tx *sql.Tx) error {
		return tx.QueryRowContext(ctx, "SELECT substr(value_json,1,65537) FROM control_metadata WHERE key=?", k.storageKey()).Scan(&raw)
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	if len(raw) > PreparationResultLimit {
		return nil, false, nil
	}
	if _, err := contracts.ParseJSON(strings.NewReader(raw), PreparationResultLimit); err != nil {
		return nil, false, nil
	}
	var r preparationRecord
	decoder := json.NewDecoder(strings.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&r) != nil || r.Format != 1 || r.Installation != s.installationID || r.Key != k || len(r.Value) == 0 || bytes.Equal(r.Value, []byte("null")) {
		return nil, false, nil
	}
	return append(json.RawMessage(nil), r.Value...), true, nil
}

// WritePreparation atomically publishes a completed, cleaned-up preparation.
// The caller owns that proof. Pins protect the current default set from eviction.
// False means capacity was pinned; the verified result was not persisted.
func (s *Store) WritePreparation(ctx context.Context, k PreparationKey, value json.RawMessage, pins []PreparationKey) (bool, error) {
	return s.WritePreparationFenced(ctx, k, value, pins, nil)
}

// WritePreparationFenced acquires the writer before entering the Engine fence,
// which must execute publish synchronously and protect it through commit.
func (s *Store) WritePreparationFenced(ctx context.Context, k PreparationKey, value json.RawMessage, pins []PreparationKey, fence func(publish func() error) error) (bool, error) {
	if !k.valid() || len(pins) > PreparationResultCapacity {
		return false, ErrStorage
	}
	if _, err := contracts.ParseJSON(bytes.NewReader(value), PreparationResultLimit); err != nil || bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
		return false, ErrStorage
	}
	raw, err := json.Marshal(preparationRecord{1, s.installationID, k, value})
	if err != nil || len(raw) > PreparationResultLimit {
		return false, ErrStorage
	}
	protected := map[string]bool{}
	for _, p := range pins {
		if !p.valid() {
			return false, ErrStorage
		}
		protected[p.storageKey()] = true
	}
	saved := false
	err = s.writeFenced(ctx, fence, func(tx *sql.Tx) error {
		rows, err := tx.QueryContext(ctx, "SELECT key FROM control_metadata WHERE key GLOB ? ORDER BY updated_at,key", preparationNamespace+k.Kind+"/*")
		if err != nil {
			return err
		}
		var keys []string
		for rows.Next() {
			var key string
			if err := rows.Scan(&key); err != nil {
				rows.Close()
				return err
			}
			keys = append(keys, key)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return err
		}
		exists := false
		for _, key := range keys {
			exists = exists || key == k.storageKey()
		}
		if !exists && len(keys) >= PreparationResultCapacity {
			victim := ""
			for _, key := range keys {
				if !protected[key] {
					victim = key
					break
				}
			}
			if victim == "" {
				return nil
			}
			if _, err := tx.ExecContext(ctx, "DELETE FROM control_metadata WHERE key=?", victim); err != nil {
				return err
			}
		}
		_, err = tx.ExecContext(ctx, "INSERT INTO control_metadata(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at", k.storageKey(), string(raw), time.Now().UTC().Format(time.RFC3339Nano))
		saved = err == nil
		return err
	})
	return saved && err == nil, err
}
func (s *Store) DeletePreparation(ctx context.Context, k PreparationKey) error {
	if !k.valid() {
		return ErrStorage
	}
	return s.Write(ctx, func(tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, "DELETE FROM control_metadata WHERE key=?", k.storageKey())
		return err
	})
}

// InvalidateImagePreparations removes all platform/version records for an
// image whose existence or compatibility has been disproved by this Engine.
func (s *Store) InvalidateImagePreparations(ctx context.Context, scope, image, kind string) error {
	key := PreparationKey{Engine: scope, Image: image, Kind: kind, Platform: "unknown", Version: 1}
	if !key.valid() {
		return ErrStorage
	}
	return s.Write(ctx, func(tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, `DELETE FROM control_metadata WHERE key GLOB ? AND CASE WHEN json_valid(value_json) THEN json_extract(value_json,'$.key.engine')=? AND json_extract(value_json,'$.key.image')=? ELSE 0 END`, preparationNamespace+kind+"/*", scope, image)
		return err
	})
}

// TouchPreparations merges verified cache hits without acquiring a SQL lease.
// The next mutation (before eviction), or graceful close, persists the batch.
// These bounded hints never create results or prove validation succeeded.
func (s *Store) TouchPreparations(ctx context.Context, keys []PreparationKey) error {
	if len(keys) > PreparationResultCapacity*4 {
		return ErrStorage
	}
	for _, key := range keys {
		if !key.valid() {
			return ErrStorage
		}
	}
	s.life.Lock()
	defer s.life.Unlock()
	if s.closed {
		return ErrClosed
	}
	s.preparationTouchMu.Lock()
	defer s.preparationTouchMu.Unlock()
	now := time.Now().UTC()
	for _, key := range keys {
		s.mergePreparationTouch(key.storageKey(), now)
	}
	return nil
}

// Called with preparationTouchMu held. Evict only advisory access timestamps.
func (s *Store) mergePreparationTouch(key string, at time.Time) {
	if s.preparationTouches == nil {
		s.preparationTouches = make(map[string]time.Time)
	}
	if previous, exists := s.preparationTouches[key]; exists {
		if at.After(previous) {
			s.preparationTouches[key] = at
		}
		return
	}
	if len(s.preparationTouches) >= PreparationResultCapacity*4 {
		oldest := key
		oldestAt := at
		for candidate, timestamp := range s.preparationTouches {
			if timestamp.Before(oldestAt) {
				oldest, oldestAt = candidate, timestamp
			}
		}
		if oldest == key {
			return
		}
		delete(s.preparationTouches, oldest)
	}
	s.preparationTouches[key] = at
}

func (s *Store) takePreparationTouches() map[string]time.Time {
	s.preparationTouchMu.Lock()
	defer s.preparationTouchMu.Unlock()
	touches := s.preparationTouches
	s.preparationTouches = nil
	return touches
}

func (s *Store) restorePreparationTouches(touches map[string]time.Time) {
	if len(touches) == 0 {
		return
	}
	s.preparationTouchMu.Lock()
	defer s.preparationTouchMu.Unlock()
	for key, at := range touches {
		s.mergePreparationTouch(key, at)
	}
}

func applyPreparationTouches(ctx context.Context, tx *sql.Tx, touches map[string]time.Time) error {
	for key, at := range touches {
		if _, err := tx.ExecContext(ctx, "UPDATE control_metadata SET updated_at=? WHERE key=?", at.Format(time.RFC3339Nano), key); err != nil {
			return err
		}
	}
	return nil
}

// closeDatabase calls this after draining leases, with admission closed and
// under the existing shutdown context. No background worker outlives the Store.
func (s *Store) flushPreparationTouches(ctx context.Context) error {
	touches := s.takePreparationTouches()
	if len(touches) == 0 {
		return nil
	}
	tx, err := s.writer.BeginTx(ctx, nil)
	if err != nil {
		return ErrShutdown
	}
	defer tx.Rollback()
	if err := applyPreparationTouches(ctx, tx, touches); err != nil {
		return ErrShutdown
	}
	if err := tx.Commit(); err != nil {
		return ErrShutdown
	}
	return nil
}
