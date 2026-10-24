package coreapp

import (
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"piwork/internal/contracts"
	"testing"
)

func TestOlderAgentRejectsHistoryIndependently(t *testing.T) {
	failure := historyCapabilityError(status.Error(codes.Unimplemented, "older Agent"))
	code, body := contracts.ProjectError(failure)
	if code != 501 || body.Code != "HISTORY_UNSUPPORTED" {
		t.Fatal(code, body)
	}
}
