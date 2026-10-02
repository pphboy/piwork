package identity

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"piwork/internal/contracts"
	"piwork/internal/corestore"
)

const testPassword = "development-fixture-pass"

func identityFixture(t *testing.T, options Options) (*Service, *corestore.Store) {
	t.Helper()
	store, err := corestore.Open(context.Background(), corestore.Options{Directory: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	s, err := New(context.Background(), store, options)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s.Close)
	return s, store
}
func assertCode(t *testing.T, err error, code string) {
	t.Helper()
	_, view := contracts.ProjectError(err)
	if err == nil || view.Code != code {
		t.Fatalf("want %s got %+v %v", code, view, err)
	}
}
func TestPasswordsMatchRetainedTSArgon2Contract(t *testing.T) {
	raw, err := os.ReadFile("testdata/ts-passwords.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures []struct{ Password, Digest string }
	if json.Unmarshal(raw, &fixtures) != nil {
		t.Fatal("invalid fixtures")
	}
	for _, f := range fixtures {
		match, err := VerifyPassword(context.Background(), f.Digest, f.Password)
		if err != nil || !match {
			t.Fatal(f.Password, err)
		}
		match, err = VerifyPassword(context.Background(), f.Digest, f.Password+"wrong")
		if err != nil || match {
			t.Fatal("incorrect password matched", err)
		}
	}
	for _, bad := range []string{"digest-only", "$argon2id$v=19$m=999999999,t=999999999,p=255$AA$AA", strings.Repeat("x", 100000), strings.Replace(fixtures[0].Digest, "m=65536", "m=4096", 1)} {
		match, err := VerifyPassword(context.Background(), bad, testPassword)
		if err != nil || match {
			t.Fatal("unsafe PHC accepted", err)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := HashPassword(ctx, testPassword); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	if err := ValidatePassword("😀😀😀😀😀😀"); err != nil {
		t.Fatal("UTF16 password length changed", err)
	}
	assertCode(t, ValidatePassword("too short"), "INVALID_REQUEST")
}
func TestDurableSessionsDigestOnlyExpiryLogoutAndRoles(t *testing.T) {
	ctx := context.Background()
	now := time.Date(2026, 9, 30, 0, 0, 0, 0, time.UTC)
	s, store := identityFixture(t, Options{Now: func() time.Time { return now }})
	admin, err := s.Bootstrap(ctx, "administrator", testPassword)
	if err != nil {
		t.Fatal(err)
	}
	login, err := s.Login(ctx, "administrator", testPassword, "local")
	if err != nil {
		t.Fatal(err)
	}
	session, err := s.Authenticate(ctx, login.Token)
	if err != nil || session.User.Role != "admin" {
		t.Fatal(session, err)
	}
	user, err := s.CreateUser(ctx, session.Principal(), "normal", testPassword, "user")
	if err != nil {
		t.Fatal(err)
	}
	first, err := s.Login(ctx, "normal", testPassword, "first")
	if err != nil {
		t.Fatal(err)
	}
	second, err := s.Login(ctx, "normal", testPassword, "second")
	if err != nil {
		t.Fatal(err)
	}
	principal, err := s.Authenticate(ctx, first.Token)
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.CreateUser(ctx, principal.Principal(), "not-allowed", testPassword, "admin")
	assertCode(t, err, "PERMISSION_DENIED")
	if err := s.Logout(ctx, first.Token); err != nil {
		t.Fatal(err)
	}
	_, err = s.Authenticate(ctx, first.Token)
	assertCode(t, err, "AUTHENTICATION_FAILED")
	if _, err = s.Authenticate(ctx, second.Token); err != nil {
		t.Fatal(err)
	}
	if err := store.Read(ctx, func(tx *sql.Tx) error {
		rows, err := tx.Query("SELECT token_digest FROM login_sessions")
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var digest string
			rows.Scan(&digest)
			if len(digest) != 64 || digest == first.Token || digest == second.Token {
				t.Fatal("raw token stored", digest)
			}
		}
		return rows.Err()
	}); err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal([]any{admin, user, session})
	if strings.Contains(string(encoded), "argon2") || strings.Contains(string(encoded), login.Token) {
		t.Fatal("secret leaked in view")
	}
	// New service over the same persistent DB preserves issued token identity.
	reopened, err := New(ctx, store, Options{Now: func() time.Time { return now }})
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	if _, err := reopened.Authenticate(ctx, second.Token); err != nil {
		t.Fatal(err)
	}
	now = now.Add(24 * time.Hour)
	_, err = s.Authenticate(ctx, second.Token)
	assertCode(t, err, "AUTHENTICATION_FAILED")
}
func TestDisableResetAndWatchersNeverRestoreOldSessions(t *testing.T) {
	ctx := context.Background()
	s, _ := identityFixture(t, Options{})
	admin, err := s.Bootstrap(ctx, "admin", testPassword)
	if err != nil {
		t.Fatal(err)
	}
	actor := OperatorPrincipal()
	if err := s.SetEnabled(ctx, actor, string(admin.Id), false); err == nil {
		t.Fatal("last administrator disabled")
	} else {
		assertCode(t, err, "LAST_ADMINISTRATOR")
	}
	user, err := s.CreateUser(ctx, actor, "user", testPassword, "user")
	if err != nil {
		t.Fatal(err)
	}
	login, err := s.Login(ctx, "user", testPassword, "local")
	if err != nil {
		t.Fatal(err)
	}
	watch, cancel, err := s.WatchSession(ctx, login.Token)
	if err != nil {
		t.Fatal(err)
	}
	defer cancel()
	if err := s.SetEnabled(ctx, actor, string(user.Id), false); err != nil {
		t.Fatal(err)
	}
	select {
	case <-watch.Done():
	case <-time.After(time.Second):
		t.Fatal("disable did not cancel observation")
	}
	_, err = s.Login(ctx, "user", testPassword, "disabled")
	assertCode(t, err, "AUTHENTICATION_FAILED")
	if err := s.SetEnabled(ctx, actor, string(user.Id), true); err != nil {
		t.Fatal(err)
	}
	_, err = s.Authenticate(ctx, login.Token)
	assertCode(t, err, "AUTHENTICATION_FAILED")
	newLogin, err := s.Login(ctx, "user", testPassword, "again")
	if err != nil {
		t.Fatal(err)
	}
	watch2, cancel2, err := s.WatchSession(ctx, newLogin.Token)
	if err != nil {
		t.Fatal(err)
	}
	defer cancel2()
	if err := s.ResetPassword(ctx, actor, string(user.Id), "changed-development-password"); err != nil {
		t.Fatal(err)
	}
	select {
	case <-watch2.Done():
	case <-time.After(time.Second):
		t.Fatal("reset did not cancel observation")
	}
	_, err = s.Login(ctx, "user", testPassword, "old-password")
	assertCode(t, err, "AUTHENTICATION_FAILED")
	if _, err := s.Login(ctx, "user", "changed-development-password", "new-password"); err != nil {
		t.Fatal(err)
	}
	_, err = s.Authenticate(ctx, newLogin.Token)
	assertCode(t, err, "AUTHENTICATION_FAILED")
}
func TestConcurrentBootstrapAndLastAdminMutationAreAtomic(t *testing.T) {
	ctx := context.Background()
	s, _ := identityFixture(t, Options{})
	var wg sync.WaitGroup
	var accepted atomic.Int64
	for i := 0; i < 3; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := s.Bootstrap(ctx, "admin", testPassword); err == nil {
				accepted.Add(1)
			} else {
				assertCode(t, err, "CONFLICT")
			}
		}()
	}
	wg.Wait()
	if accepted.Load() != 1 {
		t.Fatal(accepted.Load())
	}
	users, err := s.ListUsers(ctx, OperatorPrincipal())
	if err != nil || len(users) != 1 {
		t.Fatal(users, err)
	}
	second, err := s.CreateUser(ctx, OperatorPrincipal(), "admin2", testPassword, "admin")
	if err != nil {
		t.Fatal(err)
	}
	accepted.Store(0)
	for _, id := range []string{string(users[0].Id), string(second.Id)} {
		wg.Add(1)
		go func(id string) {
			defer wg.Done()
			if err := s.SetEnabled(ctx, OperatorPrincipal(), id, false); err == nil {
				accepted.Add(1)
			} else {
				assertCode(t, err, "LAST_ADMINISTRATOR")
			}
		}(id)
	}
	wg.Wait()
	if accepted.Load() != 1 {
		t.Fatal("concurrent disable removed last admin", accepted.Load())
	}
}

func TestSessionExpiryAndLogoutCancelOnlyTheirObservation(t *testing.T) {
	ctx := context.Background()
	s, _ := identityFixture(t, Options{Config: &Config{SessionTTL: 350 * time.Millisecond, FailureWindow: time.Minute, MaxFailures: 5}})
	if _, err := s.Bootstrap(ctx, "admin", testPassword); err != nil {
		t.Fatal(err)
	}
	login, err := s.Login(ctx, "admin", testPassword, "local")
	if err != nil {
		t.Fatal(err)
	}
	watch, cancel, err := s.WatchSession(ctx, login.Token)
	if err != nil {
		t.Fatal(err)
	}
	defer cancel()
	select {
	case <-watch.Done():
	case <-time.After(2 * time.Second):
		t.Fatal("expired bearer left its observation open")
	}
	assertCode(t, func() error { _, err := s.Authenticate(ctx, login.Token); return err }(), "AUTHENTICATION_FAILED")
	// A fresh session has enough time to prove explicit logout is immediate,
	// independently of the expiration timer and the DB polling interval.
	s.config.SessionTTL = time.Hour
	first, err := s.Login(ctx, "admin", testPassword, "first")
	if err != nil {
		t.Fatal(err)
	}
	second, err := s.Login(ctx, "admin", testPassword, "second")
	if err != nil {
		t.Fatal(err)
	}
	firstWatch, firstCancel, err := s.WatchSession(ctx, first.Token)
	if err != nil {
		t.Fatal(err)
	}
	defer firstCancel()
	secondWatch, secondCancel, err := s.WatchSession(ctx, second.Token)
	if err != nil {
		t.Fatal(err)
	}
	defer secondCancel()
	if err := s.Logout(ctx, first.Token); err != nil {
		t.Fatal(err)
	}
	select {
	case <-firstWatch.Done():
	case <-time.After(time.Second):
		t.Fatal("logout left its observation open")
	}
	select {
	case <-secondWatch.Done():
		t.Fatal("logout revoked a different session")
	default:
	}
	if _, err := s.Authenticate(ctx, second.Token); err != nil {
		t.Fatal(err)
	}
}
func TestUniformFailuresAndConcurrentLimitWindow(t *testing.T) {
	ctx := context.Background()
	now := time.Date(2026, 9, 30, 0, 0, 0, 0, time.UTC)
	s, _ := identityFixture(t, Options{Now: func() time.Time { return now }})
	if _, err := s.Bootstrap(ctx, "exists", testPassword); err != nil {
		t.Fatal(err)
	}
	_, wrong := s.Login(ctx, "exists", "wrong", "a")
	_, absent := s.Login(ctx, "absent", "wrong", "b")
	_, a := contracts.ProjectError(wrong)
	_, b := contracts.ProjectError(absent)
	if a != b {
		t.Fatal("account enumeration", a, b)
	}
	var wg sync.WaitGroup
	var failed, limited atomic.Int64
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := s.Login(ctx, "never-exists", "wrong", "same-source")
			_, v := contracts.ProjectError(err)
			if v.Code == "AUTHENTICATION_FAILED" {
				failed.Add(1)
			} else if v.Code == "RATE_LIMITED" {
				limited.Add(1)
			} else {
				t.Error(v)
			}
		}()
	}
	wg.Wait()
	if failed.Load() != 5 || limited.Load() != 3 {
		t.Fatal(failed.Load(), limited.Load())
	}
	_, err := s.Login(ctx, "exists", testPassword, "same-source")
	assertCode(t, err, "RATE_LIMITED")
	now = now.Add(time.Minute)
	if _, err := s.Login(ctx, "exists", testPassword, "same-source"); err != nil {
		t.Fatal(err)
	}
}
