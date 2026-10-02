package coreapp

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"piwork/internal/corestore"
	"piwork/internal/identity"
)

func TestHTTPAdministratorControlsForeignWorkWithoutContentAccess(t *testing.T) {
	a, base, operator := appFixture(t, Options{Initialization: Initialization{Administrator: &struct{ Account, Password string }{"admin", "development-fixture-pass"}}})
	ctx := context.Background()
	owner, err := a.Identity.CreateUser(ctx, identity.OperatorPrincipal(), "matrix-owner", "development-fixture-pass", "user")
	if err != nil {
		t.Fatal(err)
	}
	_, err = a.Identity.CreateUser(ctx, identity.OperatorPrincipal(), "matrix-other", "development-fixture-pass", "user")
	if err != nil {
		t.Fatal(err)
	}
	now := packageNow()
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		return corestore.InsertWork(tx, corestore.WorkRecord{ID: "work-matrix-owner", OwnerUserID: string(owner.Id), Name: "Owner", DesiredState: "stopped", ObservedState: "stopped", DesiredRevision: 1, ControlVersion: 1, CreatedAt: now, UpdatedAt: now})
	}); err != nil {
		t.Fatal(err)
	}
	admin, err := a.Identity.Login(ctx, "admin", "development-fixture-pass", "matrix")
	if err != nil {
		t.Fatal(err)
	}
	other, err := a.Identity.Login(ctx, "matrix-other", "development-fixture-pass", "matrix")
	if err != nil {
		t.Fatal(err)
	}
	adminAuth, otherAuth := "Bearer "+admin.Token, "Bearer "+other.Token
	for _, suffix := range []string{"/sessions", "/sessions/session-fixture", "/runs/run-fixture", "/services/service-fixture/logs", "/services/service-fixture/revisions"} {
		path := "/api/v1/works/work-matrix-owner" + suffix
		if status, result := httpCall(t, base, path, "GET", adminAuth, nil); status != 403 || result["code"] != "PERMISSION_DENIED" {
			t.Fatal("administrator read owner content", path, status, result)
		}
		status, foreign := httpCall(t, base, path, "GET", otherAuth, nil)
		absentStatus, absent := httpCall(t, base, strings.Replace(path, "work-matrix-owner", "work-matrix-absent", 1), "GET", otherAuth, nil)
		left, _ := json.Marshal(foreign)
		right, _ := json.Marshal(absent)
		if status != 404 || absentStatus != 404 || !bytes.Equal(left, right) {
			t.Fatal("foreign Work distinguished from absence", path, status, foreign, absentStatus, absent)
		}
	}
	fileResponse := func(work, auth string) (int, []byte) {
		t.Helper()
		request, err := http.NewRequest("GET", base+"/api/v1/works/"+work+"/files/value", nil)
		if err != nil {
			t.Fatal(err)
		}
		request.Header.Set("Authorization", auth)
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		body, err := io.ReadAll(response.Body)
		if err != nil {
			t.Fatal(err)
		}
		return response.StatusCode, body
	}
	if status, _ := fileResponse("work-matrix-owner", adminAuth); status != 404 {
		t.Fatal("administrator read foreign DAV content", status)
	}
	foreignStatus, foreignBody := fileResponse("work-matrix-owner", otherAuth)
	absentStatus, absentBody := fileResponse("work-matrix-absent", otherAuth)
	if foreignStatus != 404 || absentStatus != 404 || !bytes.Equal(foreignBody, absentBody) {
		t.Fatal("DAV distinguished foreign Work", foreignStatus, absentStatus, string(foreignBody), string(absentBody))
	}
	if status, result := httpCall(t, base, "/api/v1/works/work-matrix-owner", "GET", adminAuth, nil); status != 200 || result["ownerUserId"] != string(owner.Id) {
		t.Fatal(status, result)
	}
	foreignActionStatus, foreignAction := httpCall(t, base, "/api/v1/works/work-matrix-owner/stop", "POST", otherAuth, map[string]string{"idempotencyKey": "foreign-stop"})
	absentActionStatus, absentAction := httpCall(t, base, "/api/v1/works/work-matrix-absent/stop", "POST", otherAuth, map[string]string{"idempotencyKey": "foreign-stop"})
	foreignBytes, _ := json.Marshal(foreignAction)
	absentBytes, _ := json.Marshal(absentAction)
	if foreignActionStatus != 404 || absentActionStatus != 404 || !bytes.Equal(foreignBytes, absentBytes) {
		t.Fatal("foreign Work control distinguished from absence", foreignActionStatus, foreignAction, absentActionStatus, absentAction)
	}
	if status, result := httpCall(t, base, "/api/v1/works/work-matrix-owner/stop", "POST", adminAuth, map[string]string{"idempotencyKey": "admin-stop-owner"}); status != 202 || result["operationId"] == nil {
		t.Fatal("administrator control denied", status, result)
	}
	if status, _ := httpCall(t, base, "/api/v1/works/work-matrix-owner", "GET", "Operator "+operator, nil); status != 401 {
		t.Fatal("operator entered user API", status)
	}
}

func TestAdminRoutesRejectOrdinaryUserBeforeReadingMutationBodies(t *testing.T) {
	a, _, _ := appFixture(t, Options{Initialization: Initialization{Administrator: &struct{ Account, Password string }{"admin", "development-fixture-pass"}}})
	ctx := context.Background()
	if _, err := a.Identity.CreateUser(ctx, identity.OperatorPrincipal(), "matrix-user", "development-fixture-pass", "user"); err != nil {
		t.Fatal(err)
	}
	login, err := a.Identity.Login(ctx, "matrix-user", "development-fixture-pass", "matrix")
	if err != nil {
		t.Fatal(err)
	}
	for _, route := range []struct{ method, path string }{{"GET", "status"}, {"GET", "users"}, {"POST", "users"}, {"POST", "users/user-fixture/disable"}, {"POST", "users/user-fixture/reset-password"}, {"GET", "runtime"}, {"PUT", "runtime"}, {"GET", "default-work"}, {"PATCH", "default-work"}, {"GET", "skills"}, {"POST", "skills"}, {"PUT", "skills/skill-fixture"}, {"GET", "packages"}, {"POST", "packages"}, {"POST", "package-uploads"}, {"GET", "operations/operation-fixture"}} {
		body := &countedUploadBody{}
		request := httptest.NewRequest(route.method, "/api/v1/admin/"+route.path, body)
		request.Header.Set("Authorization", "Bearer "+login.Token)
		request.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		a.route(response, request)
		if response.Code != 403 || body.reads != 0 {
			t.Fatal("admin authorization did not precede I/O", route, response.Code, body.reads, response.Body.String())
		}
	}
}
