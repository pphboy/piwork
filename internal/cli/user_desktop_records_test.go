package cli

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestNativeDesktopOperationRecordsAreDurableAndScoped(t *testing.T) {
	root := t.TempDir()
	records := desktopOperationRecords{credentialPath: filepath.Join(root, "credential.json")}
	accepted := json.RawMessage(`{"operationId":"operation-1","workId":"work-1"}`)
	if err := records.accept("https://core-a.example", "user-a", "Create Work", accepted); err != nil {
		t.Fatal(err)
	}
	other := desktopOperationRecords{credentialPath: filepath.Join(root, "credential.json")}
	items, err := other.list("https://core-a.example", "user-a")
	if err != nil || len(items) != 1 || items[0].WorkID != "work-1" || items[0].Type != "Create Work" {
		t.Fatal("accepted Operation was not restored", items, err)
	}
	for _, identity := range [][2]string{{"https://core-b.example", "user-a"}, {"https://core-a.example", "user-b"}} {
		foreign, err := other.list(identity[0], identity[1])
		if err != nil || len(foreign) != 0 {
			t.Fatal("Operation crossed Core/user boundary", identity, foreign, err)
		}
	}
	if err := other.markTerminal("https://core-a.example", "user-a", "operation-1"); err != nil {
		t.Fatal(err)
	}
	items, err = records.list("https://core-a.example", "user-a")
	if err != nil || len(items) != 1 || !items[0].Terminal {
		t.Fatal("terminal Operation was not restored", items, err)
	}
	if err := records.hide("https://core-a.example", "user-a", "operation-1"); err != nil {
		t.Fatal(err)
	}
	items, err = other.list("https://core-a.example", "user-a")
	if err != nil || len(items) != 0 {
		t.Fatal("hidden Operation remained visible", items, err)
	}
	entries, err := os.ReadDir(filepath.Join(root, "desktop-operations-go"))
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		assertPrivateFixtureFile(t, filepath.Join(root, "desktop-operations-go", entry.Name()))
	}
}
