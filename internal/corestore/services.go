package corestore

import (
	"context"
	"database/sql"
)

type ServiceRecord struct {
	WorkID, ServiceID, Name     string
	DesiredRevision             int64
	AppliedRevision             *int64
	Enabled                     bool
	ObservedState               string
	TombstonedAt, LastErrorJSON *string
	DefinitionJSON              string
	ResolvedImageDigest         *string
	CreatedAt                   string
}

const serviceRecordQuery = `SELECT h.work_id,h.service_id,h.name,h.desired_revision,h.applied_revision,h.enabled,h.observed_state,h.tombstoned_at,h.last_error_json,r.definition_json,r.resolved_image_digest,r.created_at FROM service_heads h JOIN service_revisions r ON r.work_id=h.work_id AND r.service_id=h.service_id AND r.revision=h.desired_revision`

func scanService(row interface{ Scan(...any) error }) (ServiceRecord, error) {
	var value ServiceRecord
	err := row.Scan(&value.WorkID, &value.ServiceID, &value.Name, &value.DesiredRevision, &value.AppliedRevision, &value.Enabled, &value.ObservedState, &value.TombstonedAt, &value.LastErrorJSON, &value.DefinitionJSON, &value.ResolvedImageDigest, &value.CreatedAt)
	return value, notFound(err)
}
func ReadService(tx *sql.Tx, workID, serviceID string, includeDeleted bool) (ServiceRecord, error) {
	query := serviceRecordQuery + ` WHERE h.work_id=? AND h.service_id=?`
	if !includeDeleted {
		query += ` AND h.tombstoned_at IS NULL`
	}
	return scanService(tx.QueryRow(query, workID, serviceID))
}
func (s *Store) Service(ctx context.Context, workID, serviceID string, includeDeleted bool) (ServiceRecord, error) {
	var value ServiceRecord
	err := s.Read(ctx, func(tx *sql.Tx) error {
		var err error
		value, err = ReadService(tx, workID, serviceID, includeDeleted)
		return err
	})
	return value, err
}
func ReadServices(tx *sql.Tx, workID string, includeDeleted bool) ([]ServiceRecord, error) {
	query := serviceRecordQuery + ` WHERE h.work_id=?`
	if !includeDeleted {
		query += ` AND h.tombstoned_at IS NULL`
	}
	rows, err := tx.Query(query+` ORDER BY r.created_at,h.service_id`, workID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	values := []ServiceRecord{}
	for rows.Next() {
		value, err := scanService(rows)
		if err != nil {
			return nil, err
		}
		values = append(values, value)
	}
	return values, rows.Err()
}
func (s *Store) Services(ctx context.Context, workID string, includeDeleted bool) ([]ServiceRecord, error) {
	var values []ServiceRecord
	err := s.Read(ctx, func(tx *sql.Tx) error {
		var err error
		values, err = ReadServices(tx, workID, includeDeleted)
		return err
	})
	return values, err
}

type ServiceRuntimeBinding struct {
	WorkID, ServiceID                                string
	Revision                                         int64
	ContainerID, ImageIdentity                       *string
	RecoveryCount                                    int64
	RecoveryWindowStartedAt, NextRetryAt, ReadySince *string
	UpdatedAt                                        string
}

func ReadServiceRuntimeBinding(tx *sql.Tx, workID, serviceID string) (ServiceRuntimeBinding, error) {
	var v ServiceRuntimeBinding
	err := tx.QueryRow(`SELECT work_id,service_id,revision,container_id,image_identity,recovery_count,recovery_window_started_at,next_retry_at,ready_since,updated_at FROM service_runtime_bindings WHERE work_id=? AND service_id=?`, workID, serviceID).Scan(&v.WorkID, &v.ServiceID, &v.Revision, &v.ContainerID, &v.ImageIdentity, &v.RecoveryCount, &v.RecoveryWindowStartedAt, &v.NextRetryAt, &v.ReadySince, &v.UpdatedAt)
	return v, notFound(err)
}
func PutServiceRuntimeBinding(tx *sql.Tx, v ServiceRuntimeBinding) error {
	if v.WorkID == "" || v.ServiceID == "" || v.Revision < 1 || !validBudget(v.Revision) || !validBudget(v.RecoveryCount) {
		return ErrRevisionConflict
	}
	_, err := tx.Exec(`INSERT INTO service_runtime_bindings(work_id,service_id,revision,container_id,image_identity,recovery_count,recovery_window_started_at,next_retry_at,ready_since,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(work_id,service_id) DO UPDATE SET revision=excluded.revision,container_id=excluded.container_id,image_identity=excluded.image_identity,recovery_count=excluded.recovery_count,recovery_window_started_at=excluded.recovery_window_started_at,next_retry_at=excluded.next_retry_at,ready_since=excluded.ready_since,updated_at=excluded.updated_at`, v.WorkID, v.ServiceID, v.Revision, v.ContainerID, v.ImageIdentity, v.RecoveryCount, v.RecoveryWindowStartedAt, v.NextRetryAt, v.ReadySince, nowTimestamp(v.UpdatedAt))
	return err
}
