// Package identity owns user authentication and administration. The operator
// credential is a separate principal and cannot be a user login session.
package identity

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"piwork/internal/contracts"
	"piwork/internal/corestore"
)

type PublicIdentity struct {
	ID      string `json:"id"`
	Account string `json:"account"`
	Role    string `json:"role"`
}
type LoginResult struct {
	Token     string         `json:"token"`
	ExpiresAt string         `json:"expiresAt"`
	User      PublicIdentity `json:"user"`
}
type Session struct {
	SessionID string         `json:"-"`
	ExpiresAt string         `json:"expiresAt"`
	User      PublicIdentity `json:"user"`
}
type Principal struct {
	UserID, Role, SessionID string
	operator                bool
}

func (p Principal) IsOperator() bool { return p.operator }
func OperatorPrincipal() Principal   { return Principal{operator: true} }
func (s Session) Principal() Principal {
	return Principal{UserID: s.User.ID, Role: s.User.Role, SessionID: s.SessionID}
}

type Config struct {
	SessionTTL, FailureWindow time.Duration
	MaxFailures               int
}
type Options struct {
	Now    func() time.Time
	Config *Config
}
type failureBucket struct {
	started time.Time
	count   int
}
type watcher struct {
	userID, sessionID string
	cancel            context.CancelFunc
}
type Service struct {
	store     *corestore.Store
	dummy     string
	now       func() time.Time
	config    Config
	loginGate chan struct{}
	failures  map[string]failureBucket
	watchMu   sync.Mutex
	watchers  map[string]watcher
}

