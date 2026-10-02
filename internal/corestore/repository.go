package corestore

import (
	"context"
	"database/sql"
	"errors"
)

var ErrNotFound = errors.New("record was not found")

type UserRecord struct {
	ID             string
	Account        string
	PasswordDigest string `json:"-"`
	Role           string
	Enabled        bool
	CreatedAt      string
	UpdatedAt      string
}

func InsertUser(tx *sql.Tx, user UserRecord) error {
	_, err := tx.Exec(`INSERT INTO users(id,account,password_digest,role,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`, user.ID, user.Account, user.PasswordDigest, user.Role, user.Enabled, user.CreatedAt, user.UpdatedAt)
	return err
}
func (s *Store) User(ctx context.Context, id string) (UserRecord, error) {
	var user UserRecord
	err := s.Read(ctx, func(tx *sql.Tx) error {
		return tx.QueryRow(`SELECT id,account,password_digest,role,enabled,created_at,updated_at FROM users WHERE id=?`, id).Scan(&user.ID, &user.Account, &user.PasswordDigest, &user.Role, &user.Enabled, &user.CreatedAt, &user.UpdatedAt)
	})
	if errors.Is(err, sql.ErrNoRows) {
		err = ErrNotFound
	}
	return user, err
}
func (s *Store) UserByAccount(ctx context.Context, account string) (UserRecord, error) {
	var id string
	err := s.Read(ctx, func(tx *sql.Tx) error { return tx.QueryRow("SELECT id FROM users WHERE account=?", account).Scan(&id) })
	if errors.Is(err, sql.ErrNoRows) {
		return UserRecord{}, ErrNotFound
	}
	if err != nil {
		return UserRecord{}, err
	}
	return s.User(ctx, id)
}

type LoginSessionRecord struct {
	ID          string
	UserID      string
	TokenDigest string `json:"-"`
	ExpiresAt   string
	RevokedAt   *string
	CreatedAt   string
}

func InsertLoginSession(tx *sql.Tx, session LoginSessionRecord) error {
	_, err := tx.Exec(`INSERT INTO login_sessions(id,user_id,token_digest,expires_at,revoked_at,created_at) VALUES(?,?,?,?,?,?)`, session.ID, session.UserID, session.TokenDigest, session.ExpiresAt, session.RevokedAt, session.CreatedAt)
	return err
}

type WorkRecord struct {
	ID               string
	OwnerUserID      string
	Name             string
	DesiredState     string
	ObservedState    string
	DesiredRevision  int64
	ActiveRevision   *int64
	ControlVersion   int64
	DeletedAt        *string
	CreatedAt        string
	UpdatedAt        string
	DesiredContextID *string
	ActiveContextID  *string
}

func InsertWork(tx *sql.Tx, work WorkRecord) error {
	_, err := tx.Exec(`INSERT INTO works(id,owner_user_id,name,desired_state,observed_state,desired_revision,active_revision,control_version,deleted_at,created_at,updated_at,desired_context_id,active_context_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`, work.ID, work.OwnerUserID, work.Name, work.DesiredState, work.ObservedState, work.DesiredRevision, work.ActiveRevision, work.ControlVersion, work.DeletedAt, work.CreatedAt, work.UpdatedAt, work.DesiredContextID, work.ActiveContextID)
	return err
}
func ReadWork(tx *sql.Tx, id string, includeDeleted bool) (WorkRecord, error) {
	var work WorkRecord
	err := tx.QueryRow(`SELECT id,owner_user_id,name,desired_state,observed_state,desired_revision,active_revision,control_version,deleted_at,created_at,updated_at,desired_context_id,active_context_id FROM works WHERE id=? AND (? OR deleted_at IS NULL)`, id, includeDeleted).Scan(&work.ID, &work.OwnerUserID, &work.Name, &work.DesiredState, &work.ObservedState, &work.DesiredRevision, &work.ActiveRevision, &work.ControlVersion, &work.DeletedAt, &work.CreatedAt, &work.UpdatedAt, &work.DesiredContextID, &work.ActiveContextID)
	if errors.Is(err, sql.ErrNoRows) {
		err = ErrNotFound
	}
	return work, err
}
func (s *Store) Work(ctx context.Context, id string, includeDeleted bool) (WorkRecord, error) {
	var work WorkRecord
	err := s.Read(ctx, func(tx *sql.Tx) error { var err error; work, err = ReadWork(tx, id, includeDeleted); return err })
	return work, err
}

type ConfigurationRevision struct {
	WorkID                string
	Revision              int64
	ConfigJSON            string
	ResolvedImageDigest   *string
	CreatedByUserID       string
	CreatedAt             string
	RuntimeProfileJSON    *string
	SourceRuntimeRevision *int64
}

func InsertConfiguration(tx *sql.Tx, config ConfigurationRevision) error {
	_, err := tx.Exec(`INSERT INTO work_config_revisions(work_id,revision,config_json,resolved_image_digest,created_by_user_id,created_at,runtime_profile_json,source_runtime_revision) VALUES(?,?,?,?,?,?,?,?)`, config.WorkID, config.Revision, config.ConfigJSON, config.ResolvedImageDigest, config.CreatedByUserID, config.CreatedAt, config.RuntimeProfileJSON, config.SourceRuntimeRevision)
	return err
}

type ContextSnapshot struct {
	SnapshotID        string
	WorkID            string
	InternalRevision  *int64
	ConfigurationJSON string
	ImageIdentity     string
	CreatedByUserID   string
	CreatedAt         string
}

func InsertContext(tx *sql.Tx, snapshot ContextSnapshot) error {
	_, err := tx.Exec(`INSERT INTO work_context_snapshots(snapshot_id,work_id,internal_revision,configuration_json,image_identity,created_by_user_id,created_at) VALUES(?,?,?,?,?,?,?)`, snapshot.SnapshotID, snapshot.WorkID, snapshot.InternalRevision, snapshot.ConfigurationJSON, snapshot.ImageIdentity, snapshot.CreatedByUserID, snapshot.CreatedAt)
	return err
}

type ConfigurationState struct {
	WorkID            string
	OwnerUserID       string
	DesiredRevision   int64
	ActiveRevision    *int64
	DesiredConfigJSON string
	ActiveConfigJSON  *string
	PendingApply      bool
	DesiredContextID  *string
	ActiveContextID   *string
}

func (s *Store) Configuration(ctx context.Context, id string) (ConfigurationState, error) {
	var view ConfigurationState
	err := s.Read(ctx, func(tx *sql.Tx) error {
		return tx.QueryRow(`SELECT w.id,w.owner_user_id,w.desired_revision,w.active_revision,d.config_json,a.config_json,
(w.active_revision IS NULL OR w.desired_revision != w.active_revision OR w.desired_context_id IS NOT w.active_context_id),w.desired_context_id,w.active_context_id
FROM works w JOIN work_config_revisions d ON d.work_id=w.id AND d.revision=w.desired_revision
LEFT JOIN work_config_revisions a ON a.work_id=w.id AND a.revision=w.active_revision WHERE w.id=? AND w.deleted_at IS NULL`, id).Scan(&view.WorkID, &view.OwnerUserID, &view.DesiredRevision, &view.ActiveRevision, &view.DesiredConfigJSON, &view.ActiveConfigJSON, &view.PendingApply, &view.DesiredContextID, &view.ActiveContextID)
	})
	if errors.Is(err, sql.ErrNoRows) {
		err = ErrNotFound
	}
	return view, err
}
