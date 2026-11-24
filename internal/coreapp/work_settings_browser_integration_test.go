//go:build integration

package coreapp

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"piwork/internal/webapp"
)

func TestNativeWorkSettingsBrowserEditorRoundTrip(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Fatal("Node is required for the Work Settings browser driver", err)
	}
	a, base, auth, workID, ctx := nativeApplyFixture(t)
	const name = "editor-browser-skill"
	manifest := "---\nname: " + name + "\ndescription: Verify independent Work Skill files\n---\nSupporting file: references/note.txt\n"
	source := filepath.Join(t.TempDir(), name)
	if err := os.MkdirAll(filepath.Join(source, "references"), 0755); err != nil {
		t.Fatal(err)
	}
	operatorBytes, err := os.ReadFile(filepath.Join(a.options.DataDirectory, "operator.credential"))
	if err != nil {
		t.Fatal(err)
	}
	operator := "Operator " + strings.TrimSpace(string(operatorBytes))
	publish := func(method, text, support string) {
		t.Helper()
		for path, value := range map[string]string{"SKILL.md": text, "references/note.txt": support} {
			if err := os.WriteFile(filepath.Join(source, path), []byte(value), 0600); err != nil {
				t.Fatal(err)
			}
		}
		path := "/control/skills"
		if method == "PUT" {
			path += "/" + name
		}
		status, body := packageHTTPCall(t, base, path, method, operator, map[string]string{"path": source})
		if status != 200 && status != 201 {
			t.Fatal("publish synthetic Skill", status, body)
		}
	}
	create := func(key string) string {
		t.Helper()
		status, receipt := packageHTTPCall(t, base, "/api/v1/works", "POST", auth, map[string]any{
			"name": key, "skills": []string{name}, "packages": []any{}, "idempotencyKey": key,
		})
		if status != 202 {
			t.Fatal("create independent comparison Work", status, receipt)
		}
		waitWorkOperation(t, ctx, a, receipt["operationId"].(string))
		return receipt["workId"].(string)
	}
	publish("POST", manifest+"Core copy one\n", "CORE_ONE\n")
	otherID := create("Editor comparison Work")
	currentManifest, currentSupport := manifest+"Core copy two\n", "CORE_TWO\n"
	publish("PUT", currentManifest, currentSupport)

	server := httptest.NewUnstartedServer(nil)
	origin := "http://" + server.Listener.Addr().String()
	web, err := webapp.New(ctx, webapp.Options{Origin: origin, CoreURL: base, SetupSecret: "editor-browser-fixture", DataDirectory: t.TempDir()})
	if err != nil {
		server.Close()
		t.Fatal(err)
	}
	server.Config.Handler = web
	server.Start()
	defer server.Close()
	defer web.Close()
	_, file, _, _ := runtime.Caller(0)
	script := filepath.Join(filepath.Dir(file), "..", "..", "apps", "desktop-webui", "test", "work-settings-real-core.mjs")
	input, err := json.Marshal(map[string]string{
		"origin": origin, "coreURL": base, "authorization": auth, "workID": workID, "skillName": name,
		"originalManifest": currentManifest, "originalSupport": currentSupport,
		"editedManifest": manifest + "Work-only editor instructions\n", "editedSupport": "EDITOR_ONLY\n",
		"output": t.TempDir(),
	})
	if err != nil {
		t.Fatal(err)
	}
	driver := exec.CommandContext(ctx, node, script)
	driver.Stdin = bytes.NewReader(input)
	output, err := driver.CombinedOutput()
	if err != nil {
		t.Fatalf("real Work Settings browser: %v\n%s", err, output)
	}
	t.Log(strings.TrimSpace(string(output)))

	// A different Work keeps its first copy; a newly created Work still gets
	// Core's second copy, rather than bytes edited through the browser.
	for id, expected := range map[string][2]string{
		otherID:                          {manifest + "Core copy one\n", "CORE_ONE\n"},
		create("Editor fresh Core copy"): {currentManifest, currentSupport},
	} {
		status, body := packageHTTPCall(t, base, "/api/v1/works/"+id+"/configuration/editor/read", "POST", auth, map[string]any{
			"files": []map[string]string{{"skillName": name, "path": "SKILL.md"}, {"skillName": name, "path": "references/note.txt"}},
		})
		if status != 200 {
			t.Fatal("read comparison Skill", status, body)
		}
		files := body["files"].([]any)
		if len(files) != 2 || files[0].(map[string]any)["text"] != expected[0] || files[1].(map[string]any)["text"] != expected[1] {
			t.Fatal("browser editor changed another Work or Core copy")
		}
	}
	t.Log("browser edits, SDK file reads, stopped/restarted persistence, Work archive round trip, and independent Core/Work copies verified")
}
