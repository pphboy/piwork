package agentclient

import (
	"context"
	"encoding/json"
	"errors"
	"google.golang.org/grpc"
	"piwork/internal/contracts"
	"piwork/internal/internaltls"
	"piwork/internal/rpc/agentv1"
	"testing"
)

type historyRPC struct {
	agentv1.AgentServiceClient
	page map[string]any
}

func (f *historyRPC) ReadSessionPage(context.Context, *agentv1.ReadSessionPageRequest, ...grpc.CallOption) (*agentv1.SessionHistoryPage, error) {
	raw, _ := json.Marshal(f.page)
	return &agentv1.SessionHistoryPage{PageJson: string(raw)}, nil
}
func TestHistoryWireRejectsForeignRangesAndNonAdvancingCursor(t *testing.T) {
	session := map[string]any{"workId": "work-1", "sessionId": "session-1", "createdAt": "2026-10-23T00:00:00Z", "updatedAt": "2026-10-23T00:00:00Z", "modelPreference": nil, "thinkingLevel": "off", "source": map[string]string{"kind": "chat"}}
	part := map[string]any{"entryId": "entry-1", "entryOrder": 0, "role": "assistant", "runId": "", "blockId": "block-1", "blockIndex": 0, "blockCount": 1, "type": "text", "byteOffset": 0, "totalBytes": 3, "complete": true, "text": "汉"}
	f := &historyRPC{page: map[string]any{"contractVersion": 1, "session": session, "snapshotId": "one", "segments": []any{part}, "runs": []any{}, "nextCursor": nil, "hasMore": false}}
	c := &Client{rpc: f, scope: internaltls.Scope{WorkID: "work-1"}}
	if _, err := c.ReadSessionPage(context.Background(), "session-1", contracts.HistoryQuery{}); err != nil {
		t.Fatal(err)
	}
	for _, mutate := range []func(){func() { session["sessionId"] = "other" }, func() { session["sessionId"] = "session-1"; part["byteOffset"] = 1 }, func() { part["byteOffset"] = 0; part["blockCount"] = 0 }, func() { part["blockCount"] = 1; f.page["hasMore"] = true; f.page["nextCursor"] = "same" }} {
		mutate()
		if _, err := c.ReadSessionPage(context.Background(), "session-1", contracts.HistoryQuery{Cursor: contracts.Supplied("same")}); !errors.Is(err, ErrResponse) {
			t.Fatal("invalid wire accepted", err)
		}
	}
}
func TestHistoryProfileRequiresBoundedSameRunReference(t *testing.T) {
	c := (&Client{}).WithHistoryProfile()
	null := "null"
	run := &agentv1.Run{WorkId: "work-1", SessionId: "session-1", RunId: "run-1", ResultRefJson: &null}
	if !c.validRun(run) {
		t.Fatal("valid null reference")
	}
	run.FinalText = "large"
	if c.validRun(run) {
		t.Fatal("profile leaked final text")
	}
	run.FinalText = ""
	ref := `{"workId":"work-2","sessionId":"session-1","runId":"run-1","content":"result"}`
	run.ResultRefJson = &ref
	if c.validRun(run) {
		t.Fatal("foreign result reference")
	}
}
