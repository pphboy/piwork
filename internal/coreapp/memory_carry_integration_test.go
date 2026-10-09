//go:build integration

package coreapp

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"piwork/internal/contracts"
	"piwork/internal/workpackage"
)

// Re-encode only a synthetic Memory blob and its private tree. All hashes and
// framing remain valid, so rejection must come from relational validation.
func memoryCarryPackage(t *testing.T, ctx context.Context, source *os.File, verified workpackage.Verified, query string) *os.File {
	t.Helper()
	spec := verified.Spec
	spec.Blobs = append([]contracts.WorkBlob(nil), spec.Blobs...)
	spec.Volumes = append([]json.RawMessage(nil), spec.Volumes...)
	volumes := workpackage.Volumes(spec)
	index := -1
	for i, volume := range volumes {
		if volume.Role == "agent-private" {
			index = i
		}
	}
	if index < 0 {
		t.Fatal("missing private tree")
	}
	oldTree := string(volumes[index].Tree)
	var tree workpackage.Tree
	if err := json.Unmarshal(verified.Metadata[oldTree], &tree); err != nil {
		t.Fatal(err)
	}
	entryIndex := -1
	for i, entry := range tree.Entries {
		path, err := workpackage.DecodePath(entry.SegmentsBase64, workpackage.DefaultLimits)
		if err != nil {
			t.Fatal(err)
		}
		if string(path) == "memory.sqlite" {
			entryIndex = i
		}
	}
	if entryIndex < 0 {
		t.Fatal("missing Memory")
	}
	oldMemory := string(tree.Entries[entryIndex].Blob)
	var memoryBlob contracts.WorkBlob
	for _, blob := range spec.Blobs {
		if string(blob.Digest) == oldMemory {
			memoryBlob = blob
		}
	}
	r, err := verified.Open(source)(memoryBlob)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := io.ReadAll(r)
	r.Close()
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "memory.sqlite")
	if err := os.WriteFile(path, raw, 0600); err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(query); err != nil {
		db.Close()
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	raw, err = os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256(raw)
	memoryDigest := hex.EncodeToString(hash[:])
	tree.Entries[entryIndex].Blob = contracts.WorkBlobDigest(memoryDigest)
	tree.Entries[entryIndex].Size = int64(len(raw))
	treeRaw, err := contracts.EncodeCanonicalJSON(tree)
	if err != nil {
		t.Fatal(err)
	}
	hash = sha256.Sum256(treeRaw)
	treeDigest := hex.EncodeToString(hash[:])
	volumes[index].Tree = contracts.WorkBlobDigest(treeDigest)
	spec.Volumes[index] = snapshotRaw(volumes[index])
	for i, blob := range spec.Blobs {
		switch string(blob.Digest) {
		case oldMemory:
			spec.Blobs[i].Digest = contracts.WorkBlobDigest(memoryDigest)
			spec.Blobs[i].Size = contracts.WorkByteSize(len(raw))
		case oldTree:
			spec.Blobs[i].Digest = contracts.WorkBlobDigest(treeDigest)
			spec.Blobs[i].Size = contracts.WorkByteSize(len(treeRaw))
		}
	}
	sort.Slice(spec.Blobs, func(i, j int) bool { return spec.Blobs[i].Digest < spec.Blobs[j].Digest })
	result, err := os.CreateTemp(t.TempDir(), "memory-carry-*.work")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { result.Close() })
	err = workpackage.Encode(ctx, spec, func(blob contracts.WorkBlob) (io.ReadCloser, error) {
		switch string(blob.Digest) {
		case memoryDigest:
			return io.NopCloser(bytes.NewReader(raw)), nil
		case treeDigest:
			return io.NopCloser(bytes.NewReader(treeRaw)), nil
		default:
			return verified.Open(source)(blob)
		}
	}, result)
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func TestNativeMemoryCarryValidationBeforeImportPublication(t *testing.T) {
	a, base, auth, work, _ := nativeApplyFixtureConfig(t, true)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()
	f := brainAcceptance{t: t, a: a, base: base, auth: auth, work: work, path: "/api/v1/works/" + work, ctx: ctx}
	f.chat("remember deterministic preference Use dark theme", "carry-preference")
	// Normal store APIs seed synthetic verified Query records. Real SDK reads,
	// runtime initialization and Core/helper export/import are exercised below.
	program := `import {WorkStore} from '/workspace/packages/work-store/dist/index.js';
const work=` + stringMustJSON(work) + `,sid=` + stringMustJSON(f.session) + `,s=WorkStore.open('/var/data/work.sqlite',{workId:work});
const contextIdentity=s.getSession(work,sid).contextIdentity;
for(const [key,entryId,rule,operation] of [['first','lesson','Original verified lesson','upsert'],['second','other','Second lesson','upsert'],['revise','other','Revised lesson','upsert'],['invalidate','other','Revised lesson','invalidate']]){
 const now=new Date().toISOString(),r=s.acceptRun({workId:work,sessionId:sid,submissionKey:'carry-'+key,requestDigest:key,promptDigest:key,contextIdentity,memoryQuery:'lesson',now}).run;
 s.markRunRunning(r.runId,now);const q=s.feedback.ensureChatRequest(work,r.runId,key,now);
 const e=s.feedback.addEvidence(work,{requestId:q.requestId,runId:r.runId,kind:'query',objectRef:'summary',observedAt:now,summary:'Synthetic verified state',verified:true},{checks:[{name:'state',passed:true}]});
 s.memory.propose(work,q.requestId,{entryId,scope:'work',rule,evidenceIds:[e.evidenceId],operation,expectedVersion:s.memory.head(work),reason:operation==='invalidate'?'Outdated':undefined},false,now);
 s.feedback.finish(work,q.requestId,'completed','verified',null,[e.evidenceId],now);s.completeRun(r.runId,'succeeded','done',null,now);
}console.log(JSON.stringify(s.memory.snapshot(work)));s.close();`
	before := strings.TrimSpace(f.agentEval(program))
	if !strings.Contains(before, "Original verified lesson") || strings.Contains(before, "Revised lesson") {
		t.Fatal(before)
	}
	read := f.chat(`invoke package tool brain_experience with {"operation":"recall","query":"lesson"}`, "carry-read")
	if !strings.Contains(read["finalText"].(string), "Original verified lesson") {
		t.Fatal(read)
	}
	f.control("stop", "carry-stop")
	status, exported := packageHTTPCall(t, base, f.path+"/exports", "POST", auth, map[string]string{"idempotencyKey": "carry-export"})
	if status != 202 {
		t.Fatal(status, exported)
	}
	waitWorkOperation(t, ctx, a, exported["operationId"].(string))
	req, _ := http.NewRequestWithContext(ctx, "GET", base+"/api/v1/work-snapshots/"+exported["snapshotId"].(string)+"/content", nil)
	req.Header.Set("Authorization", auth)
	response, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	source, err := os.CreateTemp(t.TempDir(), "carry-source-*.work")
	if err != nil {
		t.Fatal(err)
	}
	defer source.Close()
	if response.StatusCode != 200 {
		response.Body.Close()
		t.Fatal(response.StatusCode)
	}
	if _, err = io.Copy(source, response.Body); err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if _, err = source.Seek(0, 0); err != nil {
		t.Fatal(err)
	}
	verified, err := workpackage.Read(ctx, source, workpackage.ReadOptions{})
	if err != nil {
		t.Fatal(err)
	}
	variants := []struct {
		name, query string
		valid       bool
	}{
		{"valid", "SELECT 1", true},
		{"legacy", `DELETE FROM memory_candidates WHERE entry_id='lesson'; UPDATE memory_versions SET legacy=1 WHERE version=(SELECT MIN(version) FROM memory_entries WHERE entry_id='lesson')`, true},
		{"kind", `UPDATE memory_entries SET kind='knowledge' WHERE version=(SELECT version FROM memory_head) AND entry_id='lesson'`, false},
		{"created", `UPDATE memory_entries SET created_at='2026-10-07T00:00:00Z' WHERE version=(SELECT version FROM memory_head) AND entry_id='lesson'`, false},
		{"rule", `UPDATE memory_entries SET rule='Changed without candidate' WHERE version=(SELECT version FROM memory_head) AND entry_id='lesson'`, false},
	}
	for _, variant := range variants {
		t.Run(variant.name, func(t *testing.T) {
			pack := memoryCarryPackage(t, ctx, source, verified, variant.query)
			info, err := pack.Stat()
			if err != nil {
				t.Fatal(err)
			}
			hash := sha256.New()
			if _, err := pack.Seek(0, 0); err != nil {
				t.Fatal(err)
			}
			if _, err := io.Copy(hash, pack); err != nil {
				t.Fatal(err)
			}
			digest := hex.EncodeToString(hash.Sum(nil))
			pack.Seek(0, 0)
			req, err := http.NewRequestWithContext(ctx, "POST", base+"/api/v1/work-packages", io.NopCloser(pack))
			if err != nil {
				t.Fatal(err)
			}
			req.ContentLength = info.Size()
			req.Header.Set("Authorization", auth)
			req.Header.Set("Content-Type", snapshotMIME)
			req.Header.Set("X-Piwork-SHA256", digest)
			var countBefore int
			if err := a.Store.Read(ctx, func(tx *sql.Tx) error { return tx.QueryRow("SELECT COUNT(*) FROM works").Scan(&countBefore) }); err != nil {
				t.Fatal(err)
			}
			res, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			var uploaded map[string]any
			err = json.NewDecoder(res.Body).Decode(&uploaded)
			res.Body.Close()
			if err != nil {
				t.Fatal(err)
			}
			if !variant.valid {
				if res.StatusCode != http.StatusConflict || uploaded["code"] != "SNAPSHOT_HISTORY_INVALID" {
					t.Fatal("unexpected invalid-history response", res.StatusCode, uploaded)
				}
				var countAfter int
				if err := a.Store.Read(ctx, func(tx *sql.Tx) error { return tx.QueryRow("SELECT COUNT(*) FROM works").Scan(&countAfter) }); err != nil {
					t.Fatal(err)
				}
				if countBefore != countAfter {
					t.Fatal("invalid input published a Work")
				}
				if _, err := pack.Seek(0, 0); err != nil {
					t.Fatal(err)
				}
				after := sha256.New()
				if _, err := io.Copy(after, pack); err != nil {
					t.Fatal(err)
				}
				if hex.EncodeToString(after.Sum(nil)) != digest {
					t.Fatal("upload changed input")
				}
				t.Log("real Core/helper rejected", variant.name, uploaded["code"], "no Work published; input unchanged")
				return
			}
			if res.StatusCode != 201 {
				t.Fatal(res.StatusCode, uploaded)
			}
			status, accepted := packageHTTPCall(t, base, "/api/v1/work-imports", "POST", auth, map[string]string{"packageId": uploaded["packageId"].(string), "name": "Memory carry " + variant.name, "idempotencyKey": "carry-import-" + variant.name})
			if status != 202 {
				t.Fatal(status, accepted)
			}
			waitWorkOperation(t, ctx, a, accepted["operationId"].(string))
			targetWork := accepted["workId"].(string)
			target := brainAcceptance{t: t, a: a, base: base, auth: auth, work: targetWork, path: "/api/v1/works/" + targetWork, ctx: ctx}
			if target.read(target.path)["desiredState"] != "stopped" {
				t.Fatal("import started itself")
			}
			target.control("start", "carry-start-"+variant.name)
			actual := strings.TrimSpace(target.agentEval(`import {WorkStore} from '/workspace/packages/work-store/dist/index.js';const s=WorkStore.open('/var/data/work.sqlite',{workId:` + stringMustJSON(targetWork) + `});console.log(JSON.stringify(s.memory.snapshot(` + stringMustJSON(targetWork) + `)));s.close();`))
			if actual != before {
				t.Fatal("Rebuild changed Memory", before, actual)
			}
			for _, request := range target.requests() {
				if request.(map[string]any)["disposition"] != "historical" {
					t.Fatal("old goal revived", request)
				}
			}
			got := target.chat(`invoke package tool brain_experience with {"operation":"recall","query":"lesson"}`, "carry-import-read-"+variant.name)
			if !strings.Contains(got["finalText"].(string), "Original verified lesson") {
				t.Fatal(got)
			}
			target.control("stop", "carry-import-stop-"+variant.name)
			t.Log("real import and SDK read", variant.name, targetWork, "version/content/Evidence preserved")
		})
	}
}
