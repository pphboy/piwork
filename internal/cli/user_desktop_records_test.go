package cli

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
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

func TestDesktopOperationTerminalHintsRequireMatchingOriginal(t *testing.T) {
	records := desktopOperationRecords{credentialPath: filepath.Join(t.TempDir(), "credential.json")}
	if err := records.accept("http://core.test", "owner", "Work action", json.RawMessage(`{"operationId":"op-retry","workId":"work-one"}`)); err != nil {
		t.Fatal(err)
	}
	for _, raw := range []string{
		`{"operationId":"other","workId":"work-one","kind":"retry-work","state":"failed"}`,
		`{"operationId":"op-retry","workId":"other","kind":"retry-work","state":"failed"}`,
		`{"operationId":"op-retry","workId":"work-one","kind":"export-work","state":"failed"}`,
		`{"operationId":"op-retry","workId":"work-one","kind":"retry-work","state":"running"}`,
	} {
		if err := records.observeTerminal("http://core.test", "owner", "op-retry", json.RawMessage(raw)); err != nil {
			t.Fatal(err)
		}
		items, err := records.list("http://core.test", "owner")
		if err != nil || len(items) != 1 || items[0].Terminal {
			t.Fatal("foreign or nonterminal result recorded", items, err)
		}
	}
	if err := records.observeTerminal("http://core.test", "owner", "op-retry", json.RawMessage(`{"operationId":"op-retry","workId":"work-one","kind":"retry-work","state":"failed"}`)); err != nil {
		t.Fatal(err)
	}
	items, err := records.list("http://core.test", "owner")
	if err != nil || len(items) != 1 || items[0].TerminalState != "failed" || items[0].TerminalCheckedAt == "" || items[0].Type != "retry-work" {
		t.Fatal("verified failure lost", items, err)
	}
	// A legacy reader ignores the optional fields, and a legacy terminal record
	// with no outcome remains distinct from a verified success.
	data, _ := json.Marshal(items[0])
	var legacy struct {
		OperationID string
		Terminal    bool
	}
	if json.Unmarshal(data, &legacy) != nil || !legacy.Terminal {
		t.Fatal("legacy format incompatible")
	}
	if err := records.hide("http://core.test", "owner", "op-retry"); err != nil {
		t.Fatal(err)
	}
	if err := records.observeTerminal("http://core.test", "owner", "op-retry", json.RawMessage(`{"operationId":"op-retry","workId":"work-one","kind":"retry-work","state":"failed"}`)); err != nil {
		t.Fatal(err)
	}
	items, _ = records.list("http://core.test", "owner")
	if len(items) != 0 {
		t.Fatal("observation unhid history")
	}
}

func TestDesktopOperationHintsKeepBoundedHistoryAndAllPending(t *testing.T) {
	records := desktopOperationRecords{credentialPath: filepath.Join(t.TempDir(), "credential.json")}
	err := records.withState("http://core.test", "owner", true, func(items *[]desktopKnownOperation) error {
		for i := 0; i < 505; i++ {
			*items = append(*items, desktopKnownOperation{OperationID: fmt.Sprintf("op-%03d", i), Type: "Retry Work", WorkID: "work-one", RecordedAt: fmt.Sprintf("2026-10-28T10:%03d", i), Terminal: true})
		}
		*items = append(*items, desktopKnownOperation{OperationID: "op-pending", Type: "Stop Work", WorkID: "work-one", RecordedAt: "2026-10-28T00:00:00Z"})
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	items, err := records.list("http://core.test", "owner")
	if err != nil || len(items) != 501 {
		t.Fatal("history bound or pending lost", len(items), err)
	}
	found := false
	for _, item := range items {
		if item.OperationID == "op-pending" {
			found = true
		}
		if item.TerminalState != "" {
			t.Fatal("guessed legacy outcome")
		}
	}
	if !found {
		t.Fatal("pending removed by history bound")
	}
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := records.list("http://core.test", "owner")
			if err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
}

func TestDesktopOperationConcurrentTerminalWrites(t *testing.T) {
	records := desktopOperationRecords{credentialPath: filepath.Join(t.TempDir(), "credential.json")}
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			id := fmt.Sprintf("op-concurrent-%d", index)
			accepted := json.RawMessage(fmt.Sprintf(`{"operationId":%q,"workId":"work-one"}`, id))
			if err := records.accept("http://core.test", "owner", "Work action", accepted); err != nil {
				t.Error(err)
				return
			}
			result := json.RawMessage(fmt.Sprintf(`{"operationId":%q,"workId":"work-one","kind":"retry-work","state":"failed"}`, id))
			if err := records.observeTerminal("http://core.test", "owner", id, result); err != nil {
				t.Error(err)
			}
			if _, err := records.list("http://core.test", "owner"); err != nil {
				t.Error(err)
			}
		}(i)
	}
	wg.Wait()
	items, err := records.list("http://core.test", "owner")
	if err != nil || len(items) != 8 {
		t.Fatal("concurrent records lost", len(items), err)
	}
	for _, item := range items {
		if item.TerminalState != "failed" {
			t.Fatal("concurrent result lost", item)
		}
	}
}
