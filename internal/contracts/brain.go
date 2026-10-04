package contracts

import (
	"bytes"
	"encoding/json"
	"regexp"
)

var brainSecretKey = regexp.MustCompile(`(?i)token|credential|secret|password|authorization|privateKey|certificate|hostPath`)
var brainUnsafeText = regexp.MustCompile(`(?i)https?://|\bBearer\s+\S+|/(?:home|run|var|tmp|etc|proc|root|mnt|opt)/`)

// A target is current-agent input, never a platform script or credential carrier.
// This supplements the structural schema with the TS harness's byte/safety rules.
func validateBrainTarget(value any) error {
	target, ok := value.(map[string]any)
	if !ok {
		return invalid("verificationTarget")
	}
	input := target["input"]
	if !safeBrainInput(input) || !boundedBrainJSON(input, 8<<10) || !boundedBrainJSON(target, 16<<10) {
		return invalid("verificationTarget")
	}
	return nil
}

func boundedBrainJSON(value any, limit int) bool {
	var b bytes.Buffer
	e := json.NewEncoder(&b)
	e.SetEscapeHTML(false)
	return e.Encode(value) == nil && b.Len()-1 <= limit
}

func safeBrainInput(value any) bool {
	switch v := value.(type) {
	case nil, bool, int64, float64:
		return true
	case string:
		return !brainUnsafeText.MatchString(v)
	case []any:
		for _, child := range v {
			if !safeBrainInput(child) {
				return false
			}
		}
		return true
	case map[string]any:
		for key, child := range v {
			if brainSecretKey.MatchString(key) || !safeBrainInput(child) {
				return false
			}
		}
		return true
	}
	return false
}
