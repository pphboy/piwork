package contracts

import (
	"encoding/json"
	"strings"
	"testing"
)

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
