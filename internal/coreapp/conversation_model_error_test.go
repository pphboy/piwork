package coreapp

import (
	"reflect"
	"testing"

	"google.golang.org/protobuf/proto"
	"piwork/internal/rpc/agentv1"
)

func TestModelFailureSurvivesAgentWireAndCoreProjections(t *testing.T) {
	failure := &agentv1.RunError{Code: "MODEL_AUTHENTICATION_FAILED", Message: "Model authentication failed. Check the API Key or ask your administrator to update it.", Retryable: false}
	run := &agentv1.Run{WorkId: "work-1", SessionId: "session-1", RunId: "run-1", State: agentv1.RunState_RUN_STATE_FAILED, Error: failure}
	raw, err := proto.Marshal(run)
	if err != nil {
		t.Fatal(err)
	}
	var decoded agentv1.Run
	if err := proto.Unmarshal(raw, &decoded); err != nil {
		t.Fatal(err)
	}
	query := runView(&decoded).(map[string]any)["error"]
	event := &agentv1.RunEvent{WorkId: run.WorkId, SessionId: run.SessionId, RunId: run.RunId, Kind: &agentv1.RunEvent_State{State: &agentv1.StateEvent{State: run.State, Error: failure}}}
	raw, err = proto.Marshal(event)
	if err != nil {
		t.Fatal(err)
	}
	var decodedEvent agentv1.RunEvent
	if err := proto.Unmarshal(raw, &decodedEvent); err != nil {
		t.Fatal(err)
	}
	stream := runEventView(&decodedEvent).(map[string]any)["kind"].(map[string]any)["state"].(map[string]any)["error"]
	want := map[string]any{"code": failure.Code, "message": failure.Message, "retryable": false}
	if !reflect.DeepEqual(query, want) || !reflect.DeepEqual(stream, want) {
		t.Fatalf("Run query and event lost the provider error: query=%v event=%v", query, stream)
	}
}