func New(ctx context.Context, store *corestore.Store, options Options) (*Service, error) {
	if store == nil {
		return nil, corestore.ErrStorage
	}
	cfg := Config{24 * time.Hour, time.Minute, 5}
	if options.Config != nil {
		cfg = *options.Config
	}
	if cfg.SessionTTL <= 0 || cfg.FailureWindow <= 0 || cfg.MaxFailures < 1 {
		return nil, contracts.NewError("INVALID_REQUEST", "")
	}
	now := options.Now
	if now == nil {
		now = time.Now
	}
	token, err := randomToken()
	if err != nil {
		return nil, err
	}
	dummy, err := HashPassword(ctx, token)
	if err != nil {
		return nil, err
	}
	return &Service{store: store, dummy: dummy, now: now, config: cfg, loginGate: make(chan struct{}, 1), failures: map[string]failureBucket{}, watchers: map[string]watcher{}}, nil
}
func (s *Service) Login(ctx context.Context, account, password, source string) (LoginResult, error) {
	// Account+source checks and failure increments form one admission. In-flight
	// logins cannot each consume the same final allowed attempt concurrently.
	select {
	case s.loginGate <- struct{}{}:
	case <-ctx.Done():
		return LoginResult{}, ctx.Err()
	}
	defer func() { <-s.loginGate }()
	now := s.now().UTC()
	keys := []string{"account:" + TokenDigest(strings.ToLower(account)), "source:" + TokenDigest(source)}
	for key, b := range s.failures {
		if now.Sub(b.started) >= s.config.FailureWindow {
			delete(s.failures, key)
		}
	}
	for _, key := range keys {
		if b, ok := s.failures[key]; ok && b.count >= s.config.MaxFailures {
			remaining := s.config.FailureWindow - now.Sub(b.started)
			return LoginResult{}, contracts.NewError("RATE_LIMITED", "").WithRetryAfter(remaining.Milliseconds())
		}
	}
	user, err := s.store.UserByAccount(ctx, account)
	if err != nil && !errors.Is(err, corestore.ErrNotFound) {
		return LoginResult{}, err
	}
	digest := s.dummy
	if err == nil {
		digest = user.PasswordDigest
	}
	match, err := VerifyPassword(ctx, digest, password)
	if err != nil {
		return LoginResult{}, err
	}
	fail := func() (LoginResult, error) {
		for _, key := range keys {
			b, ok := s.failures[key]
			if !ok {
				b.started = now
			}
			b.count++
			s.failures[key] = b
		}
		return LoginResult{}, contracts.NewError("AUTHENTICATION_FAILED", "")
	}
	if user.ID == "" || !user.Enabled || !match {
		return fail()
	}
	token, err := randomToken()
	if err != nil {
		return LoginResult{}, err
	}
	id, err := uuid.NewRandom()
	if err != nil {
		return LoginResult{}, err
	}
	expiry := now.Add(s.config.SessionTTL).Format(time.RFC3339Nano)
	err = s.store.Write(ctx, func(tx *sql.Tx) error {
		current, err := readUser(tx, user.ID)
		if err != nil {
			return err
		}
		if !current.Enabled || current.PasswordDigest != digest {
			return contracts.NewError("AUTHENTICATION_FAILED", "")
		}
		user = current
		return corestore.InsertLoginSession(tx, corestore.LoginSessionRecord{ID: "login-" + id.String(), UserID: user.ID, TokenDigest: TokenDigest(token), ExpiresAt: expiry, CreatedAt: now.Format(time.RFC3339Nano)})
	})
	if err != nil {
		var public *contracts.PublicError
		if errors.As(err, &public) {
			return fail()
		}
		return LoginResult{}, err
	}
	for _, key := range keys {
		delete(s.failures, key)
	}
	return LoginResult{Token: token, ExpiresAt: expiry, User: publicIdentity(user)}, nil
}
func publicIdentity(u corestore.UserRecord) PublicIdentity {
	return PublicIdentity{u.ID, u.Account, u.Role}
}
func (s *Service) Authenticate(ctx context.Context, token string) (Session, error) {
	if len(token) < 32 || len(token) > 512 {
		return Session{}, contracts.NewError("AUTHENTICATION_FAILED", "")
	}
	var session Session
	err := s.store.Read(ctx, func(tx *sql.Tx) error {
		var enabled bool
		var revoked *string
		err := tx.QueryRowContext(ctx, `SELECT l.id,l.expires_at,u.id,u.account,u.role,u.enabled,l.revoked_at FROM login_sessions l JOIN users u ON u.id=l.user_id WHERE l.token_digest=?`, TokenDigest(token)).Scan(&session.SessionID, &session.ExpiresAt, &session.User.ID, &session.User.Account, &session.User.Role, &enabled, &revoked)
		if errors.Is(err, sql.ErrNoRows) {
			return contracts.NewError("AUTHENTICATION_FAILED", "")
		}
		if err != nil {
			return err
		}
		expires, err := time.Parse(time.RFC3339Nano, session.ExpiresAt)
		if err != nil || !enabled || revoked != nil || !expires.After(s.now()) {
			return contracts.NewError("AUTHENTICATION_FAILED", "")
		}
		return nil
	})
	return session, err
}
func (s *Service) Logout(ctx context.Context, token string) error {
	session, err := s.Authenticate(ctx, token)
	if err != nil {
		return err
	}
	err = s.store.Write(ctx, func(tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, "UPDATE login_sessions SET revoked_at=? WHERE id=? AND revoked_at IS NULL", s.now().UTC().Format(time.RFC3339Nano), session.SessionID)
		return err
	})
	if err == nil {
		s.cancelWatchers("", session.SessionID)
	}
	return err
}
func (s *Service) cancelWatchers(userID, sessionID string) {
	s.watchMu.Lock()
	defer s.watchMu.Unlock()
	for _, w := range s.watchers {
		if userID != "" && w.userID == userID || sessionID != "" && w.sessionID == sessionID {
			w.cancel()
		}
	}
}

// WatchSession gives observation/gateway handlers a cancellable authorization
// lifetime. Revocation signals immediately; expiry and independent DB changes
// are also checked. Cancellation never stops a Work or cancels an accepted Run.
func (s *Service) WatchSession(parent context.Context, token string) (context.Context, context.CancelFunc, error) {
	session, err := s.Authenticate(parent, token)
	if err != nil {
		return nil, nil, err
	}
	expiry, _ := time.Parse(time.RFC3339Nano, session.ExpiresAt)
	ctx, cancel := context.WithTimeout(parent, expiry.Sub(s.now()))
	id, err := uuid.NewRandom()
	if err != nil {
		cancel()
		return nil, nil, err
	}
	key := id.String()
	s.watchMu.Lock()
	s.watchers[key] = watcher{session.User.ID, session.SessionID, cancel}
	s.watchMu.Unlock()
	go func() {
		defer func() { s.watchMu.Lock(); delete(s.watchers, key); s.watchMu.Unlock(); cancel() }()
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		if _, err := s.Authenticate(ctx, token); err != nil {
			return
		}
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if _, err := s.Authenticate(ctx, token); err != nil {
					return
				}
			}
		}
	}()
	return ctx, cancel, nil
}
func (s *Service) Close() {
	s.watchMu.Lock()
	defer s.watchMu.Unlock()
	for _, w := range s.watchers {
		w.cancel()
	}
}
