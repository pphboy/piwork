package coreapp

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"piwork/internal/corestore"
	"piwork/internal/identity"
)

func TestConversationAccessPrecedesAgentRoute(t *testing.T) {
	a, base, _ := appFixture(t, Options{Initialization: Initialization{Administrator: &struct{ Account, Password string }{"admin", "development-fixture-pass"}}})
	ctx := context.Background()
	owner, err := a.Identity.CreateUser(ctx, identity.OperatorPrincipal(), "owner", "development-fixture-pass", "user")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := a.Identity.CreateUser(ctx, identity.OperatorPrincipal(), "other", "development-fixture-pass", "user"); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		return corestore.InsertWork(tx, corestore.WorkRecord{ID: "work-conversation-1", OwnerUserID: string(owner.Id), Name: "conversation", DesiredState: "running", ObservedState: "ready", DesiredRevision: 1, ControlVersion: 1, CreatedAt: now, UpdatedAt: now})
	}); err != nil {
		t.Fatal(err)
	}
	ownerLogin, _ := a.Identity.Login(ctx, "owner", "development-fixture-pass", "fixture")
	otherLogin, _ := a.Identity.Login(ctx, "other", "development-fixture-pass", "fixture")
	adminLogin, _ := a.Identity.Login(ctx, "admin", "development-fixture-pass", "fixture")
	path := "/api/v1/works/work-conversation-1/sessions"
	if status, body := httpCall(t, base, path, "GET", "Bearer "+otherLogin.Token, nil); status != 404 || body["code"] != "NOT_FOUND" {
		t.Fatal("foreign Work metadata leaked", status, body)
	}
	if status, body := httpCall(t, base, path, "GET", "Bearer "+adminLogin.Token, nil); status != 403 || body["code"] != "PERMISSION_DENIED" {
		t.Fatal("administrator gained conversation content", status, body)
	}
	if status, body := httpCall(t, base, path, "GET", "Bearer "+ownerLogin.Token, nil); status != 503 || body["code"] != "WORK_UNAVAILABLE" {
		t.Fatal("owner reached an unvalidated Agent route", status, body)
	}
}
