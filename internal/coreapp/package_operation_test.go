package coreapp

import (
	"encoding/json"
	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"strings"
	"testing"
)

func TestPackageOperationUsesPublicScopeContract(t *testing.T) {
	now := packageNow()
	result := `{"name":"fixture","version":"1.0.0","resourceCounts":{"extensions":1,"skills":1,"prompts":1,"themes":1},"scope":"core","privatePath":"/private/secret"}`
	operation := corestore.OperationRecord{ID: "operation-fixture", Kind: "pi-package-install", State: "succeeded", CreatedAt: now, UpdatedAt: now, ResultJSON: &result}
	job := corestore.PackageJob{OperationID: operation.ID, ScopeKind: "core", Phase: "succeeded"}
	view, err := packageOperationProjection(operation, job)
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(view)
	if _, err := contracts.Decode[contracts.AdminPackageOperation](strings.NewReader(string(encoded)), "AdminPackageOperationSchema", 64<<10); err != nil {
		t.Fatal(err, string(encoded))
	}
	if strings.Contains(string(encoded), "private") {
		t.Fatal("private result exposed", string(encoded))
	}
	broken := strings.Replace(result, `"skills":1,`, "", 1)
	operation.ResultJSON = &broken
	if _, err := packageOperationProjection(operation, job); err == nil {
		t.Fatal("partial resource counts accepted")
	}
	workID := "work-fixture-0001"
	operation.WorkID = &workID
	workResult := strings.Replace(result, `"scope":"core"`, `"scope":"work","pendingApply":true`, 1)
	operation.ResultJSON = &workResult
	job.WorkID = &workID
	job.ScopeKind = "work"
	view, err = packageOperationProjection(operation, job)
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ = json.Marshal(view)
	if _, err := contracts.Decode[contracts.PublicOperation](strings.NewReader(string(encoded)), "PublicOperationSchema", 64<<10); err != nil {
		t.Fatal(err, string(encoded))
	}
	if view["result"] == nil || strings.Contains(string(encoded), "private") {
		t.Fatal("safe package result missing or leaked private fields", string(encoded))
	}
}
