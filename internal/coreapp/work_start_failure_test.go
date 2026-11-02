package coreapp

import (
	"context"
	"encoding/json"
	"errors"
	"piwork/internal/corestore"
	"strings"
	"testing"
)

func TestStartFailureBoundaryNeverProjectsRawError(t *testing.T) {
	for _, tc := range []struct {
		err   error
		class string
	}{{errCapturedWork, "captured-context"}, {corestore.ErrStorage, "storage"}, {context.Canceled, "cancelled"}, {errors.New("SECRET /private/config"), "other"}} {
		value := startFailureProjection("work-original-00000001", "operation-original-00000001", "retry-admission", tc.err)
		if value["boundary"] != "retry-admission" || value["errorClass"] != tc.class {
			t.Fatal(value)
		}
		raw, _ := json.Marshal(value)
		if strings.Contains(string(raw), "SECRET") || strings.Contains(string(raw), "/private") {
			t.Fatal("private diagnostic escaped")
		}
	}
	if startFailureProjection("/private/work", "operation-original-00000001", "retry-admission", nil) != nil {
		t.Fatal("invalid identity escaped")
	}
	if startFailureProjection("work-original-00000001", "operation-original-00000001", "/private/phase", nil)["boundary"] != "other" {
		t.Fatal("invalid boundary escaped")
	}
}
