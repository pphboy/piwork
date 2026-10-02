package corestore

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"piwork/internal/contracts"
)

// TLSMaterial is private installation metadata, never Work configuration or
// snapshot content. A single committed bundle is the source of truth for its
// separately mounted PEM files, including recovery after partial publication.
func (s *Store) TLSMaterial(ctx context.Context, key string) ([]byte, error) {
	if !tlsKey(key) {
		return nil, ErrStorage
	}
	var value string
	err := s.Read(ctx, func(tx *sql.Tx) error {
		return tx.QueryRowContext(ctx, "SELECT value_json FROM control_metadata WHERE key=?", key).Scan(&value)
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return []byte(value), err
}

func (s *Store) CompareTLSMaterial(ctx context.Context, key string, expected, value []byte) error {
	if !tlsKey(key) || len(value) == 0 || len(value) > 128<<10 {
		return ErrStorage
	}
	if _, err := contracts.ParseJSON(strings.NewReader(string(value)), 128<<10); err != nil {
		return ErrStorage
	}
	return s.Write(ctx, func(tx *sql.Tx) error {
		var current string
		err := tx.QueryRowContext(ctx, "SELECT value_json FROM control_metadata WHERE key=?", key).Scan(&current)
		if errors.Is(err, sql.ErrNoRows) {
			if len(expected) != 0 {
				return ErrRevisionConflict
			}
			_, err = tx.ExecContext(ctx, "INSERT INTO control_metadata(key,value_json,updated_at) VALUES(?,?,?)", key, string(value), time.Now().UTC().Format(time.RFC3339Nano))
			return err
		}
		if err != nil {
			return err
		}
		if current != string(expected) {
			return ErrRevisionConflict
		}
		_, err = tx.ExecContext(ctx, "UPDATE control_metadata SET value_json=?,updated_at=? WHERE key=?", string(value), time.Now().UTC().Format(time.RFC3339Nano), key)
		return err
	})
}

func tlsKey(key string) bool {
	if len(key) > 256 || !strings.HasPrefix(key, "internal_tls/") {
		return false
	}
	for _, c := range key {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '/' || c == '-' || c == '_') {
			return false
		}
	}
	return true
}
