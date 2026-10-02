//go:build integration

package coreapp

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"testing"
	"time"

	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/identity"
)

func TestNativeRetainedVolumePurgeIsAuthorizedDurableAndResumed(t *testing.T) {
	a, base, auth, work, ctx := nativeApplyFixture(t)
	ownerSession, err := a.Identity.Authenticate(ctx, strings.TrimPrefix(auth, "Bearer "))
	if err != nil {
		t.Fatal(err)
	}
	owner := ownerSession.Principal()
	volumes := func(app *Application) []corestore.VolumeRecord {
		t.Helper()
		var records []corestore.VolumeRecord
		if err := app.Store.Read(ctx, func(tx *sql.Tx) error {
			rows, err := tx.QueryContext(ctx, "SELECT id FROM volume_records WHERE work_id=? ORDER BY volume_role", work)
			if err != nil {
				return err
			}
			defer rows.Close()
			for rows.Next() {
				var id string
				if err := rows.Scan(&id); err != nil {
					return err
				}
				v, err := corestore.ReadVolume(tx, id)
				if err != nil {
					return err
				}
				records = append(records, v)
			}
			return rows.Err()
		}); err != nil {
			t.Fatal(err)
		}
		return records
	}
	initial := volumes(a)
	if len(initial) != 2 {
		t.Fatal(initial)
	}
	for _, v := range initial {
		if _, err := a.PurgeRetainedVolume(ctx, owner, v.ID); !errors.Is(err, corestore.ErrVolumeReferenced) {
			t.Fatal("referenced volume purge accepted", err)
		}
	}
	status, accepted := packageHTTPCall(t, base, "/api/v1/works/"+work+"/delete", "POST", auth, map[string]string{"idempotencyKey": "retain-before-purge"})
	if status != 202 {
		t.Fatal(status, accepted)
	}
	waitWorkOperation(t, ctx, a, accepted["operationId"].(string))
	retained := volumes(a)
	for _, v := range retained {
		if v.State != "retained" || v.ReferenceCount != 0 {
			t.Fatal("default delete lost retention", v)
		}
	}
	for _, role := range []string{"user", "admin"} {
		if _, err := a.Identity.CreateUser(ctx, identity.OperatorPrincipal(), "purge-"+role, "development-fixture-pass", role); err != nil {
			t.Fatal(err)
		}
	}
	login, err := a.Identity.Login(ctx, "purge-user", "development-fixture-pass", "retention")
	if err != nil {
		t.Fatal(err)
	}
	session, err := a.Identity.Authenticate(ctx, login.Token)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := a.PurgeRetainedVolume(ctx, session.Principal(), retained[0].ID); err == nil {
		t.Fatal("foreign user purged retained data")
	} else {
		status, public := contracts.ProjectError(err)
		if status != 404 || public.Code != "NOT_FOUND" {
			t.Fatal("foreign volume existence disclosed", err)
		}
	}
	// Fail the durable completion AFTER the real Engine deletion. The pending
	// record remains a policy slot and must be resumed without replaying data.
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec(`CREATE TRIGGER fail_volume_completion BEFORE UPDATE OF state ON volume_records WHEN NEW.state='purged' BEGIN SELECT RAISE(ABORT,'fixture completion failure'); END`)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := a.PurgeRetainedVolume(ctx, owner, retained[0].ID); err == nil {
		t.Fatal("failed completion falsely succeeded")
	}
	pending := volumes(a)
	if pending[0].State != "purge_pending" || pending[0].PurgedAt != nil {
		t.Fatal("uncommitted completion released record", pending[0])
	}
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		limit := int64(2)
		return corestore.CheckVolumeQuota(tx, work, &limit, nil, 1)
	}); !errors.Is(err, corestore.ErrQuotaExceeded) {
		t.Fatal("pending purge released policy slot", err)
	}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error { _, err := tx.Exec("DROP TRIGGER fail_volume_completion"); return err }); err != nil {
		t.Fatal(err)
	}
	opts := a.options
	opts.Initialization = Initialization{}
	shutdown, cancel := context.WithTimeout(ctx, 45*time.Second)
	if err := a.Close(shutdown); err != nil {
		cancel()
		t.Fatal(err)
	}
	cancel()
	next, _, _ := appFixture(t, opts)
	resumed := volumes(next)
	if next.Status().State != "READY" || resumed[0].State != "purged" || resumed[0].PurgedAt == nil || resumed[1].State != "retained" {
		t.Fatal("pending purge not recovered independently", next.Status(), resumed)
	}
	login, err = next.Identity.Login(ctx, "purge-admin", "development-fixture-pass", "retention")
	if err != nil {
		t.Fatal(err)
	}
	session, err = next.Identity.Authenticate(ctx, login.Token)
	if err != nil {
		t.Fatal(err)
	}
	purged, err := next.PurgeRetainedVolume(ctx, session.Principal(), resumed[1].ID)
	if err != nil || purged.State != "purged" {
		t.Fatal("authorized foreign administrator purge failed", purged, err)
	}
	managed, err := next.dockerRuntime.ListVolumes(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, v := range managed {
		if v.Name == retained[0].RuntimeName || v.Name == retained[1].RuntimeName {
			t.Fatal("purged volume still exists", v.Name)
		}
	}
	t.Log("explicit owner/admin cleanup, referenced conflict, pending quota and restart recovery", work)
}
