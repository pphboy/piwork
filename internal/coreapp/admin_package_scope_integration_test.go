//go:build integration

package coreapp

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"piwork/internal/identity"
)

func TestNativeAdministratorPackageScopeAndAcceptedJobSurviveRevocation(t *testing.T) {
	a, base, firstAuth, work, ctx := nativeApplyFixture(t)
	second, err := a.Identity.CreateUser(ctx, identity.OperatorPrincipal(), "other-admin", "development-fixture-pass", "admin")
	if err != nil {
		t.Fatal(err)
	}
	secondLogin, err := a.Identity.Login(ctx, string(second.Account), "development-fixture-pass", "scope-fixture")
	if err != nil {
		t.Fatal(err)
	}
	secondAuth := "Bearer " + secondLogin.Token
	firstUpload := uploadNativePackageFixture(t, base, firstAuth, map[string]string{
		"package.json": `{"name":"admin-first","scripts":{"postinstall":"node -e \"setTimeout(()=>{},15000)\""},"pi":{"prompts":["review.md"]}}`,
		"review.md":    "Review the first administrator's result.",
	})
	secondUpload := uploadNativePackageFixture(t, base, secondAuth, map[string]string{
		"package.json": `{"name":"admin-second","pi":{"prompts":["review.md"]}}`,
		"review.md":    "Review the second administrator's result.",
	})
	install := func(auth, path, upload string) (int, map[string]any) {
		t.Helper()
		return packageHTTPCall(t, base, path, "POST", auth, map[string]any{"source": map[string]string{"kind": "upload", "uploadId": upload}, "idempotencyKey": "same-admin-scope-key"})
	}
	operator, err := os.ReadFile(filepath.Join(a.options.DataDirectory, "operator.credential"))
	if err != nil {
		t.Fatal(err)
	}
	for _, actor := range []struct{ auth, path string }{{secondAuth, "/api/v1/admin/packages"}, {"Operator " + strings.TrimSpace(string(operator)), "/control/packages"}} {
		status, foreign := install(actor.auth, actor.path, firstUpload)
		missingStatus, missing := install(actor.auth, actor.path, "upload-missing-fixture")
		if status != 404 || missingStatus != 404 || foreign["code"] != "PI_PACKAGE_NOT_FOUND" || missing["code"] != foreign["code"] {
			t.Fatal("foreign upload was distinguished or accepted", status, foreign, missingStatus, missing)
		}
	}
	status, accepted := install(firstAuth, "/api/v1/admin/packages", firstUpload)
	if status != 202 {
		t.Fatal(status, accepted)
	}
	firstID := accepted["operationId"].(string)
	if status, replay := install(firstAuth, "/api/v1/admin/packages", firstUpload); status != 202 || replay["operationId"] != firstID || replay["reused"] != true {
		t.Fatal("own accepted package replay lost", status, replay)
	}
	if status, busy := install(secondAuth, "/api/v1/admin/packages", secondUpload); status != 409 || busy["code"] != "PI_PACKAGE_BUSY" || busy["operationId"] == firstID {
		t.Fatal("different administrator bypassed shared gate or reused another job", status, busy)
	}
	status, firstIdentity := packageHTTPCall(t, base, "/api/v1/me", "GET", firstAuth, nil)
	if status != 200 {
		t.Fatal(status, firstIdentity)
	}
	if status, disabled := packageHTTPCall(t, base, "/api/v1/admin/users/"+firstIdentity["id"].(string)+"/disable", "POST", secondAuth, nil); status != 200 || disabled["enabled"] != false {
		t.Fatal("administrator revocation failed", status, disabled)
	}
	if status, _ := packageHTTPCall(t, base, "/api/v1/admin/operations/"+firstID, "GET", firstAuth, nil); status != 401 {
		t.Fatal("disabled actor retained query authorization", status)
	}
	wait := func(id string) {
		t.Helper()
		for {
			status, operation := packageHTTPCall(t, base, "/api/v1/admin/operations/"+id, "GET", secondAuth, nil)
			if status != 200 || operation["workId"] != nil {
				t.Fatal("second administrator cannot observe known Core job", status, operation)
			}
			if operation["state"] == "succeeded" {
				if operation["packagePhase"] != "succeeded" {
					t.Fatal(operation)
				}
				return
			}
			if operation["state"] == "failed" || ctx.Err() != nil {
				t.Fatal("accepted package was cancelled by login revocation", operation, ctx.Err())
			}
			time.Sleep(50 * time.Millisecond)
		}
	}
	wait(firstID)
	status, secondAccepted := install(secondAuth, "/api/v1/admin/packages", secondUpload)
	if status != 202 || secondAccepted["operationId"] == firstID || secondAccepted["reused"] != false {
		t.Fatal("same key was not isolated by actor", status, secondAccepted)
	}
	wait(secondAccepted["operationId"].(string))
	status, workView := packageHTTPCall(t, base, "/api/v1/works/"+work, "GET", secondAuth, nil)
	if status != 200 {
		t.Fatal(status, workView)
	}
	var workOperation string
	if err := a.Store.Read(context.Background(), func(tx *sql.Tx) error {
		return tx.QueryRow(`SELECT operation_id FROM idempotency_records WHERE resource_id=? AND operation_kind='create-work'`, work).Scan(&workOperation)
	}); err != nil {
		t.Fatal(err)
	}
	if status, unavailable := packageHTTPCall(t, base, "/api/v1/admin/operations/"+workOperation, "GET", secondAuth, nil); status != 404 || unavailable["code"] != "PI_PACKAGE_NOT_FOUND" {
		t.Fatal("Core package endpoint exposed a Work Operation", status, unavailable)
	}
}
