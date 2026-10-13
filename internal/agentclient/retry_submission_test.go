package agentclient

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"piwork/internal/contracts"
	"piwork/internal/internaltls"
	"piwork/internal/rpc/agentv1"
)

type retryLookupFixture struct {
	agentv1.AgentServiceClient
	value map[string]any
	err   error
	calls int
}

func (f *retryLookupFixture) LookupAgentRequestRetrySubmission(_ context.Context, r *agentv1.AgentContentRequest, _ ...grpc.CallOption) (*agentv1.AgentContentResponse, error) {
	f.calls++
	if r.WorkId != "work-a" || r.ObjectId != "original" || r.InputJson != `{"submissionKey":"key"}` {
		return nil, errors.New("wrong original scope")
	}
	raw, _ := json.Marshal(f.value)
	return &agentv1.AgentContentResponse{ValueJson: string(raw)}, f.err
}
func TestRetryLookupOriginalScopeAndLegacyUnsupported(t *testing.T) {
	original := map[string]any{"workId": "work-a", "requestId": "original", "submissionKey": "key", "status": "not-found", "request": nil, "checkedAt": "2026-10-12T00:00:00Z"}
	f := &retryLookupFixture{value: original}
	c := &Client{rpc: f, scope: internaltls.Scope{WorkID: "work-a"}}
	query := contracts.AgentRequestRetryQuery{SubmissionKey: "key"}
	value, err := c.LookupAgentRequestRetrySubmission(context.Background(), "original", query)
	if err != nil || value.Status != "not-found" {
		t.Fatal(value, err)
	}
	for _, field := range []string{"workId", "requestId", "submissionKey"} {
		saved := f.value[field]
		f.value[field] = "foreign"
		if _, err = c.LookupAgentRequestRetrySubmission(context.Background(), "original", query); !errors.Is(err, ErrResponse) {
			t.Fatal(field, err)
		}
		f.value[field] = saved
	}
	request := map[string]any{"requestId": "retried", "source": map[string]any{"kind": "chat"}, "goal": "Original goal", "state": "pending", "disposition": "live", "createdAt": "2026-10-12T00:00:00Z", "updatedAt": "2026-10-12T00:00:00Z", "expiresAt": "2026-10-12T01:00:00Z", "retryOf": "original", "autoRunCount": 0, "waitRef": nil, "runIds": []string{}, "evidenceIds": []string{}, "result": nil, "error": nil}
	f.value["status"] = "accepted"
	f.value["request"] = request
	if value, err = c.LookupAgentRequestRetrySubmission(context.Background(), "original", query); err != nil || value.Status != "accepted" {
		t.Fatal("accepted mapping", value, err)
	}
	request["retryOf"] = "foreign"
	if _, err = c.LookupAgentRequestRetrySubmission(context.Background(), "original", query); !errors.Is(err, ErrResponse) {
		t.Fatal("wrong retryOf", err)
	}
	request["retryOf"] = "original"
	request["requestId"] = "original"
	if _, err = c.LookupAgentRequestRetrySubmission(context.Background(), "original", query); !errors.Is(err, ErrResponse) {
		t.Fatal("original returned as retry", err)
	}
	f.value["request"] = nil
	f.value["status"] = "accepted"
	if _, err = c.LookupAgentRequestRetrySubmission(context.Background(), "original", query); !errors.Is(err, ErrResponse) {
		t.Fatal("accepted null", err)
	}
	f.err = status.Error(codes.Unimplemented, "older Agent")
	if _, err = c.LookupAgentRequestRetrySubmission(context.Background(), "original", query); err == nil || err.Error() != "Retry submission lookup is not supported" {
		t.Fatal(err)
	}
	before := f.calls
	for _, key := range []string{"", "x" + string(make([]byte, 256))} {
		if _, err = c.LookupAgentRequestRetrySubmission(context.Background(), "original", contracts.AgentRequestRetryQuery{SubmissionKey: key}); err == nil {
			t.Fatal("invalid key")
		}
	}
	if f.calls != before {
		t.Fatal("invalid query reached RPC")
	}
}
