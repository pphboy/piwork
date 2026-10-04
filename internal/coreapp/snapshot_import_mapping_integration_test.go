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
	"net/url"
	"os"
	"path/filepath"
	"piwork/internal/internaltls"
	"runtime"
	"strings"
	"testing"
	"time"

	"piwork/internal/contracts"
	"piwork/internal/pipackage"
	"piwork/internal/workcontext"
	"piwork/internal/workpackage"
)

func TestNativeSnapshotMovesServicesContextsAndPackagesBetweenOfflineInstallations(t *testing.T) {
	armPackageFailure, packageFailureHit, releasePackageFailure := snapshotRestoreActionStartFault(t, "restore-package", 2)
	source, sourceBase, sourceAuth, sourceWork, _ := nativeApplyFixture(t)
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Minute)
	defer cancel()
	if os.Getenv("PIWORK_TEST_NATIVE_SNAPSHOT_HELPER_IMAGE") == "" || os.Getenv("PIWORK_TEST_NATIVE_FILE_HELPER_IMAGE") == "" {
		t.Fatal("native snapshot and file helpers required")
	}
	client := &http.Client{Timeout: 3 * time.Minute}
	request := func(base, auth, method, path string, body io.Reader, headers map[string]string) *http.Response {
		t.Helper()
		req, err := http.NewRequestWithContext(ctx, method, base+path, body)
		if err != nil {
			t.Fatal(err)
		}
		if headers[gatewayCredential] == "" {
			req.Header.Set("Authorization", auth)
		}
		if file, ok := body.(*os.File); ok {
			info, err := file.Stat()
			if err != nil {
				t.Fatal(err)
			}
			req.ContentLength = info.Size()
		}
		for key, value := range headers {
			req.Header.Set(key, value)
		}
		response, err := client.Do(req)
		if err != nil {
			t.Fatal(method, path, err)
		}
		return response
	}
	accepted := func(a *Application, base, auth, path, key string) map[string]any {
		t.Helper()
		status, result := packageHTTPCall(t, base, path, "POST", auth, map[string]string{"idempotencyKey": key})
		if status != 202 {
			t.Fatal(path, status, result)
		}
		waitWorkOperation(t, ctx, a, result["operationId"].(string))
		return result
	}
	sourcePath := "/api/v1/works/" + sourceWork
	// A real prepared Pi package includes its installed dependency and original
	// manifest, extension, Skill, prompt and theme. No source is needed on target.
	_, caller, _, _ := runtime.Caller(0)
	tree, err := pipackage.OpenTree(ctx, filepath.Join(filepath.Dir(caller), "../../fixtures/pi-packages/tools-v1"))
	if err != nil {
		t.Fatal(err)
	}
	archive := filepath.Join(t.TempDir(), "tools.zip")
	_, err = pipackage.PackArchive(ctx, tree, archive)
	tree.Close()
	if err != nil {
		t.Fatal(err)
	}
	zipFile, err := os.Open(archive)
	if err != nil {
		t.Fatal(err)
	}
	hash := sha256.New()
	if _, err := io.Copy(hash, zipFile); err != nil {
		t.Fatal(err)
	}
	if _, err := zipFile.Seek(0, 0); err != nil {
		t.Fatal(err)
	}
	response := request(sourceBase, sourceAuth, "POST", sourcePath+"/package-uploads", zipFile, map[string]string{"Content-Type": "application/zip", "X-Piwork-Sha256": hex.EncodeToString(hash.Sum(nil)), "X-Piwork-Package-Source": "zip", "X-Piwork-Package-Name": "tools.zip"})
	zipFile.Close()
	var upload map[string]any
	err = json.NewDecoder(response.Body).Decode(&upload)
	response.Body.Close()
	if err != nil || response.StatusCode != 201 {
		t.Fatal(response.StatusCode, upload, err)
	}
	status, installation := packageHTTPCall(t, sourceBase, sourcePath+"/packages", "POST", sourceAuth, map[string]any{"source": map[string]any{"kind": "upload", "uploadId": upload["uploadId"]}, "idempotencyKey": "snapshot-work-package"})
	if status != 202 {
		t.Fatal(status, installation)
	}
	waitWorkOperation(t, ctx, source, installation["operationId"].(string))

	// All versions are captured into distinct owned contexts, including disabled
	// and active-only selections. Only the explicitly applied version runs.
	packageVersion := func(name, version string, update bool, key string) {
		t.Helper()
		folder := t.TempDir()
		if err := os.CopyFS(folder, os.DirFS(filepath.Join(filepath.Dir(caller), "../../fixtures/pi-packages/tools-v1"))); err != nil {
			t.Fatal(err)
		}
		manifestPath := filepath.Join(folder, "package.json")
		data, err := os.ReadFile(manifestPath)
		if err != nil {
			t.Fatal(err)
		}
		var manifest map[string]any
		if err := json.Unmarshal(data, &manifest); err != nil {
			t.Fatal(err)
		}
		manifest["name"], manifest["version"] = name, version
		if name != "@piwork/fixture-tools" {
			manifest["pi"] = map[string]any{"prompts": []string{"prompts/" + name + ".md"}}
			if err := os.Rename(filepath.Join(folder, "prompts/review.md"), filepath.Join(folder, "prompts", name+".md")); err != nil {
				t.Fatal(err)
			}
		}
		data, _ = json.Marshal(manifest)
		if err := os.WriteFile(manifestPath, data, 0600); err != nil {
			t.Fatal(err)
		}
		tree, err := pipackage.OpenTree(ctx, folder)
		if err != nil {
			t.Fatal(err)
		}
		packed := filepath.Join(t.TempDir(), "version.zip")
		_, err = pipackage.PackArchive(ctx, tree, packed)
		tree.Close()
		if err != nil {
			t.Fatal(err)
		}
		body, err := os.ReadFile(packed)
		if err != nil {
			t.Fatal(err)
		}
		sum := sha256.Sum256(body)
		res := request(sourceBase, sourceAuth, "POST", sourcePath+"/package-uploads", bytes.NewReader(body), map[string]string{"Content-Type": "application/zip", "X-Piwork-Sha256": hex.EncodeToString(sum[:]), "X-Piwork-Package-Source": "zip", "X-Piwork-Package-Name": "version.zip"})
		var upload map[string]any
		err = json.NewDecoder(res.Body).Decode(&upload)
		res.Body.Close()
		if err != nil || res.StatusCode != 201 {
			t.Fatal(res.StatusCode, upload, err)
		}
		endpoint := sourcePath + "/packages"
		if update {
			endpoint += "/" + url.PathEscape(name) + "/update"
		}
		status, result := packageHTTPCall(t, sourceBase, endpoint, "POST", sourceAuth, map[string]any{"source": map[string]any{"kind": "upload", "uploadId": upload["uploadId"]}, "idempotencyKey": key})
		if status != 202 {
			t.Fatal(status, result)
		}
		waitWorkOperation(t, ctx, source, result["operationId"].(string))
	}
	packageVersion("@piwork/fixture-tools", "0.0.0", true, "retained-v0")
	v0State, err := source.Store.Configuration(ctx, sourceWork)
	if err != nil {
		t.Fatal(err)
	}
	v0Context := *v0State.DesiredContextID
	packageVersion("@piwork/fixture-tools", "1.0.0", true, "retained-v1")
	packageVersion("disabled-tools", "1.0.0", false, "disabled-package")
	if status, result := packageHTTPCall(t, sourceBase, sourcePath+"/packages/disabled-tools/disable", "POST", sourceAuth, nil); status != 200 {
		t.Fatal(status, result)
	}
	packageVersion("active-only-tools", "1.0.0", false, "active-only-package")

	skillSource := filepath.Join(t.TempDir(), "portable-skill")
	if err := os.MkdirAll(filepath.Join(skillSource, "references"), 0700); err != nil {
		t.Fatal(err)
	}
	manifest := "---\nname: portable-skill\ndescription: Snapshot-owned supporting files.\n---\n\nSupporting file: references/proof.txt\n"
	if err := os.WriteFile(filepath.Join(skillSource, "SKILL.md"), []byte(manifest), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(skillSource, "references/proof.txt"), []byte("原始 Skill 文件"), 0600); err != nil {
		t.Fatal(err)
	}
	operator, err := os.ReadFile(filepath.Join(source.options.DataDirectory, "operator.credential"))
	if err != nil {
		t.Fatal(err)
	}
	if status, result := packageHTTPCall(t, sourceBase, "/control/skills", "POST", "Operator "+strings.TrimSpace(string(operator)), map[string]string{"path": skillSource}); status != 201 {
		t.Fatal(status, result)
	}
	if err := os.RemoveAll(skillSource); err != nil {
		t.Fatal(err)
	}

	script := `const fs=require('node:fs'),http=require('node:http');const file='/var/data/workspace/counter.txt';const server=http.createServer((req,res)=>{if(req.url==='/health'){res.end('ok');return;}let n=fs.existsSync(file)?Number(fs.readFileSync(file,'utf8')):0;fs.writeFileSync(file,String(++n));res.end(JSON.stringify({count:n}));});server.listen(8099,'0.0.0.0');process.on('SIGTERM',()=>{server.closeAllConnections();server.close(()=>process.exit(0));});`
	sourceServices := map[string]string{}
	for _, name := range []string{"web", "disabled", "removed"} {
		definition := map[string]any{"name": name, "image": map[string]string{"reference": source.options.Initialization.Runtime.AgentImage}, "command": "node", "args": []string{"-e", script}, "mounts": []any{map[string]any{"source": "workspace", "target": "/var/data/workspace", "readOnly": false}}, "ports": []any{map[string]any{"name": "http", "protocol": "tcp", "containerPort": 8099}}, "readiness": map[string]any{"kind": "http", "portName": "http", "path": "/health", "deadlineMs": 10000}}
		status, result := packageHTTPCall(t, sourceBase, sourcePath+"/services", "POST", sourceAuth, map[string]any{"definition": definition, "idempotencyKey": "snapshot-create-" + name})
		if status != 202 {
			t.Fatal(status, result)
		}
		waitWorkOperation(t, ctx, source, result["operationId"].(string))
		sourceServices[name] = result["serviceId"].(string)
	}
	accepted(source, sourceBase, sourceAuth, sourcePath+"/services/"+sourceServices["disabled"]+"/stop", "snapshot-disable")
	accepted(source, sourceBase, sourceAuth, sourcePath+"/services/"+sourceServices["removed"]+"/remove", "snapshot-remove")
	_, sourceView := packageHTTPCall(t, sourceBase, sourcePath+"/services/"+sourceServices["web"], "GET", sourceAuth, nil)
	sourceHostname := sourceView["access"].(map[string]any)["hostname"].(string)
	response = request(sourceBase, sourceAuth, "GET", "/api/v1/service-gateway/"+sourceHostname+"/80/", nil, map[string]string{gatewayCredential: strings.TrimPrefix(sourceAuth, "Bearer ")})
	var counter map[string]any
	err = json.NewDecoder(response.Body).Decode(&counter)
	response.Body.Close()
	if err != nil || counter["count"] != float64(1) {
		t.Fatal(counter, err)
	}
	response = request(sourceBase, sourceAuth, "PUT", sourcePath+"/files/user-token.txt", strings.NewReader("workspace-user-token"), nil)
	response.Body.Close()
	if response.StatusCode != 201 {
		t.Fatal(response.StatusCode)
	}
	opaque := []byte("source-url=http://" + sourceHostname + "/\nsource-service=" + sourceServices["web"] + "\n\x00\xff")
	response = request(sourceBase, sourceAuth, "PUT", sourcePath+"/files/opaque.bin", bytes.NewReader(opaque), nil)
	response.Body.Close()
	if response.StatusCode != 201 {
		t.Fatal(response.StatusCode)
	}
	state, err := source.Store.Configuration(ctx, sourceWork)
	if err != nil {
		t.Fatal(err)
	}
	var config contracts.WorkConfig
	if err := json.Unmarshal([]byte(state.DesiredConfigJSON), &config); err != nil {
		t.Fatal(err)
	}
	defaults, err := source.Store.DefaultWork(ctx)
	if err != nil {
		t.Fatal(err)
	}
	config.McpServers = defaults.Configuration.McpServers
	if len(config.McpServers) == 0 {
		t.Fatal("built-in MCP unavailable")
	}
	config.McpServers = append(config.McpServers, contracts.McpServer{
		ServerId: "portable-service-gate", Transport: "stdio", Required: false,
		Command:           contracts.Supplied("/usr/local/bin/piwork-service-mcp"),
		RequiredServiceId: contracts.Supplied(contracts.ResourceId(sourceServices["web"])),
	})
	config.Skills = contracts.SkillSelection{"portable-skill"}
	config.Tools.Denied = append(config.Tools.Denied, contracts.WorkToolPolicyKey("work-services.service_stop"))
	config.AgentsMd = "# Original instructions\n" + sourceHostname
	if status, view := packageHTTPCall(t, sourceBase, sourcePath+"/configuration", "PUT", sourceAuth, map[string]any{"configuration": config}); status != 200 {
		t.Fatal(status, view)
	}
	accepted(source, sourceBase, sourceAuth, sourcePath+"/configuration/apply", "snapshot-source-apply")
	status, session := packageHTTPCall(t, sourceBase, sourcePath+"/sessions", "POST", sourceAuth, map[string]string{"idempotencyKey": "snapshot-source-session"})
	if status != 201 {
		t.Fatal(status, session)
	}
	sessionID := session["sessionId"].(string)
	snapshotNativeRun(t, ctx, sourceBase, sourceAuth, sourceWork, sessionID, "source-package-tool", "invoke package tool fixture_hello", "package-tool-result:fixture_hello:v1:")
	if status, view := packageHTTPCall(t, sourceBase, sourcePath+"/configuration/agents", "PUT", sourceAuth, map[string]string{"agentsMd": "# Pending instructions\n" + sourceHostname}); status != 200 || view["pendingApply"] != true {
		t.Fatal(status, view)
	}
	packageVersion("@piwork/fixture-tools", "2.0.0", true, "pending-v2")
	if status, result := packageHTTPCall(t, sourceBase, sourcePath+"/packages/active-only-tools", "DELETE", sourceAuth, nil); status != 200 {
		t.Fatal(status, result)
	}
	accepted(source, sourceBase, sourceAuth, sourcePath+"/stop", "snapshot-source-stop")
	if err := source.Store.Write(ctx, func(tx *sql.Tx) error {
		// Simulate retained bookkeeping after failed disable/remove. Portable
		// metadata must preserve these facts even though no container is running.
		if _, err := tx.Exec(`UPDATE quota_reservations SET desired_cpu_millis=250,desired_memory_bytes=134217728 WHERE work_id=? AND subject_id=?`, sourceWork, sourceServices["disabled"]); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO volume_references(volume_id,consumer_kind,consumer_id,created_at) SELECT id,'service',?,? FROM volume_records WHERE work_id=? AND volume_role='workspace'`, sourceServices["removed"], packageNow(), sourceWork); err != nil {
			return err
		}
		if _, err := tx.Exec(`UPDATE volume_records SET reference_count=reference_count+1 WHERE work_id=? AND volume_role='workspace'`, sourceWork); err != nil {
			return err
		}
		_, err := tx.Exec(`UPDATE service_runtime_bindings SET recovery_count=2,recovery_window_started_at=? WHERE work_id=? AND service_id=?`, packageNow(), sourceWork, sourceServices["web"])
		return err
	}); err != nil {
		t.Fatal(err)
	}
	state, err = source.Store.Configuration(ctx, sourceWork)
	if err != nil {
		t.Fatal(err)
	}
	sourceMetadata, err := workcontext.Metadata(source.Store, sourceWork, *state.ActiveContextID)
	if err != nil {
		t.Fatal(err)
	}
	export := accepted(source, sourceBase, sourceAuth, sourcePath+"/exports", "snapshot-complete-export")
	response = request(sourceBase, sourceAuth, "GET", "/api/v1/work-snapshots/"+export["snapshotId"].(string)+"/content", nil, nil)
	if response.StatusCode != 200 {
		t.Fatal(response.StatusCode)
	}
	packagePath := filepath.Join(t.TempDir(), "offline.work")
	file, err := os.Create(packagePath)
	if err != nil {
		t.Fatal(err)
	}
	hash.Reset()
	size, err := io.CopyBuffer(io.MultiWriter(file, hash), response.Body, make([]byte, 1<<20))
	response.Body.Close()
	file.Close()
	if err != nil {
		t.Fatal(err)
	}
	digest := hex.EncodeToString(hash.Sum(nil))
	if response.Header.Get("X-Piwork-SHA256") != digest {
		t.Fatal("package transfer digest")
	}
	// A missing historical dependency cannot be repaired by consulting Core's catalog.
	v0Metadata, err := workcontext.Metadata(source.Store, sourceWork, v0Context)
	if err != nil {
		t.Fatal(err)
	}
	v0Package := filepath.Join(source.options.DataDirectory, "works", sourceWork, "contexts", v0Context, "packages", v0Metadata.PackageBindings[0].NameKey)
	if err := os.Chmod(filepath.Dir(v0Package), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(v0Package, v0Package+".hidden"); err != nil {
		t.Fatal(err)
	}
	status, missingExport := packageHTTPCall(t, sourceBase, sourcePath+"/exports", "POST", sourceAuth, map[string]string{"idempotencyKey": "missing-historical-package"})
	if status != 202 {
		t.Fatal(status, missingExport)
	}
	waitApplyFailure(t, ctx, source, missingExport["operationId"].(string))
	if err := os.Rename(v0Package+".hidden", v0Package); err != nil {
		t.Fatal(err)
	}
	if err := source.Close(ctx); err != nil {
		t.Fatal("source offline", err)
	}
	if err := os.Remove(archive); err != nil {
		t.Fatal(err)
	}
	file, err = os.Open(packagePath)
	if err != nil {
		t.Fatal(err)
	}
	inspection, err := workpackage.Inspect(ctx, file, size)
	file.Close()
	if err != nil || !inspection.IntegrityVerified || inspection.InstallationValidated {
		t.Fatal(inspection, err)
	}
	file, err = os.Open(packagePath)
	if err != nil {
		t.Fatal(err)
	}
	verified, err := workpackage.Read(ctx, file, workpackage.ReadOptions{})
	file.Close()
	if err != nil {
		t.Fatal(err)
	}
	versions := map[string]bool{}
	// Canonical metadata includes every artifact's captured package manifest version.
	rawSpec, _ := json.Marshal(verified.Spec)
	for _, version := range []string{"0.0.0", "1.0.0", "2.0.0"} {
		versions[version] = bytes.Contains(rawSpec, []byte(`"version":"`+version+`"`))
		if !versions[version] {
			t.Fatal("retained version omitted", version)
		}
	}
	if bytes.Contains(rawSpec, []byte("acceptance-only")) || bytes.Contains(rawSpec, []byte("agent-service-client.key")) || bytes.Contains(rawSpec, []byte("operator.credential")) {
		t.Fatal("platform injected credentials exported")
	}
	// Independent identity/catalog/storage, with the source Core already closed.
	target, targetBase, targetAuth, baseline, _ := nativeApplyFixture(t)
	if target.Store.InstallationID() == source.Store.InstallationID() {
		t.Fatal("installations not isolated")
	}
	if status, _ := packageHTTPCall(t, targetBase, "/api/v1/me", "GET", sourceAuth, nil); status != 401 {
		t.Fatal("source login credential authenticated in the recipient installation", status)
	}
	accepted(target, targetBase, targetAuth, "/api/v1/works/"+baseline+"/stop", "target-baseline-stop")
	file, err = os.Open(packagePath)
	if err != nil {
		t.Fatal(err)
	}
	response = request(targetBase, targetAuth, "POST", "/api/v1/work-packages", file, map[string]string{"Content-Type": snapshotMIME, "X-Piwork-SHA256": digest})
	file.Close()
	var uploaded map[string]any
	err = json.NewDecoder(response.Body).Decode(&uploaded)
	response.Body.Close()
	if err != nil || response.StatusCode != 201 {
		t.Fatal(response.StatusCode, uploaded, err)
	}
	armPackageFailure(target.Store.InstallationID())
	status, failedImport := packageHTTPCall(t, targetBase, "/api/v1/work-imports", "POST", targetAuth, map[string]string{"packageId": uploaded["packageId"].(string), "idempotencyKey": "second-context-package-fault"})
	if status != 202 {
		t.Fatal(status, failedImport)
	}
	select {
	case <-packageFailureHit:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	releasePackageFailure()
	waitApplyFailure(t, ctx, target, failedImport["operationId"].(string))
	if _, err := target.Store.Work(ctx, failedImport["workId"].(string), false); err == nil {
		t.Fatal("partially restored Work visible")
	}
	if _, err := target.Store.Work(ctx, baseline, false); err != nil {
		t.Fatal("existing Work damaged", err)
	}
	// Simultaneous automatic names reserve distinct identities before publication.
	type importResult struct {
		status int
		result map[string]any
		key    string
	}
	results := make(chan importResult, 2)
	for _, key := range []string{"concurrent-name-a", "concurrent-name-b"} {
		go func(key string) {
			code, result := packageHTTPCall(t, targetBase, "/api/v1/work-imports", "POST", targetAuth, map[string]string{"packageId": uploaded["packageId"].(string), "idempotencyKey": key})
			results <- importResult{code, result, key}
		}(key)
	}
	firstConcurrent, secondConcurrent := <-results, <-results
	// The v1 contract permits one active snapshot job per installation.
	// Both concurrent intents survive: the busy one retries its original key
	// after capacity is released, and cannot overwrite the first reservation.
	if firstConcurrent.status == 409 {
		firstConcurrent, secondConcurrent = secondConcurrent, firstConcurrent
	}
	if firstConcurrent.status != 202 || secondConcurrent.status != 409 || secondConcurrent.result["code"] != "SNAPSHOT_CAPACITY_BUSY" {
		t.Fatal("snapshot admission did not enforce capacity", firstConcurrent, secondConcurrent)
	}
	waitWorkOperation(t, ctx, target, firstConcurrent.result["operationId"].(string))
	secondConcurrent.status, secondConcurrent.result = packageHTTPCall(t, targetBase, "/api/v1/work-imports", "POST", targetAuth, map[string]string{"packageId": uploaded["packageId"].(string), "idempotencyKey": secondConcurrent.key})
	if secondConcurrent.status != 202 || firstConcurrent.result["name"] == secondConcurrent.result["name"] {
		t.Fatal("automatic names overwrite accepted intent", firstConcurrent, secondConcurrent)
	}
	waitWorkOperation(t, ctx, target, secondConcurrent.result["operationId"].(string))
	for _, intent := range []importResult{firstConcurrent, secondConcurrent} {
		code, replay := packageHTTPCall(t, targetBase, "/api/v1/work-imports", "POST", targetAuth, map[string]string{"packageId": uploaded["packageId"].(string), "idempotencyKey": intent.key})
		if code != 202 || replay["name"] != intent.result["name"] || replay["workId"] != intent.result["workId"] || replay["operationId"] != intent.result["operationId"] {
			t.Fatal("automatic name replay changed identity", replay)
		}
	}
	imported := firstConcurrent.result
	targetWork := imported["workId"].(string)
	targetPath := "/api/v1/works/" + targetWork
	work, err := target.Store.Work(ctx, targetWork, false)
	if err != nil || targetWork == sourceWork || work.DesiredState != "stopped" || work.ObservedState != "stopped" || work.ActiveContextID == nil || *work.ActiveContextID == *state.ActiveContextID {
		t.Fatal(work, err)
	}
	_, view := packageHTTPCall(t, targetBase, targetPath+"/configuration", "GET", targetAuth, nil)
	if view["pendingApply"] != true || view["active"].(map[string]any)["agentsMd"] != config.AgentsMd || view["desired"].(map[string]any)["agentsMd"] != "# Pending instructions\n"+sourceHostname {
		t.Fatal("desired/active or source text changed", view)
	}
	metadata, err := workcontext.Metadata(target.Store, targetWork, *work.ActiveContextID)
	if err != nil || len(metadata.PackageBindings) != len(sourceMetadata.PackageBindings) || metadata.PackageBindings[0].Artifact.ContentDigest != sourceMetadata.PackageBindings[0].Artifact.ContentDigest {
		t.Fatal("package identity changed", metadata, err)
	}
	proof := filepath.Join(target.options.DataDirectory, "works", targetWork, "contexts", *work.ActiveContextID, "skills/portable-skill/references/proof.txt")
	if data, err := os.ReadFile(proof); err != nil || string(data) != "原始 Skill 文件" {
		t.Fatal("Skill bytes changed", err)
	}
	var provenance contracts.WorkSourceIdentityMap
	var identityTargets snapshotIdentityTargets
	if err := target.Store.Read(ctx, func(tx *sql.Tx) error {
		var raw string
		if err := tx.QueryRow(`SELECT identity_map_json FROM work_import_provenance WHERE work_id=?`, targetWork).Scan(&raw); err != nil {
			return err
		}
		var value struct {
			SourceIdentityMap contracts.WorkSourceIdentityMap `json:"sourceIdentityMap"`
			Targets           snapshotIdentityTargets         `json:"targets"`
		}
		if err := json.Unmarshal([]byte(raw), &value); err != nil {
			return err
		}
		provenance, identityTargets = value.SourceIdentityMap, value.Targets
		var catalogPackages int
		if err := tx.QueryRow(`SELECT count(*) FROM pi_package_catalog WHERE name<>'piwork-brain'`).Scan(&catalogPackages); err != nil {
			return err
		}
		if catalogPackages != 0 {
			t.Fatal("target unexpectedly had package source")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	targetServices := map[string]string{}
	for name, sourceID := range sourceServices {
		key := ""
		for _, entry := range provenance.Services {
			if string(entry.SourceId) == sourceID {
				key = string(entry.Key)
			}
		}
		id := snapshotTargetID(identityTargets.Services, key)
		if id == "" || id == sourceID {
			t.Fatal("service identity not remapped", name, id)
		}
		targetServices[name] = id
		record, err := target.Store.Service(ctx, targetWork, id, true)
		if err != nil || record.Name != name || record.Enabled != (name == "web") || (record.TombstonedAt != nil) != (name == "removed") {
			t.Fatal("service state changed", record, err)
		}
	}
	status, stoppedService := packageHTTPCall(t, targetBase, targetPath+"/services/"+targetServices["web"], "GET", targetAuth, nil)
	if status != 200 || stoppedService["access"].(map[string]any)["status"] != "unavailable" {
		t.Fatal("imported service was not visibly unavailable before explicit Start", status, stoppedService)
	}
	stoppedHostname := stoppedService["access"].(map[string]any)["hostname"].(string)
	if stoppedHostname == sourceHostname {
		t.Fatal("stopped import reused source hostname")
	}
	response = request(targetBase, targetAuth, "GET", "/api/v1/service-gateway/"+stoppedHostname+"/80/", nil, map[string]string{gatewayCredential: strings.TrimPrefix(targetAuth, "Bearer ")})
	if response.StatusCode != 503 {
		t.Fatal("stopped imported service was reachable", response.StatusCode)
	}
	response.Body.Close()
	mappedMCP := false
	for _, raw := range view["active"].(map[string]any)["mcpServers"].([]any) {
		server := raw.(map[string]any)
		if server["serverId"] == "portable-service-gate" {
			mappedMCP = server["requiredServiceId"] == targetServices["web"]
		}
	}
	if !mappedMCP {
		t.Fatal("MCP requiredServiceId not remapped", view)
	}
	if err := target.Store.Read(ctx, func(tx *sql.Tx) error {
		var cpu, memory, occupied int64
		if err := tx.QueryRow(`SELECT desired_cpu_millis,desired_memory_bytes,occupied_cpu_millis FROM quota_reservations WHERE work_id=? AND subject_id=?`, targetWork, targetServices["disabled"]).Scan(&cpu, &memory, &occupied); err != nil {
			return err
		}
		if cpu != 250 || memory != 134217728 || occupied != 0 {
			t.Fatal("disabled persistent reservation discarded", cpu, memory, occupied)
		}
		var refs, recorded, count int
		if err := tx.QueryRow(`SELECT count(*) FROM volume_references r JOIN volume_records v ON v.id=r.volume_id WHERE v.work_id=? AND v.volume_role='workspace' AND r.consumer_kind='service' AND r.consumer_id=?`, targetWork, targetServices["removed"]).Scan(&refs); err != nil {
			return err
		}
		if err := tx.QueryRow(`SELECT reference_count,(SELECT count(*) FROM volume_references r WHERE r.volume_id=v.id) FROM volume_records v WHERE work_id=? AND volume_role='workspace'`, targetWork).Scan(&recorded, &count); err != nil {
			return err
		}
		if refs != 1 || recorded != count {
			t.Fatal("tombstone reference or reference count lost", refs, recorded, count)
		}
		var recovered, historyCount, stagedContainers int
		if err := tx.QueryRow(`SELECT recovery_count FROM service_runtime_bindings WHERE work_id=? AND service_id=?`, targetWork, targetServices["web"]).Scan(&recovered); err != nil {
			return err
		}
		if err := tx.QueryRow(`SELECT count(*) FROM imported_work_history WHERE work_id=?`, targetWork).Scan(&historyCount); err != nil {
			return err
		}
		if err := tx.QueryRow(`SELECT count(*) FROM service_runtime_bindings WHERE work_id=? AND container_id IS NOT NULL`, targetWork).Scan(&stagedContainers); err != nil {
			return err
		}
		if recovered != 2 || historyCount == 0 || stagedContainers != 0 {
			t.Fatal("budget/history/no-execution boundary", recovered, historyCount, stagedContainers)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	status, provenanceView := packageHTTPCall(t, targetBase, targetPath+"/import-provenance", "GET", targetAuth, nil)
	if status != 200 || provenanceView["sourcePackageDigest"] != digest || contracts.Validate("WorkImportProvenanceSchema", provenanceView) != nil {
		t.Fatal("import provenance unavailable", status, provenanceView)
	}
	for _, entry := range provenanceView["operationMap"].([]any) {
		mapping := entry.(map[string]any)
		if mapping["sourceOperationId"] == mapping["operationId"] {
			t.Fatal("historical identity reused", mapping)
		}
		status, view := packageHTTPCall(t, targetBase, "/api/v1/operations/"+mapping["operationId"].(string), "GET", targetAuth, nil)
		if status != 200 || view["workId"] != targetWork || contracts.Validate("PublicOperationSchema", view) != nil {
			t.Fatal("historical operation not safely queryable", status, view)
		}
	}
	accepted(target, targetBase, targetAuth, targetPath+"/start", "offline-target-start")
	readyWork, err := target.Store.Work(ctx, targetWork, false)
	if err != nil {
		t.Fatal(err)
	}
	generation, instance, err := target.selectAgentGeneration(ctx, readyWork)
	if err != nil {
		t.Fatal(err)
	}
	daemon, _, err := target.agentRoutes.Admission(internaltls.Scope{InstallationID: target.Store.InstallationID(), WorkID: targetWork, Generation: generation, InstanceID: instance}, *readyWork.ActiveContextID)
	if err != nil {
		t.Fatal(err)
	}
	ready, err := daemon.ObserveReadiness(ctx, *readyWork.ActiveContextID)
	if err != nil {
		t.Fatal(err)
	}
	for _, tool := range ready.GetResolvedTools() {
		if tool == "work-services.service_stop" {
			t.Fatal("import reauthorized denied stop", tool)
		}
	}

	status, initialHistory := packageHTTPCall(t, targetBase, targetPath+"/sessions/"+sessionID, "GET", targetAuth, nil)
	if status != 200 {
		t.Fatal("imported Session history unavailable", status, initialHistory)
	}
	initialMessages, err := json.Marshal(initialHistory["messages"])
	if err != nil {
		t.Fatal(err)
	}
	_, targetServiceView := packageHTTPCall(t, targetBase, targetPath+"/services/"+targetServices["web"], "GET", targetAuth, nil)
	targetHostname := targetServiceView["access"].(map[string]any)["hostname"].(string)
	if targetHostname == sourceHostname {
		t.Fatal("network identity reused")
	}
	response = request(targetBase, targetAuth, "GET", "/api/v1/service-gateway/"+targetHostname+"/80/", nil, map[string]string{gatewayCredential: strings.TrimPrefix(targetAuth, "Bearer ")})
	err = json.NewDecoder(response.Body).Decode(&counter)
	response.Body.Close()
	if err != nil || counter["count"] != float64(2) {
		t.Fatal("shared service data not restored", counter, err)
	}
	response = request(targetBase, targetAuth, "GET", targetPath+"/files/opaque.bin", nil, nil)
	data, err := io.ReadAll(response.Body)
	response.Body.Close()
	if err != nil || response.StatusCode != 200 || !bytes.Equal(data, opaque) {
		t.Fatal("user data/source URL rewritten", err)
	}
	response = request(targetBase, targetAuth, "GET", targetPath+"/files/user-token.txt", nil, nil)
	tokenBytes, err := io.ReadAll(response.Body)
	response.Body.Close()
	if err != nil || response.StatusCode != 200 || string(tokenBytes) != "workspace-user-token" {
		t.Fatal("user token file changed", err)
	}
	snapshotNativeRun(t, ctx, targetBase, targetAuth, targetWork, sessionID, "target-package-tool", "invoke package tool fixture_hello", "package-tool-result:fixture_hello:v1:")
	snapshotNativeRun(t, ctx, targetBase, targetAuth, targetWork, sessionID, "target-mcp-service", "inspect restored web service", "snapshot-service-observed:"+targetServices["web"])
	_, firstHistory := packageHTTPCall(t, targetBase, targetPath+"/sessions/"+sessionID, "GET", targetAuth, nil)
	firstMessages, _ := json.Marshal(firstHistory["messages"])
	// Import the same frozen package again. The local Session identity and
	// original transcript stay the same, while subsequent Runs remain scoped.
	secondImport := secondConcurrent.result
	secondWork := secondImport["workId"].(string)
	if secondWork == targetWork || secondWork == sourceWork {
		t.Fatal("second import reused another Work identity", secondWork)
	}
	secondPath := "/api/v1/works/" + secondWork
	status, secondServices := packageHTTPCall(t, targetBase, secondPath+"/services", "GET", targetAuth, nil)
	if status != 200 {
		t.Fatal("second import services unavailable", status, secondServices)
	}
	secondHostname := ""
	for _, item := range secondServices["services"].([]any) {
		service := item.(map[string]any)
		if service["name"] == "web" {
			access := service["access"].(map[string]any)
			if access["status"] != "unavailable" {
				t.Fatal("second import started its service implicitly", access)
			}
			secondHostname = access["hostname"].(string)
		}
	}
	if secondHostname == "" || secondHostname == sourceHostname || secondHostname == targetHostname {
		t.Fatal("second import reused a service hostname", secondHostname)
	}
	response = request(targetBase, targetAuth, "GET", "/api/v1/service-gateway/"+secondHostname+"/80/", nil, map[string]string{gatewayCredential: strings.TrimPrefix(targetAuth, "Bearer ")})
	if response.StatusCode != 503 {
		t.Fatal("second import was reachable before Start", response.StatusCode)
	}
	response.Body.Close()
	accepted(target, targetBase, targetAuth, secondPath+"/start", "second-copy-start")
	status, secondHistory := packageHTTPCall(t, targetBase, secondPath+"/sessions/"+sessionID, "GET", targetAuth, nil)
	secondMessages, _ := json.Marshal(secondHistory["messages"])
	if status != 200 || !bytes.Equal(secondMessages, initialMessages) {
		t.Fatal("second copy inherited first copy's new messages", status, secondHistory)
	}
	snapshotNativeRun(t, ctx, targetBase, targetAuth, secondWork, sessionID, "second-copy-package-tool", "invoke package tool fixture_hello", "package-tool-result:fixture_hello:v1:")
	_, unchangedFirst := packageHTTPCall(t, targetBase, targetPath+"/sessions/"+sessionID, "GET", targetAuth, nil)
	unchangedMessages, _ := json.Marshal(unchangedFirst["messages"])
	if !bytes.Equal(firstMessages, unchangedMessages) {
		t.Fatal("continuing second copy changed first copy's transcript")
	}
	accepted(target, targetBase, targetAuth, secondPath+"/stop", "second-copy-stop")
	// An unrelated edit must continue using owned imported artifacts, with no
	// counterpart in the target Core's global catalog.
	if status, view := packageHTTPCall(t, targetBase, targetPath+"/configuration/agents", "PUT", targetAuth, map[string]string{"agentsMd": "# Target-only edit"}); status != 200 || view["pendingApply"] != true {
		t.Fatal(status, view)
	}
	accepted(target, targetBase, targetAuth, targetPath+"/configuration/apply", "offline-target-edit-apply")
	status, oldRun := packageHTTPCall(t, targetBase, targetPath+"/runs", "POST", targetAuth, map[string]string{"sessionId": sessionID, "submissionKey": "old-context-must-not-rebind", "prompt": "hello"})
	if status == 202 {
		// The retained harness accepts durably before opening the SDK Session;
		// the context mismatch must then fail without rebinding or model calls.
		oldRunID := oldRun["run"].(map[string]any)["runId"].(string)
		for {
			status, result := packageHTTPCall(t, targetBase, targetPath+"/runs/"+oldRunID, "GET", targetAuth, nil)
			if status != 200 {
				t.Fatal(status, result)
			}
			if result["state"] == float64(5) {
				break
			}
			if result["state"] == float64(4) || ctx.Err() != nil {
				t.Fatal("Apply silently rebound imported old Session", result)
			}
			time.Sleep(50 * time.Millisecond)
		}
	} else if status < 400 {
		t.Fatal("unexpected old Session continuation response", status, oldRun)
	}
	status, oldHistory := packageHTTPCall(t, targetBase, targetPath+"/sessions/"+sessionID, "GET", targetAuth, nil)
	oldMessages, _ := json.Marshal(oldHistory["messages"])
	if status != 200 || !bytes.Equal(oldMessages, firstMessages) {
		t.Fatal("historical Session changed after context Apply", status, oldHistory)
	}
	// Sessions retain their accepted context identity. A newly applied context
	// uses a new Session; the imported Session was continued above before Apply.
	status, nextSession := packageHTTPCall(t, targetBase, targetPath+"/sessions", "POST", targetAuth, map[string]any{"idempotencyKey": "target-after-edit-session"})
	if status != 201 {
		t.Fatal(status, nextSession)
	}
	nextSessionID := nextSession["sessionId"].(string)
	snapshotNativeRun(t, ctx, targetBase, targetAuth, targetWork, nextSessionID, "target-package-after-edit", "invoke package tool fixture_hello", "package-tool-result:fixture_hello:v1:")
	accepted(target, targetBase, targetAuth, targetPath+"/stop", "offline-target-stop")
	// Re-export must include both imported provenance and newly accepted history,
	// without replaying historical control records or changing user bytes.
	accepted(target, targetBase, targetAuth, targetPath+"/exports", "offline-target-reexport")
	t.Log("offline migration:", source.Store.InstallationID(), target.Store.InstallationID(), digest, size, sourceWork, targetWork, targetServices)
}

func snapshotNativeRun(t *testing.T, ctx context.Context, base, auth, work, session, key, prompt, want string) {
	t.Helper()
	path := "/api/v1/works/" + work
	status, submission := packageHTTPCall(t, base, path+"/runs", "POST", auth, map[string]any{"sessionId": session, "submissionKey": key, "prompt": prompt})
	if status != 202 {
		t.Fatal(status, submission)
	}
	runID := submission["run"].(map[string]any)["runId"].(string)
	for {
		status, run := packageHTTPCall(t, base, path+"/runs/"+runID, "GET", auth, nil)
		if status != 200 {
			t.Fatal(status, run)
		}
		state := run["state"].(float64)
		if state >= 4 {
			encoded, _ := json.Marshal(run)
			if state != 4 || !bytes.Contains(encoded, []byte(want)) {
				t.Fatal("actual TS SDK Run", string(encoded))
			}
			return
		}
		select {
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		case <-time.After(100 * time.Millisecond):
		}
	}
}
