//go:build integration

package dockerengine

import (
	"context"
	"os"
	"testing"
)

// Native-image mode deliberately removes development overlays, so acceptance
// tests exercise only helper binaries/harness files delivered by the image.
// Earlier task fixtures retain their explicit old-image+read-only-overlay mode.
func migrationAgentImage(t *testing.T, engine *Engine, ctx context.Context) (PreparedImage, bool) {
	t.Helper()
	reference := os.Getenv("PIWORK_TEST_NATIVE_AGENT_IMAGE")
	native := reference != ""
	if !native {
		reference = "piwork-agentd:acceptance"
	}
	image, err := engine.InspectImage(ctx, reference)
	if err != nil {
		t.Fatal("prebuilt Agent acceptance image required", err)
	}
	if image.Labels["io.piwork.agent.variant"] != "acceptance" {
		t.Fatal("fixture requires acceptance variant")
	}
	if native && (image.Labels["io.piwork.package-helper.contract"] != "2" || image.Labels["io.piwork.service-mcp.contract"] != "1") {
		t.Fatal("native mode requires native helper image labels")
	}
	t.Log("Agent image:", image.ID, "native image files:", native)
	return image, native
}
