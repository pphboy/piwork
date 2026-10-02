package cli

import (
	"bytes"
	"encoding/json"
	"path/filepath"
	"testing"
)

func TestOfflineInspectRunsWithoutCredentialOrCore(t *testing.T) {
	t.Setenv("PIWORK_CONFIG_PATH", filepath.Join(t.TempDir(), "missing", "client.json"))
	t.Setenv("PIWORK_CORE_URL", "http://127.0.0.1:1")
	path := filepath.Join("..", "workpackage", "testdata", "golden-native-pi-package.work")
	var out, diagnostic bytes.Buffer
	if code := runUser([]string{"--json", "work", "package", "inspect", path}, &out, &diagnostic); code != 0 {
		t.Fatal(code, diagnostic.String())
	}
	var result struct{ IntegrityVerified, InstallationValidated bool }
	if err := json.Unmarshal(out.Bytes(), &result); err != nil || !result.IntegrityVerified || result.InstallationValidated {
		t.Fatal("offline summary is incorrect", out.String(), err)
	}
}
