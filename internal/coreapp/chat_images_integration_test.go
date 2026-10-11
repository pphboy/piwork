//go:build integration

package coreapp

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"github.com/moby/moby/client"
	"hash/crc32"
	"io"
	"net/http"
	"os"
	"piwork/internal/corestore"
	"piwork/internal/dockerengine"
	"piwork/internal/testsupport"
	"testing"
	"time"
)

// The receiving installation does not need an unrelated fixture Work. Wait for
// asynchronous runtime recovery before importing into this independent Core.
func imageRecipient(t *testing.T, ctx context.Context, image string) (*Application, string, string) {
	t.Helper()
	scope, err := testsupport.NewScope()
	if err != nil {
		t.Fatal(err)
	}
	host := os.Getenv("PIWORK_TEST_DOCKER_HOST")
	if host == "" {
		host = "unix:///var/run/docker.sock"
	}
	engine, err := client.NewClientWithOpts(client.WithHost(host), client.WithAPIVersionNegotiation())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := scope.Cleanup(cleanup, engine); err != nil {
			t.Error(err)
		}
		engine.Close()
	})
	directory := t.TempDir()
	store, err := corestore.Open(ctx, corestore.Options{Directory: directory, InstallationID: scope.ID()})
	if err != nil {
		t.Fatal(err)
	}
	store.Close()
	a, base, _ := appFixture(t, Options{AgentGRPCListen: "0.0.0.0:0", DataDirectory: directory, PackageHelperImage: image, FileHelperImage: os.Getenv("PIWORK_TEST_NATIVE_FILE_HELPER_IMAGE"), SnapshotHelperImage: os.Getenv("PIWORK_TEST_NATIVE_SNAPSHOT_HELPER_IMAGE"), DockerOptions: dockerengine.SelectionOptions{DockerHost: host, DockerConfig: t.TempDir()}, Initialization: Initialization{Administrator: &struct{ Account, Password string }{"admin", "development-fixture-pass"}, Runtime: &RuntimeInput{AgentImage: image, Provider: "piwork-deterministic", Model: "fixture-v1", Credential: "acceptance-only"}}})
	deadline := time.Now().Add(time.Minute)
	for !a.Status().Ready {
		if time.Now().After(deadline) || ctx.Err() != nil {
			t.Fatal("recipient runtime did not recover", a.Status(), a.Preparation())
		}
		time.Sleep(100 * time.Millisecond)
	}
	login, err := a.Identity.Login(ctx, "admin", "development-fixture-pass", "image-recipient")
	if err != nil {
		t.Fatal(err)
	}
	return a, base, "Bearer " + login.Token
}

