package contracts

import "testing"

func TestProtocolModelEndpointNormalizationIsIdempotentAndPreservesCapturedFacts(t *testing.T) {
	for _, raw := range []string{"https://EXAMPLE.test:443/prefix", "https://example.test/prefix/v1", "https://example.test/prefix/v1/", "https://example.test/prefix/v1/v1/"} {
		normalized, err := NormalizeProtocolModelEndpoint("anthropic-messages", &raw)
		if err != nil || normalized == nil || *normalized != "https://example.test/prefix" {
			t.Fatal("Messages normalization failed", normalized, err)
		}
		again, err := NormalizeProtocolModelEndpoint("anthropic-messages", normalized)
		if err != nil || *again != *normalized {
			t.Fatal("normalization is not idempotent")
		}
	}
	raw := "https://example.test/prefix/v1"
	for _, normalize := range []func(*string) (*string, error){NormalizeModelEndpoint, func(v *string) (*string, error) { return NormalizeProtocolModelEndpoint("openai-responses", v) }} {
		result, err := normalize(&raw)
		if err != nil || *result != raw {
			t.Fatal("Responses or retained descriptor changed", result, err)
		}
	}
	for _, raw := range []string{"not-a-url", "https://user:secret@example.test/v1", "https://example.test/v1?key=secret", "https://example.test/v1#secret"} {
		if _, err := NormalizeProtocolModelEndpoint("anthropic-messages", &raw); err == nil {
			t.Fatal("unsafe endpoint accepted")
		}
	}
}
