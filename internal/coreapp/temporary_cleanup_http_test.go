package coreapp

import (
	"context"
	"database/sql"
	"net/http/httptest"
	"strings"
	"testing"

	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/identity"
)

func TestTemporaryCleanupHistoryIsOwnerScopedAfterWorkDeletion(t *testing.T) {
	a, actor, work := serviceAcceptFixture(t)
	ctx := context.Background()
	owner := corestore.TemporaryRunOwner{WorkID: work, RunID: "run-temporary-0000000001", Generation: 1, InstanceID: "agent-test"}
	lease, err := a.Store.OpenTemporaryRunLease(ctx, owner, packageNow())
	if err != nil {
		t.Fatal(err)
	}
	record := corestore.TemporaryServiceRecord{Version: 1, Owner: owner, ServiceID: "service-temporary-00000001", CreateOperationID: "operation-create-00000001", Mode: "once", State: "accepted", UpdatedAt: packageNow()}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error { return corestore.AcceptTemporaryServiceTx(tx, record, lease.LeaseID) }); err != nil {
		t.Fatal(err)
	}
	accepted, err := a.ensureTemporaryCleanupOperation(ctx, record, "run-cancelled")
	if err != nil {
		t.Fatal(err)
	}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec(`UPDATE works SET desired_state='deleted',observed_state='deleted',deleted_at=? WHERE id=?`, packageNow(), work)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	path := "/api/v1/works/" + work + "/temporary-cleanups?runId=" + owner.RunID
	request := httptest.NewRequest("GET", path, nil)
	response := httptest.NewRecorder()
	handled, err := a.temporaryCleanupHTTP(response, request, *actor.User)
	if !handled || err != nil || response.Code != 200 || !strings.Contains(response.Body.String(), accepted.OperationID) || !strings.Contains(response.Body.String(), owner.RunID) {
		t.Fatal("owner lost cleanup history after deletion", handled, err, response.Code, response.Body.String())
	}
	if strings.Contains(response.Body.String(), lease.LeaseID) {
		t.Fatal("private lease leaked into cleanup history")
	}
	for _, foreign := range []identity.Principal{{UserID: "other-admin", Role: "admin"}, {UserID: "other-user", Role: "user"}} {
		response = httptest.NewRecorder()
		handled, err = a.temporaryCleanupHTTP(response, request, foreign)
		if !handled || err == nil {
			t.Fatal("foreign user read private cleanup history")
		}
		status, _ := contracts.ProjectError(err)
		if status != 403 && status != 404 {
			t.Fatal("wrong foreign access error", status)
		}
	}
}
