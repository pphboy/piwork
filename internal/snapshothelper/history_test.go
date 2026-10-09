package snapshothelper

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"piwork/internal/workhistory"
	"piwork/internal/workpackage"
)

func TestSnapshotHelperSharedMemoryIntegrityCases(t *testing.T) {
	raw, err := os.ReadFile("../workhistory/testdata/memory-integrity-cases.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Name     string `json:"name"`
		Accepted bool   `json:"accepted"`
		SQL      string `json:"sql"`
		Setup    string `json:"setup"`
	}
	if json.Unmarshal(raw, &cases) != nil {
		t.Fatal("invalid cases")
	}
	mainSchema, err := os.ReadFile("../workhistory/schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	memorySchema, err := os.ReadFile("../workhistory/memory-schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	seed, err := os.ReadFile("../workhistory/testdata/memory-integrity.sql")
	if err != nil {
		t.Fatal(err)
	}
	carry, err := os.ReadFile("../workhistory/testdata/memory-integrity-carry.sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, scenario := range cases {
		t.Run(scenario.Name, func(t *testing.T) {
			spool := t.TempDir()
			volume := filepath.Join(t.TempDir(), "private")
			if os.MkdirAll(filepath.Join(volume, "sessions"), 0700) != nil {
				t.Fatal("mkdir")
			}
			if os.WriteFile(filepath.Join(volume, "sessions", "one.jsonl"), []byte("{\"type\":\"session\"}\n"), 0600) != nil {
				t.Fatal("SDK fixture")
			}
			db, err := sql.Open("sqlite", filepath.Join(volume, "work.sqlite"))
			if err != nil {
				t.Fatal(err)
			}
			db.SetMaxOpenConns(1)
			setup := ""
			if scenario.Setup == "carry" {
				setup = string(carry)
			}
			for _, query := range []string{string(mainSchema), "ATTACH DATABASE '" + filepath.Join(volume, "memory.sqlite") + "' AS memory", strings.ReplaceAll(strings.ReplaceAll(string(memorySchema), "CREATE TABLE ", "CREATE TABLE memory."), "CREATE INDEX ", "CREATE INDEX memory."), string(seed), setup, scenario.SQL} {
				if _, err := db.Exec(query); err != nil {
					db.Close()
					t.Fatal(err)
				}
			}
			db.Close()
			fingerprint := func() [][]byte {
				result := [][]byte{}
				for _, name := range []string{"work.sqlite", "memory.sqlite"} {
					raw, err := os.ReadFile(filepath.Join(volume, name))
					if err != nil {
						t.Fatal(err)
					}
					result = append(result, raw)
				}
				return result
			}
			before := fingerprint()
			request, _ := json.Marshal(map[string]any{"sourceWorkId": "work-memory-source-1111", "contextIds": []string{"context-memory-source"}})
			if os.WriteFile(filepath.Join(spool, "history-request.json"), request, 0600) != nil {
				t.Fatal("request")
			}
			_, err = verifyVolumeHistory(context.Background(), volume, spool, false)
			if (err == nil) != scenario.Accepted {
				t.Fatal("helper differs from shared TS/Go fixture", err)
			}
			if !reflect.DeepEqual(before, fingerprint()) {
				t.Fatal("helper modified source")
			}
		})
	}
}

func TestUploadVerifierChecksNativePackageAndDoesNotExposePrivateContent(t *testing.T) {
	raw, err := os.ReadFile("../workpackage/testdata/golden-native-pi-package.work")
	if err != nil {
		t.Fatal(err)
	}
	spool := t.TempDir()
	if err := os.WriteFile(filepath.Join(spool, "package.work"), raw, 0600); err != nil {
		t.Fatal(err)
	}
	result, err := verifyUploadedPackage(context.Background(), spool)
	if err != nil {
		t.Fatal(historyCode(err), err)
	}
	encoded, _ := json.Marshal(result)
	for _, private := range []string{"PRIVATE_CONTENT_SENTINEL", "AGENTS_PRIVATE_SENTINEL", "HISTORY_PRIVATE_SENTINEL", "sourceWorkId", "package.json"} {
		if bytes.Contains(encoded, []byte(private)) {
			t.Fatal("private content escaped", string(encoded))
		}
	}
	if !bytes.Contains(encoded, []byte(`"bindingRequirements"`)) || !bytes.Contains(encoded, []byte(`"digest"`)) {
		t.Fatal("verification result missing", string(encoded))
	}
	entries, _ := os.ReadDir(spool)
	for _, entry := range entries {
		if entry.Name() != "package.work" {
			t.Fatal("verification scratch leaked", entry.Name())
		}
	}
	// Framing/integrity remains valid; active history without a DB is rejected
	// by isolated semantic verification, rather than offline SQLite execution.
	verified, err := workpackage.Read(context.Background(), bytes.NewReader(raw), workpackage.ReadOptions{})
	if err != nil {
		t.Fatal(err)
	}
	unchanged, err := os.ReadFile(filepath.Join(spool, "package.work"))
	if err != nil || !bytes.Equal(raw, unchanged) {
		t.Fatal("verification changed the archive", err)
	}
	// Direct section reads still require integrity of every blob, including
	// bytes unrelated to the SQLite history being checked.
	corrupted := bytes.Clone(raw)
	for _, blob := range verified.Spec.Blobs {
		if blob.Size > 0 {
			corrupted[verified.Offsets[string(blob.Digest)]] ^= 1
			break
		}
	}
	if err := os.WriteFile(filepath.Join(spool, "package.work"), corrupted, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := verifyUploadedPackage(context.Background(), spool); historyCode(err) != "PACKAGE_INVALID" {
		t.Fatal("corrupt blob was accepted", historyCode(err), err)
	}
	verified.Spec.ActiveContext = json.RawMessage(`"` + string(verified.Spec.DesiredContext) + `"`)
	var active bytes.Buffer
	if err := workpackage.Encode(context.Background(), verified.Spec, verified.Open(bytes.NewReader(raw)), &active); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(spool, "package.work"), active.Bytes(), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := verifyUploadedPackage(context.Background(), spool); historyCode(err) != "SNAPSHOT_HISTORY_INVALID" {
		t.Fatal("active without DB", historyCode(err), err)
	}
}
func TestHistoryRequestStrictnessAndHelperUsageBeforeFilesystemAccess(t *testing.T) {
	spool := t.TempDir()
	for _, raw := range []string{`{"sourceWorkId":"source-work-00000000001","contextIds":[],"unknown":1}`, `{"sourceWorkId":"source-work-00000000001","contextIds":["context-source-0000001","context-source-0000001"]}`, `{"sourceWorkId":"source-work-00000000001","sourceWorkId":"source-work-00000000002","contextIds":[]}`, `{"sourceWorkId":"source-work-00000000001","contextIds":[],"contexts":[{"sourceId":"context-source-000001","targetId":"context-target-000001","extra":1}]}`} {
		if err := os.WriteFile(filepath.Join(spool, "history-request.json"), []byte(raw), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := readRequest(spool); err == nil {
			t.Fatal("unsafe history request accepted", raw)
		}
	}
	for _, args := range [][]string{nil, {"restore", "../../outside"}, {"restore-context", strings.Repeat("a", 64), "../outside"}, {"restore-package", strings.Repeat("a", 64), "c-safe", "../outside"}, {"verify-history", "extra"}} {
		var stdout, stderr bytes.Buffer
		if code := Entry(context.Background(), args, &stdout, &stderr); code != 2 || stdout.Len() != 0 || !bytes.Contains(stderr.Bytes(), []byte("SNAPSHOT_HELPER_ARGUMENT")) {
			t.Fatal(args, code, stdout.String(), stderr.String())
		}
	}
	if code := Entry(context.Background(), []string{"--version"}, io.Discard, io.Discard); code != 0 {
		t.Fatal(code)
	}
}
func TestVolumeHistoryNativeCodeReadsCurrentHistoryAndMapsNewIdentity(t *testing.T) {
	root := t.TempDir()
	volume := filepath.Join(root, "private")
	if err := os.CopyFS(volume, os.DirFS("../workhistory/testdata/valid")); err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		SourceWorkID string
		ContextIDs   []string
	}
	raw, err := os.ReadFile("../workhistory/testdata/cases.json")
	if err != nil || json.Unmarshal(raw, &cases) != nil {
		t.Fatal(err)
	}
	source := cases[0]
	request := map[string]any{"sourceWorkId": source.SourceWorkID, "contextIds": source.ContextIDs}
	write := func() {
		t.Helper()
		raw, _ := json.Marshal(request)
		if err := os.WriteFile(filepath.Join(root, "history-request.json"), raw, 0600); err != nil {
			t.Fatal(err)
		}
	}
	write()
	result, err := verifyVolumeHistory(context.Background(), volume, root, false)
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(result)
	if !bytes.Contains(encoded, []byte(`"historyPresent":true`)) || !bytes.Contains(encoded, []byte(`"runs":1`)) {
		t.Fatal(string(encoded))
	}
	request["targetWorkId"] = "work-target-000000000001"
	request["contexts"] = []map[string]string{{"sourceId": source.ContextIDs[0], "targetId": "context-target-000000000001"}}
	write()
	if _, err := verifyVolumeHistory(context.Background(), volume, root, true); err != nil {
		t.Fatal(err)
	}
	verified, err := workhistory.Open(context.Background(), volume, workhistory.Scope{SourceWorkID: "work-target-000000000001", ContextIDs: map[string]bool{"context-target-000000000001": true}, ScratchDirectory: root})
	if err != nil || verified == nil {
		t.Fatal(err)
	}
	verified.Close()
	if code := historyCode(workhistory.ErrUnsupported); code != "SNAPSHOT_HISTORY_UNSUPPORTED" {
		t.Fatal(code)
	}
}

func TestRestoreBindingsAreStrictSafeDescriptionsAndDeclaredOperations(t *testing.T) {
	spool := t.TempDir()
	for _, raw := range []string{
		`{"sourceWorkId":"source-work-00000000001","contextIds":[],"models":[{"modelRef":"model-target-000000001","label":"Target","provider":"fixture","model":"one","credential":"private"}]}`,
		`{"sourceWorkId":"source-work-00000000001","contextIds":[],"models":[{"modelRef":"model-target-000000001","label":"Target","provider":"fixture","model":"one","baseUrl":"https://user:secret@example.test"}]}`,
		`{"sourceWorkId":"source-work-00000000001","contextIds":[],"models":{}}`,
		`{"sourceWorkId":"source-work-00000000001","contextIds":[],"operations":{"operation-source-00001":"../../host"}}`,
		`{"sourceWorkId":"source-work-00000000001","contextIds":[],"operations":{"operation-source-00001":"operation-target-00001","operation-source-00002":"operation-target-00001"}}`,
	} {
		if err := os.WriteFile(filepath.Join(spool, "history-request.json"), []byte(raw), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := readRequest(spool); err == nil {
			t.Fatal("unsafe target bindings accepted", raw)
		}
	}
	raw := `{"sourceWorkId":"source-work-00000000001","contextIds":[],"models":[{"modelRef":"model-target-000000001","label":"Target","provider":"fixture","model":"one","baseUrl":"https://MODELS.example:443/a/../"}],"operations":{"operation-source-00001":"operation-target-00001"}}`
	if err := os.WriteFile(filepath.Join(spool, "history-request.json"), []byte(raw), 0600); err != nil {
		t.Fatal(err)
	}
	request, err := readRequest(spool)
	if err != nil || len(request.Models) != 1 || len(request.Operations) != 1 {
		t.Fatal(request, err)
	}
}
