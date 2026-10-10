//go:build linux

package workhistory

import "testing"

func TestManagedModelHistoryAcceptsKnownPrivateDescriptorsOnly(t *testing.T) {
	model := map[string]any{"modelRef": "model-config-fixture-00001", "label": "Provider / Model", "provider": "openai", "model": "gpt-5.1", "api": "openai-responses", "baseUrl": "https://fixture.invalid/v1", "capabilities": map[string]any{"kind": "sdk", "provider": "openai", "model": "gpt-5.1"}, "executionBindingId": "model-execution-fixture-00001", "thinkingLevel": "high"}
	if !validHistoryModel(model) {
		t.Fatal("managed descriptor rejected")
	}
	for _, change := range []map[string]any{{"api": "openai-completions"}, {"provider": "anthropic"}, {"credential": "synthetic-must-not-persist"}, {"executionBindingId": "../secret"}, {"capabilities": map[string]any{"kind": "explicit", "defaultThinking": "high"}}} {
		copy := map[string]any{}
		for k, v := range model {
			copy[k] = v
		}
		for k, v := range change {
			copy[k] = v
		}
		if validHistoryModel(copy) {
			t.Fatal("invalid private model field admitted")
		}
	}
}
