package coreapp

import (
	"bytes"
	"encoding/json"
	"testing"

	"piwork/internal/contracts"
)

func TestDefaultWorkConfigurationMatchesPublicContract(t *testing.T) {
	configuration := defaultWorkConfiguration(RuntimeProfile{Version: 1, Revision: 12})
	raw, err := json.Marshal(configuration)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := contracts.Decode[contracts.WorkConfig](bytes.NewReader(raw), "WorkConfigSchema", 2<<20)
	if err != nil {
		t.Fatal("default Work configuration fails current contract", err, string(raw))
	}
	if decoded.AgentImage.CatalogId != "runtime-image-00000012" || decoded.ModelRef != "runtime-model-00000012" || len(decoded.Skills) != 1 || decoded.Skills[0] != "deploy-work-service" || len(decoded.McpServers) != 1 {
		t.Fatal("default Work resource references drifted", decoded)
	}
	if string(raw) == "" || bytes.Contains(raw, []byte(`"revision"`)) {
		t.Fatal("internal runtime revision leaked into public Work configuration", string(raw))
	}
}
