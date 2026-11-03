package contracts

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestModelIndependentThinkingCatalog(t *testing.T) {
	known := map[string]any{"modelRef": nil, "label": "Known", "provider": "openai", "model": "gpt-5.1", "thinkingLevels": []any{"off"}, "defaultThinkingLevel": "off", "compatibleThinkingProfiles": []any{map[string]any{"profile": "responses-effort-v1", "levels": []any{"off", "high", "xhigh", "max"}}}}
	list := map[string]any{"contractVersion": float64(5), "models": []any{known}, "defaultModel": known, "checkedAt": "2026-11-03T00:00:00Z", "availability": "available"}
	if err := Validate("ChatModelListSchema", list); err != nil {
		t.Fatal("known SDK Off-only model lost protocol compatibility", err)
	}
	for _, version := range []int{1, 2, 3, 4, 6} {
		list["contractVersion"] = float64(version)
		if Validate("ChatModelListSchema", list) == nil {
			t.Fatalf("version %d accepted new known-model shape", version)
		}
	}
	list["contractVersion"] = float64(5)
	list["models"] = []any{}
	if err := Validate("ChatModelListSchema", list); err != nil {
		t.Fatal("default-only catalog rejected", err)
	}
	known["credential"] = "synthetic-private"
	if Validate("ChatModelListSchema", list) == nil {
		t.Fatal("private credential accepted")
	}
}

func TestCompatibleThinkingRequestPresence(t *testing.T) {
	for _, tc := range []struct {
		raw           string
		present, null bool
	}{
		{`{"modelRef":null,"thinkingLevel":null}`, false, false},
		{`{"modelRef":null,"thinkingLevel":null,"thinkingProfile":null}`, true, true},
		{`{"modelRef":null,"thinkingLevel":"high","thinkingProfile":"responses-effort-v1"}`, true, false},
	} {
		value, err := Decode[SetSessionChatOptions](strings.NewReader(tc.raw), "SetSessionChatOptionsSchema", 1024)
		if err != nil {
			t.Fatalf("decode %s: %v", tc.raw, err)
		}
		if value.ThinkingProfile.Present != tc.present || value.ThinkingProfile.Null != tc.null {
			t.Fatalf("presence lost: %s", tc.raw)
		}
		encoded, err := json.Marshal(value)
		if err != nil || string(encoded) != tc.raw {
			t.Fatalf("round trip %s: %s %v", tc.raw, encoded, err)
		}
	}
	for _, raw := range []string{
		`{"modelRef":null,"thinkingLevel":null,"thinkingProfile":"responses-effort-v1"}`,
		`{"modelRef":null,"thinkingLevel":"max","thinkingProfile":"messages-budget-v1"}`,
	} {
		if _, err := Decode[SetSessionChatOptions](strings.NewReader(raw), "SetSessionChatOptionsSchema", 1024); err == nil {
			t.Fatalf("accepted invalid selection: %s", raw)
		}
	}
}
