package coreapp

import (
	"bytes"
	"context"
	"encoding/json"
	"testing"

	"piwork/internal/contracts"
)

func TestFileCapabilityIsIndependentAuthenticatedAndFrozenContract(t *testing.T) {
	a, base, _ := appFixture(t, Options{Initialization: Initialization{Administrator: &struct{ Account, Password string }{"admin", "development-fixture-pass"}}})
	if code, _ := httpCall(t, base, "/api/v1/file-access", "GET", "", nil); code != 401 {
		t.Fatal(code)
	}
	login, err := a.Identity.Login(context.Background(), "admin", "development-fixture-pass", "files")
	if err != nil {
		t.Fatal(err)
	}
	code, body := httpCall(t, base, "/api/v1/file-access", "GET", "Bearer "+login.Token, nil)
	if code != 200 || body["available"] != false || body["reason"] != "FILE_HELPER_UNAVAILABLE" {
		t.Fatal(code, body)
	}
	raw, _ := json.Marshal(body)
	if _, err := contracts.Decode[map[string]any](bytes.NewReader(raw), "FileAccessCapabilitySchema", 65536); err != nil {
		t.Fatal("capability differs from frozen TS contract", err)
	}
	if a.Status().State != "RUNTIME_NOT_CONFIGURED" {
		t.Fatal("file helper absence changed Core startup", a.Status())
	}
	if a.fileEpoch < 1 {
		t.Fatal("file Core epoch was not initialized")
	}
}
