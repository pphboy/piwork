//go:build integration

package coreapp

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestNativeSkillsUseIndependentCopiesAndExplicitReselection(t *testing.T) {
	a, base, auth, workA, ctx := nativeApplyFixture(t)
	operatorBytes, err := os.ReadFile(filepath.Join(a.options.DataDirectory, "operator.credential"))
	if err != nil {
		t.Fatal(err)
	}
	operator := "Operator " + strings.TrimSpace(string(operatorBytes))
	root := filepath.Join(t.TempDir(), "owned-skill")
	manifest := "---\nname: owned-skill\ndescription: Independent Work instructions.\n---\nSupporting file: support.txt\n"
	publish := func(contents, method string) {
		t.Helper()
		if err := os.MkdirAll(root, 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(root, "SKILL.md"), []byte(manifest), 0600); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(root, "support.txt"), []byte(contents), 0600); err != nil {
			t.Fatal(err)
		}
		endpoint := "/control/skills"
		if method == "PUT" {
			endpoint += "/owned-skill"
		}
		status, body := packageHTTPCall(t, base, endpoint, method, operator, map[string]string{"path": root})
		if status != 200 && status != 201 {
			t.Fatal(status, body)
		}
	}
	mutate := func(work, action, key string) {
		t.Helper()
		status, result := packageHTTPCall(t, base, "/api/v1/works/"+work+"/"+action, "POST", auth, map[string]string{"idempotencyKey": key})
		if status != 202 {
			t.Fatal(status, result)
		}
		waitWorkOperation(t, ctx, a, result["operationId"].(string))
	}
	selectSkills := func(work string, skills []string) {
		t.Helper()
		status, result := packageHTTPCall(t, base, "/api/v1/works/"+work+"/configuration/skills", "PUT", auth, map[string]any{"skills": skills})
		if status != 200 {
			t.Fatal(status, result)
		}
	}
	read := func(work, key, expected string) {
		t.Helper()
		path := "/api/v1/works/" + work
		status, session := packageHTTPCall(t, base, path+"/sessions", "POST", auth, map[string]string{"idempotencyKey": key})
		if status != 201 {
			t.Fatal(status, session)
		}
		status, submitted := packageHTTPCall(t, base, path+"/runs", "POST", auth, map[string]any{"sessionId": session["sessionId"], "submissionKey": key, "prompt": "Read the configured Skill and supporting file"})
		if status != 202 {
			t.Fatal(status, submitted)
		}
		runID := submitted["run"].(map[string]any)["runId"].(string)
		for deadline := time.Now().Add(30 * time.Second); ; {
			status, result := packageHTTPCall(t, base, path+"/runs/"+runID, "GET", auth, nil)
			if status != 200 {
				t.Fatal(status, result)
			}
			if result["state"] == float64(4) {
				want := "skill-read:none"
				if expected != "" {
					hash := sha256.Sum256([]byte(manifest + "\x00" + expected))
					want = "skill-read:" + hex.EncodeToString(hash[:])[:16]
				}
				if result["finalText"] != want {
					t.Fatal("SDK read another copy", result, want)
				}
				status, history := packageHTTPCall(t, base, path+"/sessions/"+session["sessionId"].(string), "GET", auth, nil)
				raw, _ := json.Marshal(history)
				if status != 200 || expected != "" && !strings.Contains(string(raw), expected) {
					t.Fatal("tool read not durable", status, string(raw))
				}
				return
			}
			if result["state"] == float64(5) || time.Now().After(deadline) {
				t.Fatal(result)
			}
			time.Sleep(50 * time.Millisecond)
		}
	}
	publish("COPY_A", "POST")
	selectSkills(workA, []string{"owned-skill"})
	mutate(workA, "configuration/apply", "apply-A")
	publish("COPY_B", "PUT")
	status, created := packageHTTPCall(t, base, "/api/v1/works", "POST", auth, map[string]any{"name": "独立 Skill B", "skills": []string{"owned-skill"}, "idempotencyKey": "create-B"})
	if status != 202 {
		t.Fatal(status, created)
	}
	workB := created["workId"].(string)
	waitWorkOperation(t, ctx, a, created["operationId"].(string))
	publish("CORE_CURRENT", "PUT")
	if err := os.RemoveAll(root); err != nil {
		t.Fatal(err)
	}
	read(workA, "read-A", "COPY_A")
	read(workB, "read-B", "COPY_B")
	mutate(workA, "stop", "stop-A")
	mutate(workA, "start", "start-A")
	read(workA, "read-A-restarted", "COPY_A")
	// Explicit reselection captures Core current bytes. A later selection must
	// remain desired until its own Apply, even while the first Apply succeeds.
	selectSkills(workA, []string{"owned-skill"})
	value, _ := a.workLocks.LoadOrStore(workA, &sync.Mutex{})
	lock := value.(*sync.Mutex)
	lock.Lock()
	status, apply := packageHTTPCall(t, base, "/api/v1/works/"+workA+"/configuration/apply", "POST", auth, map[string]string{"idempotencyKey": "reselect-current"})
	if status != 202 {
		lock.Unlock()
		t.Fatal(status, apply)
	}
	selectSkills(workA, []string{})
	lock.Unlock()
	waitWorkOperation(t, ctx, a, apply["operationId"].(string))
	status, configuration := packageHTTPCall(t, base, "/api/v1/works/"+workA+"/configuration", "GET", auth, nil)
	if status != 200 || configuration["pendingApply"] != true || len(configuration["active"].(map[string]any)["skills"].([]any)) != 1 || len(configuration["desired"].(map[string]any)["skills"].([]any)) != 0 {
		t.Fatal(configuration)
	}
	read(workA, "read-reselected", "CORE_CURRENT")
	read(workB, "read-B-still-owned", "COPY_B")
	mutate(workA, "configuration/apply", "apply-empty")
	read(workA, "read-removed", "")
	t.Log("same-name Work A/B/Core copies distinguished by actual SDK read results; restart isolation, explicit reselect, later pending selection and removal verified")
}
