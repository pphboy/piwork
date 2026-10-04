package coreapp

import (
	"net/http/httptest"
	"testing"
)

func TestFeedbackReadQueryRejectsAmbiguousAndForeignFilters(t *testing.T) {
	for _, item := range []struct {
		query, schema string
		valid         bool
	}{
		{"?limit=25&serviceName=workstation", "AgentRequestQuerySchema", true},
		{"?limit=1&cursor=stable-cursor", "AgentEvidenceQuerySchema", true},
		{"?limit=0", "AgentRequestQuerySchema", false},
		{"?limit=101", "AgentRequestQuerySchema", false},
		{"?limit=25&limit=26", "AgentRequestQuerySchema", false},
		{"?cursor=", "AgentEvidenceQuerySchema", false},
		{"?workId=work-foreign", "AgentRequestQuerySchema", false},
		{"?serviceName=other", "AgentEvidenceQuerySchema", false},
		{"?limit=25&%broken", "AgentRequestQuerySchema", false},
	} {
		t.Run(item.query, func(t *testing.T) {
			_, err := feedbackQuery(httptest.NewRequest("GET", "/"+item.query, nil), item.schema)
			if (err == nil) != item.valid {
				t.Fatal(item.query, err)
			}
		})
	}
}