func TestNativeChatImagesAndOfflinePackageRoundTrip(t *testing.T) {
	g, image := nativeModelGateway(t)
	t.Setenv("PIWORK_TEST_NATIVE_AGENT_IMAGE", image)
	a, base, auth, work, _ := nativeApplyFixture(t)
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Minute)
	defer cancel()
	path := "/api/v1/works/" + work
	addModel := func(base, auth, key string) map[string]any {
		provider := modelNativeCall(t, base, auth, "/api/v1/admin/model-providers", "POST", map[string]any{"name": "Images " + key, "api": "openai-responses", "baseUrl": g.URL + "/v1", "credential": "synthetic-image-" + key}, 201)
		return modelNativeCall(t, base, auth, "/api/v1/admin/model-providers/"+provider["id"].(string)+"/models", "POST", map[string]any{"model": "gpt-5.1", "name": "Image model"}, 201)
	}
	model := addModel(base, auth, "source")
	view := modelNativeCall(t, base, auth, path+"/configuration", "GET", nil, 200)
	config := view["desired"].(map[string]any)
	config["modelRef"] = model["modelRef"]
	modelNativeCall(t, base, auth, path+"/configuration", "PUT", map[string]any{"configuration": config}, 200)
	apply := modelNativeCall(t, base, auth, path+"/configuration/apply", "POST", map[string]string{"idempotencyKey": "images-apply"}, 202)
	waitWorkOperation(t, ctx, a, apply["operationId"].(string))
	capability := modelNativeCall(t, base, auth, path+"/chat-image-capabilities", "GET", nil, 200)
	if capability["profile"] != "chat-images-v1" || capability["defaultModel"].(map[string]any)["availability"] != "supported" {
		t.Fatal("image capability missing", capability)
	}
	session := modelNativeCall(t, base, auth, path+"/sessions", "POST", map[string]string{"idempotencyKey": "image-session"}, 201)["sessionId"].(string)
	png, err := os.ReadFile("../../fixtures/chat-images/png.png")
	if err != nil {
		t.Fatal(err)
	}
	// Cross the old 4 MiB gRPC limit with a structurally valid PNG.
	chunk := bytes.Repeat([]byte{'x'}, (5<<20)-len(png))
	binary.BigEndian.PutUint32(chunk, uint32(len(chunk)-12))
	copy(chunk[4:], "tEXt")
	chunk[8] = 'k'
	chunk[9] = 0
	binary.BigEndian.PutUint32(chunk[len(chunk)-4:], crc32.ChecksumIEEE(chunk[4:len(chunk)-4]))
	png = append(append(append([]byte{}, png[:len(png)-12]...), chunk...), png[len(png)-12:]...)
	jpg, err := os.ReadFile("../../fixtures/chat-images/jpeg.jpg")
	if err != nil {
		t.Fatal(err)
	}
	images := []map[string]string{{"mimeType": "image/png", "data": base64.StdEncoding.EncodeToString(png)}, {"mimeType": "image/jpeg", "data": base64.StdEncoding.EncodeToString(jpg)}}
	input := map[string]any{"sessionId": session, "submissionKey": "image-pure", "prompt": "", "inputMode": "text", "images": images}
	accepted := modelNativeCall(t, base, auth, path+"/runs", "POST", input, 202)
	run := accepted["run"].(map[string]any)["runId"].(string)
	for {
		state := modelNativeCall(t, base, auth, path+"/runs/"+run, "GET", nil, 200)
		if state["state"] == float64(4) {
			break
		}
		if state["state"].(float64) >= 5 || ctx.Err() != nil {
			t.Fatal("image SDK Run failed", state)
		}
		time.Sleep(30 * time.Millisecond)
	}
	body, _ := json.Marshal(g.last().Body)
	for _, image := range images {
		if !bytes.Contains(body, []byte(image["data"])) {
			t.Fatal("actual SDK request lost image bytes")
		}
	}
	count := g.count()
	replayed := modelNativeCall(t, base, auth, path+"/runs", "POST", input, 202)
	if replayed["run"].(map[string]any)["runId"] != run || g.count() != count {
		t.Fatal("image replay executed twice")
	}
	input["images"] = []map[string]string{images[1], images[0]}
	modelNativeCall(t, base, auth, path+"/runs", "POST", input, 409)
	history := modelNativeCall(t, base, auth, path+"/sessions/"+session+"?imageProfile=chat-images-v1", "GET", nil, 200)
	encoded, _ := json.Marshal(history)
	if bytes.Contains(encoded, []byte(images[0]["data"])) || !bytes.Contains(encoded, []byte(`"type":"image"`)) {
		t.Fatal("history must carry only image metadata")
	}
	legacy := modelNativeCall(t, base, auth, path+"/sessions/"+session, "GET", nil, 200)
	encoded, _ = json.Marshal(legacy)
	if bytes.Contains(encoded, []byte(`"type":"image"`)) {
		t.Fatal("legacy history received new image blocks")
	}
	readImage := func(base, auth, work string) {
		t.Helper()
		request, _ := http.NewRequestWithContext(ctx, "GET", base+"/api/v1/works/"+work+"/sessions/"+session+"/runs/"+run+"/images/0", nil)
		request.Header.Set("Authorization", auth)
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		raw, _ := io.ReadAll(response.Body)
		if response.StatusCode != 200 || !bytes.Equal(raw, png) || response.Header.Get("Cache-Control") != "no-store" {
			t.Fatal("original image read failed", response.StatusCode)
		}
	}
	readImage(base, auth, work)
	other := modelNativeCall(t, base, auth, "/api/v1/admin/users", "POST", map[string]string{"account": "image-other", "password": "development-fixture-pass"}, 201)
	_ = other
	login := modelNativeCall(t, base, "", "/api/v1/login", "POST", map[string]string{"account": "image-other", "password": "development-fixture-pass"}, 200)
	imagePath := path + "/sessions/" + session + "/runs/" + run + "/images/0"
	modelNativeCall(t, base, "Bearer "+login["token"].(string), imagePath, "GET", nil, 404)
	modelNativeCall(t, base, "", imagePath, "GET", nil, 401)

	stop := modelNativeCall(t, base, auth, path+"/stop", "POST", map[string]string{"idempotencyKey": "image-stop"}, 202)
	waitWorkOperation(t, ctx, a, stop["operationId"].(string))
	modelNativeCall(t, base, auth, imagePath, "GET", nil, 503)
	packagePath, _ := modelNativeExport(t, ctx, a, base, auth, work, "image-export")
	b, recipient, recipientAuth := imageRecipient(t, ctx, image)
	addModel(recipient, recipientAuth, "recipient")
	if err := a.Close(ctx); err != nil {
		t.Fatal(err)
	}
	file, err := os.Open(packagePath)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	info, _ := file.Stat()
	hash := sha256.New()
	_, _ = io.Copy(hash, file)
	_, _ = file.Seek(0, 0)
	request, _ := http.NewRequestWithContext(ctx, "POST", recipient+"/api/v1/work-packages", file)
	request.ContentLength = info.Size()
	request.Header.Set("Authorization", recipientAuth)
	request.Header.Set("Content-Type", snapshotMIME)
	request.Header.Set("X-Piwork-SHA256", hex.EncodeToString(hash.Sum(nil)))
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	var uploaded map[string]any
	_ = json.NewDecoder(response.Body).Decode(&uploaded)
	response.Body.Close()
	if response.StatusCode != 201 {
		t.Fatal("image package upload", response.StatusCode, uploaded)
	}
	before := g.count()
	imported := modelNativeCall(t, recipient, recipientAuth, "/api/v1/work-imports", "POST", map[string]any{"packageId": uploaded["packageId"], "idempotencyKey": "image-import"}, 202)
	waitWorkOperation(t, ctx, b, imported["operationId"].(string))
	target := imported["workId"].(string)
	record, err := b.Store.Work(ctx, target, false)
	if err != nil || record.DesiredState != "stopped" || g.count() != before {
		t.Fatal("import started or replayed image history")
	}
	start := modelNativeCall(t, recipient, recipientAuth, "/api/v1/works/"+target+"/start", "POST", map[string]string{"idempotencyKey": "image-start"}, 202)
	waitWorkOperation(t, ctx, b, start["operationId"].(string))
	readImage(recipient, recipientAuth, target)
	modelNativeRun(t, ctx, recipient, recipientAuth, target, session, "image-follow-up")
	body, _ = json.Marshal(g.last().Body)
	if !bytes.Contains(body, []byte(images[0]["data"])) || g.last().Key != "synthetic-image-recipient" {
		t.Fatal("continued image Session lost original image or used source authority")
	}
	t.Log("Pure image input reached the real SDK; metadata-only history, idempotency, original bytes and source-offline Work package continuation passed")
}
