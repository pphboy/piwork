package identity

import (
	"context"
	"database/sql"
	"errors"
	"regexp"
	"time"

	"github.com/google/uuid"
	"piwork/internal/contracts"
	"piwork/internal/corestore"
)

var accountPattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$`)

func readUser(tx *sql.Tx, id string) (corestore.UserRecord, error) {
	var user corestore.UserRecord
	err := tx.QueryRow("SELECT id,account,password_digest,role,enabled,created_at,updated_at FROM users WHERE id=?", id).Scan(&user.ID, &user.Account, &user.PasswordDigest, &user.Role, &user.Enabled, &user.CreatedAt, &user.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return user, contracts.NewError("NOT_FOUND", "")
	}
	return user, err
}
func publicUser(user corestore.UserRecord) contracts.User {
	return contracts.User{Id: contracts.ResourceId(user.ID), Account: contracts.Identifier(user.Account), Role: contracts.UserRole(user.Role), Enabled: user.Enabled, CreatedAt: contracts.Timestamp(user.CreatedAt), UpdatedAt: contracts.Timestamp(user.UpdatedAt)}
}
func (s *Service) assertAdmin(tx *sql.Tx, actor Principal) error {
	if actor.operator {
		return nil
	}
	user, err := readUser(tx, actor.UserID)
	if err != nil {
		return contracts.NewError("AUTHENTICATION_FAILED", "")
	}
	if !user.Enabled {
		return contracts.NewError("AUTHENTICATION_FAILED", "")
	}
	var expiry string
	var revoked *string
	err = tx.QueryRow("SELECT expires_at,revoked_at FROM login_sessions WHERE id=? AND user_id=?", actor.SessionID, actor.UserID).Scan(&expiry, &revoked)
	if err != nil {
		return contracts.NewError("AUTHENTICATION_FAILED", "")
	}
	expires, err := time.Parse(time.RFC3339Nano, expiry)
	if err != nil || revoked != nil || !expires.After(s.now()) {
		return contracts.NewError("AUTHENTICATION_FAILED", "")
	}
	if user.Role != "admin" {
		return contracts.NewError("PERMISSION_DENIED", "")
	}
	return nil
}
func (s *Service) AuthorizeAdministrator(ctx context.Context, actor Principal) error {
	return s.store.Read(ctx, func(tx *sql.Tx) error { return s.assertAdmin(tx, actor) })
}

// AuthorizeAdministratorTx permits a configuration write to recheck the
// session and role in the same transaction that publishes the mutation.
func (s *Service) AuthorizeAdministratorTx(tx *sql.Tx, actor Principal) error {
	return s.assertAdmin(tx, actor)
}

// AuthorizePrincipalTx rechecks an authenticated user session at the same
// commit boundary as a Work configuration mutation. It does not accept an
// operator credential as a user identity.
func (s *Service) AuthorizePrincipalTx(tx *sql.Tx, actor Principal) error {
	if actor.operator || actor.UserID == "" || actor.SessionID == "" {
		return contracts.NewError("AUTHENTICATION_FAILED", "")
	}
	user, err := readUser(tx, actor.UserID)
	if err != nil || !user.Enabled || user.Role != actor.Role {
		return contracts.NewError("AUTHENTICATION_FAILED", "")
	}
	var expiry string
	var revoked *string
	if err := tx.QueryRow("SELECT expires_at,revoked_at FROM login_sessions WHERE id=? AND user_id=?", actor.SessionID, actor.UserID).Scan(&expiry, &revoked); err != nil {
		return contracts.NewError("AUTHENTICATION_FAILED", "")
	}
	deadline, err := time.Parse(time.RFC3339Nano, expiry)
	if err != nil || revoked != nil || !deadline.After(s.now()) {
		return contracts.NewError("AUTHENTICATION_FAILED", "")
	}
	return nil
}
func (s *Service) HasEnabledAdministrator(ctx context.Context) (bool, error) {
	var n int
	err := s.store.Read(ctx, func(tx *sql.Tx) error {
		return tx.QueryRowContext(ctx, "SELECT count(*) FROM users WHERE role='admin' AND enabled=1").Scan(&n)
	})
	return n > 0, err
}
func (s *Service) Bootstrap(ctx context.Context, account, password string) (contracts.User, error) {
	return s.create(ctx, OperatorPrincipal(), account, password, "admin", true)
}
func (s *Service) CreateUser(ctx context.Context, actor Principal, account, password, role string) (contracts.User, error) {
	if role == "" {
		role = "user"
	}
	return s.create(ctx, actor, account, password, role, false)
}
func (s *Service) create(ctx context.Context, actor Principal, account, password, role string, bootstrap bool) (contracts.User, error) {
	if !accountPattern.MatchString(account) {
		return contracts.User{}, contracts.NewError("INVALID_REQUEST", "account")
	}
	if role != "admin" && role != "user" {
		return contracts.User{}, contracts.NewError("INVALID_REQUEST", "role")
	}
	// Authorization is checked both before costly hashing and at commit.
	if !bootstrap {
		if err := s.store.Read(ctx, func(tx *sql.Tx) error { return s.assertAdmin(tx, actor) }); err != nil {
			return contracts.User{}, err
		}
	}
	digest, err := HashPassword(ctx, password)
	if err != nil {
		return contracts.User{}, err
	}
	id, err := uuid.NewRandom()
	if err != nil {
		return contracts.User{}, err
	}
	now := s.now().UTC().Format(time.RFC3339Nano)
	user := corestore.UserRecord{ID: "user-" + id.String(), Account: account, PasswordDigest: digest, Role: role, Enabled: true, CreatedAt: now, UpdatedAt: now}
	err = s.store.Write(ctx, func(tx *sql.Tx) error {
		if bootstrap {
			var count int
			if err := tx.QueryRow("SELECT count(*) FROM users").Scan(&count); err != nil {
				return err
			}
			if count != 0 {
				return contracts.NewError("CONFLICT", "")
			}
		} else {
			if err := s.assertAdmin(tx, actor); err != nil {
				return err
			}
		}
		var count int
		if err := tx.QueryRow("SELECT count(*) FROM users WHERE account=?", account).Scan(&count); err != nil {
			return err
		}
		if count != 0 {
			return contracts.NewError("CONFLICT", "account")
		}
		return corestore.InsertUser(tx, user)
	})
	if err != nil {
		return contracts.User{}, err
	}
	return publicUser(user), nil
}
func (s *Service) ListUsers(ctx context.Context, actor Principal) ([]contracts.User, error) {
	users := []contracts.User{}
	err := s.store.Read(ctx, func(tx *sql.Tx) error {
		if err := s.assertAdmin(tx, actor); err != nil {
			return err
		}
		rows, err := tx.QueryContext(ctx, "SELECT id,account,role,enabled,created_at,updated_at FROM users ORDER BY account,id")
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var u corestore.UserRecord
			if err := rows.Scan(&u.ID, &u.Account, &u.Role, &u.Enabled, &u.CreatedAt, &u.UpdatedAt); err != nil {
				return err
			}
			users = append(users, publicUser(u))
		}
		return rows.Err()
	})
	return users, err
}
func (s *Service) SetEnabled(ctx context.Context, actor Principal, id string, enabled bool) error {
	err := s.store.Write(ctx, func(tx *sql.Tx) error {
		if err := s.assertAdmin(tx, actor); err != nil {
			return err
		}
		user, err := readUser(tx, id)
		if err != nil {
			return err
		}
		if user.Role == "admin" && user.Enabled && !enabled {
			var n int
			if err := tx.QueryRow("SELECT count(*) FROM users WHERE role='admin' AND enabled=1").Scan(&n); err != nil {
				return err
			}
			if n <= 1 {
				return contracts.NewError("LAST_ADMINISTRATOR", "")
			}
		}
		now := s.now().UTC().Format(time.RFC3339Nano)
		if _, err := tx.ExecContext(ctx, "UPDATE users SET enabled=?,updated_at=? WHERE id=?", enabled, now, id); err != nil {
			return err
		}
		if !enabled {
			_, err = tx.ExecContext(ctx, "UPDATE login_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL", now, id)
		}
		return err
	})
	if err == nil && !enabled {
		s.cancelWatchers(id, "")
	}
	return err
}
func (s *Service) ResetPassword(ctx context.Context, actor Principal, id, password string) error {
	if err := s.store.Read(ctx, func(tx *sql.Tx) error { return s.assertAdmin(tx, actor) }); err != nil {
		return err
	}
	digest, err := HashPassword(ctx, password)
	if err != nil {
		return err
	}
	err = s.store.Write(ctx, func(tx *sql.Tx) error {
		if err := s.assertAdmin(tx, actor); err != nil {
			return err
		}
		if _, err := readUser(tx, id); err != nil {
			return err
		}
		now := s.now().UTC().Format(time.RFC3339Nano)
		if _, err := tx.ExecContext(ctx, "UPDATE users SET password_digest=?,updated_at=? WHERE id=?", digest, now, id); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, "UPDATE login_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL", now, id)
		return err
	})
	if err == nil {
		s.cancelWatchers(id, "")
	}
	return err
}
