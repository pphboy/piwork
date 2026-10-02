package corestore

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"regexp"
	"strings"
	"time"

	"piwork/internal/contracts"
)

type ImageInspection struct {
	ID             string `json:"id"`
	InstallationID string `json:"installationId"`
	ImageID        string `json:"imageId"`
	Kind           string `json:"kind"`
}

var inspectionIDPattern = regexp.MustCompile(`^[a-f0-9]{32}$`)
var inspectionImagePattern = regexp.MustCompile(`^sha256:[a-f0-9]{64}$`)

const inspectionNamespace = "internal_image_inspection/"

// BeginImageInspection is committed before any archive scratch allocation.
// These private records are not Work data, operations or portable snapshot
// fields. There is no durable Docker resource associated with this fd-only job.
func (s *Store) BeginImageInspection(ctx context.Context, id, imageID string) error {
	if !inspectionIDPattern.MatchString(id) || !inspectionImagePattern.MatchString(imageID) {
		return ErrStorage
	}
	v := ImageInspection{ID: id, InstallationID: s.installationID, ImageID: imageID, Kind: "anonymous-image-archive"}
	raw, _ := json.Marshal(v)
	return s.Write(ctx, func(tx *sql.Tx) error {
		var previous string
		err := tx.QueryRowContext(ctx, "SELECT value_json FROM control_metadata WHERE key=?", inspectionNamespace+id).Scan(&previous)
		if err == nil {
			return ErrRevisionConflict
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		_, err = tx.ExecContext(ctx, "INSERT INTO control_metadata(key,value_json,updated_at) VALUES(?,?,?)", inspectionNamespace+id, string(raw), time.Now().UTC().Format(time.RFC3339Nano))
		return err
	})
}
func (s *Store) imageInspection(raw, key string) (ImageInspection, error) {
	var v ImageInspection
	if _, err := contracts.ParseJSON(strings.NewReader(raw), 1024); err != nil {
		return v, ErrStorage
	}
	d := json.NewDecoder(bytes.NewBufferString(raw))
	d.DisallowUnknownFields()
	if d.Decode(&v) != nil || !inspectionIDPattern.MatchString(v.ID) || !inspectionImagePattern.MatchString(v.ImageID) || v.InstallationID != s.installationID || v.Kind != "anonymous-image-archive" || key != inspectionNamespace+v.ID {
		return ImageInspection{}, ErrStorage
	}
	return v, nil
}
func (s *Store) ActiveImageInspections(ctx context.Context) ([]ImageInspection, error) {
	var result []ImageInspection
	err := s.Read(ctx, func(tx *sql.Tx) error {
		rows, err := tx.QueryContext(ctx, "SELECT key,value_json FROM control_metadata WHERE key GLOB 'internal_image_inspection/*' ORDER BY key")
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var key, raw string
			if err := rows.Scan(&key, &raw); err != nil {
				return err
			}
			v, err := s.imageInspection(raw, key)
			if err != nil {
				return err
			}
			result = append(result, v)
		}
		return rows.Err()
	})
	return result, err
}
func (s *Store) CompleteImageInspection(ctx context.Context, id string) error {
	if !inspectionIDPattern.MatchString(id) {
		return ErrStorage
	}
	return s.Write(ctx, func(tx *sql.Tx) error {
		var raw string
		key := inspectionNamespace + id
		err := tx.QueryRowContext(ctx, "SELECT value_json FROM control_metadata WHERE key=?", key).Scan(&raw)
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		if _, err := s.imageInspection(raw, key); err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, "DELETE FROM control_metadata WHERE key=?", key)
		return err
	})
}

// RecoverImageInspections runs once on startup under the exclusive Core owner
// lock, before new inspection admission. Every previous process's anonymous fd
// has already closed; records can be retired without Engine deletion or replay.
func (s *Store) RecoverImageInspections(ctx context.Context) error {
	jobs, err := s.ActiveImageInspections(ctx)
	if err != nil {
		return err
	}
	for _, job := range jobs {
		if err := s.CompleteImageInspection(ctx, job.ID); err != nil {
			return err
		}
	}
	return nil
}
