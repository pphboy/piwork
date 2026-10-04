package contracts

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestCurrentBrainCandidateContract(t *testing.T) {
	target := map[string]any{"contractVersion": int64(1), "toolName": "package:piwork-brain:brain_review_probe", "input": map[string]any{"format": "completed-first"}, "checkNames": []any{"review_format"}}
	candidate := map[string]any{"submissionKey": "submission-1", "requestId": "request-1", "verificationGoal": "verify review", "verificationTarget": target, "expectedSourceDigest": "sha256:" + strings.Repeat("a", 64), "activeDigest": "sha256:" + strings.Repeat("b", 64), "desiredDigest": "sha256:" + strings.Repeat("c", 64), "activeContextId": "context-1"}
	if err := Validate("BrainCandidateSubmissionSchema", candidate); err != nil {
		t.Fatal(err)
	}
	delete(candidate, "verificationTarget")
	if err := Validate("BrainCandidateSubmissionSchema", candidate); err == nil {
		t.Fatal("candidate without fixed verification target accepted")
	}
	candidate["verificationTarget"] = target
	candidate["credential"] = "private"
	if err := Validate("BrainCandidateSubmissionSchema", candidate); err == nil {
		t.Fatal("unknown candidate field accepted")
	}
	delete(candidate, "credential")
	for name, change := range map[string]func(map[string]any){
		"platform tool":      func(v map[string]any) { v["toolName"] = "builtin:read" },
		"recursive feedback": func(v map[string]any) { v["toolName"] = "package:piwork-brain:brain_feedback" },
		"recursive update":   func(v map[string]any) { v["toolName"] = "package:piwork-brain:brain_package_update" },
		"empty checks":       func(v map[string]any) { v["checkNames"] = []any{} },
		"duplicate checks":   func(v map[string]any) { v["checkNames"] = []any{"same", "same"} },
		"secret":             func(v map[string]any) { v["input"] = map[string]any{"credentials": "private"} },
		"host path":          func(v map[string]any) { v["input"] = map[string]any{"path": "/tmp/private"} },
		"url":                func(v map[string]any) { v["input"] = map[string]any{"endpoint": "http://old-work:8080"} },
		"utf8 bytes":         func(v map[string]any) { v["input"] = map[string]any{"text": strings.Repeat("中", 3000)} },
	} {
		t.Run(name, func(t *testing.T) {
			v := map[string]any{}
			for k, x := range target {
				v[k] = x
			}
			change(v)
			if err := Validate("BrainVerificationTargetSchema", v); err == nil {
				t.Fatal("unsafe target accepted")
			}
			candidate["verificationTarget"] = v
			if err := Validate("BrainCandidateSubmissionSchema", candidate); err == nil {
				t.Fatal("unsafe nested target accepted")
			}
		})
	}
}

func TestSessionModelFieldPresence(t *testing.T) {
	for _, tt := range []struct {
		raw           string
		present, null bool
		value         string
	}{
		{`{}`, false, false, ""}, {`{"modelRef":null}`, true, true, ""}, {`{"modelRef":"model-0000000000000001"}`, true, false, "model-0000000000000001"},
	} {
		var v struct {
			ModelRef Field[string] `json:"modelRef,omitzero"`
		}
		if err := json.Unmarshal([]byte(tt.raw), &v); err != nil {
			t.Fatal(err)
		}
		if v.ModelRef.Present != tt.present || v.ModelRef.Null != tt.null || v.ModelRef.Value != tt.value {
			t.Fatalf("presence lost: %s %+v", tt.raw, v)
		}
		out, err := json.Marshal(v)
		if err != nil || string(out) != tt.raw {
			t.Fatalf("presence roundtrip: %s %s %v", tt.raw, out, err)
		}
	}
	for _, raw := range []string{`{}`, `{"modelRef":""}`, `{"modelRef":null,"credential":"secret"}`} {
		if _, err := Decode[SetSessionModel](strings.NewReader(raw), "SetSessionModelSchema", 1<<10); err == nil {
			t.Fatalf("invalid preference accepted: %s", raw)
		}
	}
	for _, raw := range []string{`{"modelRef":null}`, `{"modelRef":"model-0000000000000001"}`} {
		if _, err := Decode[SetSessionModel](strings.NewReader(raw), "SetSessionModelSchema", 1<<10); err != nil {
			t.Fatal(err)
		}
	}
}
