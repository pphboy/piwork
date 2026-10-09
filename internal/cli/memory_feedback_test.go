package cli

import (
	"strings"
	"testing"
)

func TestMemoryToolSummaryUsesActualToolOutcomeWithoutChangingTheEnvelope(t *testing.T) {
	cases := []struct {
		text, want string
		failed     bool
	}{
		{`{"version":1,"status":"staged"}`, "candidate v1 proposed; not effective", false},
		{`{"memoryCommit":{"version":2,"status":"effective","evidenceIds":["proof"]}}`, "effective v2", false},
		{`{"adoptedExperienceVersion":1,"effectiveVersion":2}`, "this Run uses v1; current effective v2", false},
		{`{"version":3,"status":"invalidated"}`, "invalidated at v3", false},
		{`{"memoryCommit":{"version":2,"status":"effective"}}`, "operation failed; no effective update confirmed", true},
	}
	for _, item := range cases {
		if got := memoryToolSummary("brain_experience", item.failed, "text", item.text); !strings.Contains(got, item.want) {
			t.Fatal(got, item.want)
		}
	}
	for _, text := range []string{`{"version":-1,"status":"staged"}`, `{"memoryCommit":{"version":2.1,"status":"effective"}}`, `partial JSON`, `{"summary":"model claims verified"}`} {
		if got := memoryToolSummary("brain_experience", false, "text", text); got != "" {
			t.Fatal("invented outcome", got)
		}
	}
	if got := memoryToolSummary("bash", false, "text", cases[1].text); got != "" {
		t.Fatal("non-authoritative tool claimed Memory", got)
	}
}
