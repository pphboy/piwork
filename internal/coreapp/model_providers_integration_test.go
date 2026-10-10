//go:build integration

package coreapp

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"piwork/internal/workpackage"
)

type modelGatewayRequest struct {
	API, Model, Key     string
	Thinking, Reasoning map[string]any
	Stream              bool
	Path                string
}
type modelGateway struct {
	URL      string
	mu       sync.Mutex
	requests []modelGatewayRequest
	hold     chan struct{}
	started  chan struct{}
}

func (g *modelGateway) count() int { g.mu.Lock(); defer g.mu.Unlock(); return len(g.requests) }
func (g *modelGateway) last() modelGatewayRequest {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.requests[len(g.requests)-1]
}

// The CA and image belong only to this test. Production TLS validation is kept
// enabled in both Core's HTTP Test and the actual containerized Pi SDK.
func nativeModelGateway(t *testing.T) (*modelGateway, string) {
	t.Helper()
	docker, err := exec.LookPath("docker")
	if err != nil {
		t.Fatal("Docker build tool required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	output, err := exec.CommandContext(ctx, docker, "network", "inspect", "bridge", "--format", "{{(index .IPAM.Config 0).Gateway}}").Output()
	if err != nil {
		t.Fatal("Docker bridge unavailable")
	}
	host := strings.TrimSpace(string(output))
	if net.ParseIP(host) == nil {
		t.Fatal("invalid test bridge address")
	}
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	template := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "Synthetic model gateway"}, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(24 * time.Hour), IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign | x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}, IPAddresses: []net.IP{net.ParseIP(host), net.ParseIP("127.0.0.1")}}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	certificate := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	pool, err := x509.SystemCertPool()
	if err != nil {
		pool = x509.NewCertPool()
	}
	pool.AppendCertsFromPEM(certificate)
	original := http.DefaultTransport
	transport := original.(*http.Transport).Clone()
	proxy := transport.Proxy
	transport.Proxy = func(request *http.Request) (*url.URL, error) {
		if request.URL.Hostname() == host {
			return nil, nil
		}
		if proxy != nil {
			return proxy(request)
		}
		return nil, nil
	}
	transport.TLSClientConfig = &tls.Config{RootCAs: pool, MinVersion: tls.VersionTLS12}
	http.DefaultTransport = transport
	t.Cleanup(func() { http.DefaultTransport = original; transport.CloseIdleConnections() })
	g := &modelGateway{}
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if json.NewDecoder(r.Body).Decode(&body) != nil {
			w.WriteHeader(400)
			return
		}
		model, _ := body["model"].(string)
		stream, _ := body["stream"].(bool)
		api := "openai-responses"
		auth := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if r.URL.Path == "/v1/messages" || r.URL.Path == "/prefix/v1/messages" {
			api = "anthropic-messages"
			auth = r.Header.Get("x-api-key")
		} else if r.URL.Path != "/v1/responses" && r.URL.Path != "/alternate/responses" {
			w.WriteHeader(404)
			return
		}
		thinking, _ := body["thinking"].(map[string]any)
		reasoning, _ := body["reasoning"].(map[string]any)
		g.mu.Lock()
		g.requests = append(g.requests, modelGatewayRequest{api, model, auth, thinking, reasoning, stream, r.URL.Path})
		var held chan struct{}
		if stream && api == "openai-responses" && g.hold != nil {
			held = g.hold
			g.hold = nil
			close(g.started)
		}
		g.mu.Unlock()
		if held != nil {
			select {
			case <-held:
			case <-r.Context().Done():
				return
			}
		}
		text := "gateway:" + api + ":" + model
		if !stream {
			w.Header().Set("Content-Type", "application/json")
			if api == "anthropic-messages" {
				_ = json.NewEncoder(w).Encode(map[string]any{"type": "message", "role": "assistant", "content": []any{map[string]any{"type": "text", "text": text}}})
			} else {
				_ = json.NewEncoder(w).Encode(map[string]any{"status": "completed", "output": []any{map[string]any{"type": "message", "role": "assistant", "content": []any{map[string]any{"type": "output_text", "text": text}}}}})
			}
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		emit := func(kind string, value any) {
			raw, _ := json.Marshal(value)
			_, _ = fmt.Fprintf(w, "event: %s\ndata: %s\n\n", kind, raw)
		}
		if api == "anthropic-messages" {
			emit("message_start", map[string]any{"type": "message_start", "message": map[string]any{"id": "synthetic-message", "type": "message", "role": "assistant", "model": model, "content": []any{}, "stop_reason": nil, "usage": map[string]any{"input_tokens": 1, "output_tokens": 0}}})
			emit("content_block_start", map[string]any{"type": "content_block_start", "index": 0, "content_block": map[string]any{"type": "text", "text": ""}})
			emit("content_block_delta", map[string]any{"type": "content_block_delta", "index": 0, "delta": map[string]any{"type": "text_delta", "text": text}})
			emit("content_block_stop", map[string]any{"type": "content_block_stop", "index": 0})
			emit("message_delta", map[string]any{"type": "message_delta", "delta": map[string]any{"stop_reason": "end_turn", "stop_sequence": nil}, "usage": map[string]any{"output_tokens": 1}})
			emit("message_stop", map[string]any{"type": "message_stop"})
		} else {
			item := map[string]any{"id": "synthetic-item", "type": "message", "role": "assistant", "status": "completed", "content": []any{map[string]any{"type": "output_text", "text": text, "annotations": []any{}}}}
			emit("response.created", map[string]any{"type": "response.created", "response": map[string]any{"id": "synthetic-response", "status": "in_progress", "model": model, "output": []any{}}})
			emit("response.output_item.added", map[string]any{"type": "response.output_item.added", "output_index": 0, "item": map[string]any{"id": "synthetic-item", "type": "message", "role": "assistant", "status": "in_progress", "content": []any{}}})
			emit("response.content_part.added", map[string]any{"type": "response.content_part.added", "output_index": 0, "content_index": 0, "part": map[string]any{"type": "output_text", "text": "", "annotations": []any{}}})
			emit("response.output_text.delta", map[string]any{"type": "response.output_text.delta", "output_index": 0, "content_index": 0, "delta": text})
			emit("response.output_item.done", map[string]any{"type": "response.output_item.done", "output_index": 0, "item": item})
			emit("response.completed", map[string]any{"type": "response.completed", "response": map[string]any{"id": "synthetic-response", "status": "completed", "model": model, "output": []any{item}, "usage": map[string]any{"input_tokens": 1, "output_tokens": 1, "total_tokens": 2, "input_tokens_details": map[string]any{"cached_tokens": 0}, "output_tokens_details": map[string]any{"reasoning_tokens": 0}}}})
		}
	}))
	server.Listener.Close()
	server.Listener, err = net.Listen("tcp", "0.0.0.0:0")
	if err != nil {
		t.Fatal(err)
	}
	server.TLS = &tls.Config{Certificates: []tls.Certificate{{Certificate: [][]byte{der}, PrivateKey: key}}, MinVersion: tls.VersionTLS12}
	server.StartTLS()
	t.Cleanup(server.Close)
	g.URL = "https://" + net.JoinHostPort(host, fmt.Sprint(server.Listener.Addr().(*net.TCPAddr).Port))
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "provider.crt"), certificate, 0600); err != nil {
		t.Fatal(err)
	}
	private, _ := x509.MarshalPKCS8PrivateKey(key)
	if err := os.WriteFile(filepath.Join(root, "provider.key"), pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: private}), 0600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PIWORK_TEST_MODEL_CERT", filepath.Join(root, "provider.crt"))
	t.Setenv("PIWORK_TEST_MODEL_KEY", filepath.Join(root, "provider.key"))
	base := os.Getenv("PIWORK_TEST_NATIVE_AGENT_IMAGE")
	if base == "" || strings.ContainsAny(base, "\r\n") {
		t.Fatal("built acceptance image required")
	}
	dockerfile := "FROM " + base + "\nCOPY --chmod=0644 provider.crt /etc/piwork-model-fixture-ca.crt\nENV NODE_EXTRA_CA_CERTS=/etc/piwork-model-fixture-ca.crt\n"
	if err := os.WriteFile(filepath.Join(root, "Dockerfile"), []byte(dockerfile), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".dockerignore"), []byte("*\n!Dockerfile\n!provider.crt\n"), 0600); err != nil {
		t.Fatal(err)
	}
	image := "piwork-agentd:models-lifecycle-tls-" + uuid.NewString()
	if output, err := exec.CommandContext(ctx, docker, "build", "--quiet", "-t", image, root).CombinedOutput(); err != nil {
		t.Fatal("trusted fixture image build failed", string(output))
	}
	t.Cleanup(func() {
		cleanup, cancel := context.WithTimeout(context.Background(), time.Minute)
		defer cancel()
		_ = exec.CommandContext(cleanup, docker, "image", "rm", image).Run()
	})
	return g, image
}

func modelNativeCall(t *testing.T, base, auth, path, method string, body any, want int) map[string]any {
	t.Helper()
	code, result := packageHTTPCall(t, base, path, method, auth, body)
	if code != want {
		t.Fatalf("%s %s returned %d: %v", method, path, code, result)
	}
	return result
}
func modelNativeRun(t *testing.T, ctx context.Context, base, auth, work, session, key string) map[string]any {
	t.Helper()
	path := "/api/v1/works/" + work
	accepted := modelNativeCall(t, base, auth, path+"/runs", "POST", map[string]any{"sessionId": session, "submissionKey": key, "prompt": "Reply with the selected model.", "inputMode": "text"}, 202)
	run := accepted["run"].(map[string]any)["runId"].(string)
	for {
		result := modelNativeCall(t, base, auth, path+"/runs/"+run, "GET", nil, 200)
		state := int(result["state"].(float64))
		if state == 4 {
			return result
		}
		if state >= 5 || ctx.Err() != nil {
			t.Fatal("model Run failed", result)
		}
		time.Sleep(30 * time.Millisecond)
	}
}
func modelNativeExport(t *testing.T, ctx context.Context, a *Application, base, auth, work, key string) (string, workpackage.Verified) {
	t.Helper()
	accepted := modelNativeCall(t, base, auth, "/api/v1/works/"+work+"/exports", "POST", map[string]string{"idempotencyKey": key}, 202)
	waitWorkOperation(t, ctx, a, accepted["operationId"].(string))
	request, err := http.NewRequestWithContext(ctx, "GET", base+"/api/v1/work-snapshots/"+accepted["snapshotId"].(string)+"/content", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", auth)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		t.Fatal("snapshot download failed", response.StatusCode)
	}
	path := filepath.Join(t.TempDir(), "models.work")
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	size, err := io.Copy(file, response.Body)
	if err != nil {
		t.Fatal(err)
	}
	verified, err := workpackage.Read(ctx, io.NewSectionReader(file, 0, size), workpackage.ReadOptions{})
	file.Close()
	if err != nil {
		t.Fatal("model package failed static validation", err)
	}
	return path, verified
}

func TestNativeModelURLNormalizationAndErrorRecovery(t *testing.T) {
	g, image := nativeModelGateway(t)
	t.Setenv("PIWORK_TEST_NATIVE_AGENT_IMAGE", image)
	a, base, auth, work, _ := nativeApplyFixture(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	path := "/api/v1/works/" + work
	before := modelNativeCall(t, base, auth, path+"/configuration", "GET", nil, 200)
	p := modelNativeCall(t, base, auth, "/api/v1/admin/model-providers", "POST", map[string]any{"name": "URL Messages", "api": "anthropic-messages", "baseUrl": g.URL + "/prefix/v1/", "credential": "synthetic-url-sdk-key"}, 201)
	if p["baseUrl"] != g.URL+"/prefix" {
		t.Fatal("provider was not normalized")
	}
	m := modelNativeCall(t, base, auth, "/api/v1/admin/model-providers/"+p["id"].(string)+"/models", "POST", map[string]any{"name": "Prefixed Messages", "model": "claude-sonnet-4-5"}, 201)
	for _, suffix := range []string{"/prefix", "/prefix/v1", "/prefix/v1/"} {
		modelNativeCall(t, base, auth, "/api/v1/admin/model-providers/"+p["id"].(string), "PATCH", map[string]any{"baseUrl": g.URL + suffix}, 200)
		current := modelNativeCall(t, base, auth, "/api/v1/admin/models/"+m["id"].(string), "GET", nil, 200)
		if current["modelRef"] != m["modelRef"] {
			t.Fatal("URL representation changed execution identity")
		}
		result := modelNativeCall(t, base, auth, "/api/v1/admin/model-tests", "POST", map[string]any{"providerId": p["id"], "baseUrl": g.URL + suffix, "model": m["model"]}, 200)
		if result["success"] != true || g.last().Path != "/prefix/v1/messages" {
			t.Fatal("HTTP Test used another endpoint", result)
		}
	}
	session := modelNativeCall(t, base, auth, path+"/sessions", "POST", map[string]string{"idempotencyKey": "url-model-session"}, 201)["sessionId"].(string)
	modelNativeCall(t, base, auth, path+"/sessions/"+session+"/chat-options", "PATCH", map[string]any{"modelRef": m["modelRef"], "thinkingLevel": "high"}, 200)
	modelNativeRun(t, ctx, base, auth, work, session, "normalized-url-sdk")
	if g.last().Path != "/prefix/v1/messages" || g.last().Key != "synthetic-url-sdk-key" || g.last().Thinking["type"] != "enabled" {
		t.Fatal("actual SDK endpoint, Key or Thinking diverged")
	}
	modelNativeCall(t, base, auth, "/api/v1/admin/model-providers/"+p["id"].(string), "PATCH", map[string]any{"baseUrl": g.URL + "/unavailable/v1"}, 200)
	result := modelNativeCall(t, base, auth, "/api/v1/admin/model-tests", "POST", map[string]any{"modelId": m["id"]}, 200)
	if result["reason"] != "model-unavailable" || result["recovery"] == "" {
		t.Fatal("remote 404 was not actionable", result)
	}
	modelNativeCall(t, base, auth, "/api/v1/admin/model-providers/"+p["id"].(string), "PATCH", map[string]any{"name": "Saved despite failed Test"}, 200)
	options := modelNativeCall(t, base, auth, path+"/sessions/"+session+"/chat-options", "GET", nil, 200)
	if options["thinkingLevel"] != "high" || options["modelRef"] != m["modelRef"] || options["availability"] != "unavailable" {
		t.Fatal("failed Test or URL edit rewrote Session settings", options)
	}
	after := modelNativeCall(t, base, auth, path+"/configuration", "GET", nil, 200)
	for _, field := range []string{"desired", "active", "pendingApply"} {
		x, _ := json.Marshal(before[field])
		y, _ := json.Marshal(after[field])
		if string(x) != string(y) {
			t.Fatal("directory URL management changed Work configuration", field)
		}
	}
	_ = a
	t.Log("Equivalent Messages URLs share HTTP Test and actual SDK endpoint; remote failure does not gate save or rewrite Work/Session Thinking")
}

func TestNativeMultiProviderLifecycleThinkingAndPackageRoundTrip(t *testing.T) {
	node, _ := exec.LookPath("node")
	g, image := nativeModelGateway(t)
	t.Setenv("PIWORK_TEST_NATIVE_AGENT_IMAGE", image)
	a, base, auth, work, _ := nativeApplyFixture(t)
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Minute)
	defer cancel()
	if a.options.SnapshotHelperImage == "" || a.options.FileHelperImage == "" {
		t.Fatal("built file and snapshot helper images required")
	}
	add := func(base, auth, prefix string) (map[string]any, map[string]any, map[string]any, map[string]any) {
		r := modelNativeCall(t, base, auth, "/api/v1/admin/model-providers", "POST", map[string]any{"name": prefix + " Responses", "api": "openai-responses", "baseUrl": g.URL + "/v1", "credential": prefix + "-responses-key"}, 201)
		m := modelNativeCall(t, base, auth, "/api/v1/admin/model-providers", "POST", map[string]any{"name": prefix + " Messages", "api": "anthropic-messages", "baseUrl": g.URL, "credential": prefix + "-messages-key"}, 201)
		rm := modelNativeCall(t, base, auth, "/api/v1/admin/model-providers/"+r["id"].(string)+"/models", "POST", map[string]any{"name": "Responses model", "model": "gpt-5.1"}, 201)
		mm := modelNativeCall(t, base, auth, "/api/v1/admin/model-providers/"+m["id"].(string)+"/models", "POST", map[string]any{"name": "Messages model", "model": "claude-sonnet-4-5"}, 201)
		return r, m, rm, mm
	}
	r, m, rm, mm := add(base, auth, "source")
	unknown := modelNativeCall(t, base, auth, "/api/v1/admin/models", "POST", map[string]any{"model": "custom-package-unknown", "api": "anthropic-messages", "baseUrl": g.URL + "/v1/", "credential": "synthetic-source-unknown"}, 201)
	if os.Getenv("PIWORK_TEST_MODEL_BROWSER") == "1" {
		if node == "" {
			t.Fatal("Node browser build/test tool required")
		}
		cli, _ := filepath.Abs("../../dist/go/piwork-cli")
		console, _ := filepath.Abs("../../dist/go/piwork-console")
		screens, _ := filepath.Abs("../../dist/model-browser-evidence")
		script, _ := filepath.Abs("testdata/model-provider-browser.mjs")
		command := exec.CommandContext(ctx, node, script)
		command.Env = append(os.Environ(), "PIWORK_TEST_NATIVE_CLI="+cli, "PIWORK_TEST_NATIVE_CONSOLE="+console, "PIWORK_TEST_MODEL_CORE_URL="+base, "PIWORK_TEST_MODEL_WORK_ID="+work, "PIWORK_TEST_MODEL_GATEWAY="+g.URL, "PIWORK_TEST_MODEL_SCREENSHOT_DIR="+screens)
		output, err := command.CombinedOutput()
		if err != nil {
			t.Fatal("model browser integration failed", string(output))
		}
		t.Log(strings.TrimSpace(string(output)))
	}
	for _, model := range []map[string]any{rm, mm} {
		result := modelNativeCall(t, base, auth, "/api/v1/admin/model-tests", "POST", map[string]any{"modelId": model["id"]}, 200)
		if result["success"] != true {
			t.Fatal("HTTP Test failed", result)
		}
	}
	path := "/api/v1/works/" + work
	session := modelNativeCall(t, base, auth, path+"/sessions", "POST", map[string]string{"idempotencyKey": "provider-chat"}, 201)["sessionId"].(string)
	selectModel := func(ref any, thinking string) {
		modelNativeCall(t, base, auth, path+"/sessions/"+session+"/chat-options", "PATCH", map[string]any{"modelRef": ref, "thinkingLevel": thinking}, 200)
	}
	selectModel(rm["modelRef"], "high")
	first := modelNativeRun(t, ctx, base, auth, work, session, "responses-high")
	if first["thinkingLevel"] != "high" || g.last().Reasoning["effort"] != "high" {
		t.Fatal("Responses Thinking mismatch")
	}
	selectModel(mm["modelRef"], "high")
	modelNativeRun(t, ctx, base, auth, work, session, "messages-high")
	if g.last().Thinking["type"] != "enabled" {
		t.Fatal("Messages Thinking mismatch")
	}
	modelNativeCall(t, base, auth, "/api/v1/admin/model-providers/"+r["id"].(string), "PATCH", map[string]any{"credential": "source-rotated-key"}, 200)
	selectModel(rm["modelRef"], "off")
	modelNativeRun(t, ctx, base, auth, work, session, "rotated-off")
	if g.last().Key != "source-rotated-key" || g.last().Reasoning["effort"] != "none" {
		t.Fatal("rotation or Off did not reach SDK")
	}
	// Retain both protocol definitions as Work-owned contexts for package matching.
	for i, model := range []map[string]any{rm, unknown, mm} {
		view := modelNativeCall(t, base, auth, path+"/configuration", "GET", nil, 200)
		config := view["desired"].(map[string]any)
		config["modelRef"] = model["modelRef"]
		modelNativeCall(t, base, auth, path+"/configuration", "PUT", map[string]any{"configuration": config}, 200)
		op := modelNativeCall(t, base, auth, path+"/configuration/apply", "POST", map[string]string{"idempotencyKey": fmt.Sprint("model-apply-", i)}, 202)
		waitWorkOperation(t, ctx, a, op["operationId"].(string))
	}
	session = modelNativeCall(t, base, auth, path+"/sessions", "POST", map[string]string{"idempotencyKey": "active-provider-chat"}, 201)["sessionId"].(string)
	modelNativeCall(t, base, auth, "/api/v1/admin/model-providers/"+m["id"].(string)+"/disable", "POST", map[string]any{}, 200)
	list := modelNativeCall(t, base, auth, path+"/chat-models", "GET", nil, 200)
	if list["defaultModel"] != nil || len(list["models"].([]any)) == 0 {
		t.Fatal("default revocation hid other models")
	}
	selectModel(rm["modelRef"], "high")
	modelNativeRun(t, ctx, base, auth, work, session, "default-revoked-override")
	modelNativeCall(t, base, auth, "/api/v1/admin/model-providers/"+m["id"].(string)+"/enable", "POST", map[string]any{}, 200)
	modelNativeCall(t, base, auth, "/api/v1/admin/models/"+mm["id"].(string), "DELETE", nil, 409)
	unknownSession := modelNativeCall(t, base, auth, path+"/sessions", "POST", map[string]string{"idempotencyKey": "unknown-package-session"}, 201)["sessionId"].(string)
	modelNativeCall(t, base, auth, path+"/sessions/"+unknownSession+"/chat-options", "PATCH", map[string]any{"modelRef": unknown["modelRef"], "thinkingLevel": nil}, 200)
	ordinary := modelNativeRun(t, ctx, base, auth, work, unknownSession, "unknown-source-run")
	if ordinary["thinkingLevel"] != nil || g.last().Thinking != nil || g.last().Reasoning != nil || g.last().Key != "synthetic-source-unknown" {
		t.Fatal("ordinary unknown request diverged")
	}
	stop := modelNativeCall(t, base, auth, path+"/stop", "POST", map[string]string{"idempotencyKey": "source-stop"}, 202)
	waitWorkOperation(t, ctx, a, stop["operationId"].(string))
	packagePath, verified := modelNativeExport(t, ctx, a, base, auth, work, "provider-export")
	if len(verified.Spec.Bindings.Models) < 3 {
		t.Fatal("retained model closure missing")
	}
	encoded, _ := json.Marshal(verified.Spec)
	if strings.Contains(string(encoded), "source-rotated-key") || strings.Contains(string(encoded), "credentialRef") {
		t.Fatal("platform model material exported")
	}
	b, recipient, recipientAuth, _, _ := nativeApplyFixture(t)
	_, _, recipientModel, _ := add(recipient, recipientAuth, "recipient")
	recipientUnknown := modelNativeCall(t, recipient, recipientAuth, "/api/v1/admin/models", "POST", map[string]any{"model": "custom-package-unknown", "api": "anthropic-messages", "baseUrl": g.URL, "credential": "synthetic-recipient-unknown"}, 201)
	file, err := os.Open(packagePath)
	if err != nil {
		t.Fatal(err)
	}
	info, err := file.Stat()
	if err != nil {
		t.Fatal(err)
	}
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		t.Fatal(err)
	}
	_, _ = file.Seek(0, 0)
	request, err := http.NewRequestWithContext(ctx, "POST", recipient+"/api/v1/work-packages", file)
	if err != nil {
		t.Fatal(err)
	}
	request.ContentLength = info.Size()
	request.Header.Set("Authorization", recipientAuth)
	request.Header.Set("Content-Type", snapshotMIME)
	request.Header.Set("X-Piwork-SHA256", hex.EncodeToString(hash.Sum(nil)))
	beforeImport := g.count()
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	var uploaded map[string]any
	_ = json.NewDecoder(response.Body).Decode(&uploaded)
	response.Body.Close()
	file.Close()
	if response.StatusCode != 201 {
		t.Fatal("package upload failed", response.StatusCode, uploaded)
	}
	imported := modelNativeCall(t, recipient, recipientAuth, "/api/v1/work-imports", "POST", map[string]any{"packageId": uploaded["packageId"], "idempotencyKey": "provider-import"}, 202)
	waitWorkOperation(t, ctx, b, imported["operationId"].(string))
	target := imported["workId"].(string)
	record, err := b.Store.Work(ctx, target, false)
	if err != nil || record.DesiredState != "stopped" || g.count() != beforeImport {
		t.Fatal("import executed history or started Work", err)
	}
	targetPath := "/api/v1/works/" + target
	start := modelNativeCall(t, recipient, recipientAuth, targetPath+"/start", "POST", map[string]string{"idempotencyKey": "recipient-start"}, 202)
	waitWorkOperation(t, ctx, b, start["operationId"].(string))
	options := modelNativeCall(t, recipient, recipientAuth, targetPath+"/sessions/"+session+"/chat-options", "GET", nil, 200)
	if options["modelRef"] != recipientModel["modelRef"] || options["thinkingLevel"] != "high" {
		t.Fatal("recipient preference or Thinking not rebound", options)
	}
	modelNativeRun(t, ctx, recipient, recipientAuth, target, session, "recipient-provider-run")
	if g.last().Key != "recipient-responses-key" {
		t.Fatal("recipient used source authority")
	}
	unknownOptions := modelNativeCall(t, recipient, recipientAuth, targetPath+"/sessions/"+unknownSession+"/chat-options", "GET", nil, 200)
	if unknownOptions["modelRef"] != recipientUnknown["modelRef"] || unknownOptions["thinkingLevel"] != nil {
		t.Fatal("unknown imported preference lost", unknownOptions)
	}
	modelNativeRun(t, ctx, recipient, recipientAuth, target, unknownSession, "unknown-recipient-run")
	if g.last().Key != "synthetic-recipient-unknown" || g.last().Thinking != nil || g.last().Reasoning != nil {
		t.Fatal("unknown imported request used source authority")
	}
	stop = modelNativeCall(t, recipient, recipientAuth, targetPath+"/stop", "POST", map[string]string{"idempotencyKey": "recipient-stop"}, 202)
	waitWorkOperation(t, ctx, b, stop["operationId"].(string))
	_, roundTrip := modelNativeExport(t, ctx, b, recipient, recipientAuth, target, "provider-reexport")
	if len(roundTrip.Spec.Bindings.Models) != len(verified.Spec.Bindings.Models) {
		t.Fatal("re-export lost retained model closure")
	}
	t.Log("Two protocol HTTP Tests, real SDK Thinking/rotation, revoked-default recovery, dependency protection and cross-installation cold package round trip passed")
}

func TestNativeManagedModelEditsInflightReplayAndRestart(t *testing.T) {
	g, image := nativeModelGateway(t)
	t.Setenv("PIWORK_TEST_NATIVE_AGENT_IMAGE", image)
	a, base, auth, work, _ := nativeApplyFixture(t)
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Minute)
	defer cancel()
	p := modelNativeCall(t, base, auth, "/api/v1/admin/model-providers", "POST", map[string]any{"name": "Original gateway", "api": "openai-responses", "baseUrl": g.URL + "/v1", "credential": "synthetic-original"}, 201)
	m := modelNativeCall(t, base, auth, "/api/v1/admin/model-providers/"+p["id"].(string)+"/models", "POST", map[string]any{"name": "Original model", "model": "gpt-5.1"}, 201)
	path := "/api/v1/works/" + work
	session := modelNativeCall(t, base, auth, path+"/sessions", "POST", map[string]string{"idempotencyKey": "inflight-session"}, 201)["sessionId"].(string)
	modelNativeCall(t, base, auth, path+"/sessions/"+session+"/chat-options", "PATCH", map[string]any{"modelRef": m["modelRef"], "thinkingLevel": "high"}, 200)
	held, started := make(chan struct{}), make(chan struct{})
	var once sync.Once
	release := func() { once.Do(func() { close(held) }) }
	t.Cleanup(release)
	g.mu.Lock()
	g.hold = held
	g.started = started
	g.mu.Unlock()
	body := map[string]any{"sessionId": session, "submissionKey": "immutable-inflight", "prompt": "Reply with the selected model.", "inputMode": "text"}
	accepted := modelNativeCall(t, base, auth, path+"/runs", "POST", body, 202)
	runID := accepted["run"].(map[string]any)["runId"].(string)
	select {
	case <-started:
	case <-time.After(time.Minute):
		t.Fatal("SDK did not reach held provider request")
	}
	before := g.count()
	modelNativeCall(t, base, auth, "/api/v1/admin/model-providers/"+p["id"].(string), "PATCH", map[string]any{"name": "Edited gateway", "baseUrl": g.URL + "/alternate", "credential": "synthetic-edited"}, 200)
	m = modelNativeCall(t, base, auth, "/api/v1/admin/models/"+m["id"].(string), "PATCH", map[string]any{"name": "Edited model", "model": "renamed-alias"}, 200)
	release()
	for {
		run := modelNativeCall(t, base, auth, path+"/runs/"+runID, "GET", nil, 200)
		state := int(run["state"].(float64))
		if state == 4 {
			if run["actualModel"].(map[string]any)["model"] != "gpt-5.1" || run["thinkingLevel"] != "high" {
				t.Fatal("inflight snapshot changed")
			}
			break
		}
		if state >= 5 || ctx.Err() != nil {
			t.Fatal("held execution failed", run)
		}
		time.Sleep(30 * time.Millisecond)
	}
	replayed := modelNativeCall(t, base, auth, path+"/runs", "POST", body, 202)
	if replayed["run"].(map[string]any)["runId"] != runID || replayed["reused"] != true || g.count() != before {
		t.Fatal("accepted replay executed again")
	}
	options := modelNativeCall(t, base, auth, path+"/sessions/"+session+"/chat-options", "GET", nil, 200)
	if options["availability"] != "unavailable" || options["thinkingLevel"] != "high" {
		t.Fatal("retired preference silently rebound", options)
	}
	modelNativeCall(t, base, auth, path+"/sessions/"+session+"/chat-options", "PATCH", map[string]any{"modelRef": m["modelRef"], "thinkingLevel": "high"}, 409)
	modelNativeCall(t, base, auth, path+"/sessions/"+session+"/chat-options", "PATCH", map[string]any{"modelRef": m["modelRef"], "thinkingLevel": nil}, 200)
	ordinary := modelNativeRun(t, ctx, base, auth, work, session, "edited-configuration")
	if ordinary["thinkingLevel"] != nil || g.last().Reasoning != nil {
		t.Fatal("new unknown model did not use explicitly confirmed ordinary mode")
	}
	if g.last().Model != "renamed-alias" || g.last().Key != "synthetic-edited" {
		t.Fatal("new execution did not use edited provider")
	}
	modelNativeCall(t, base, auth, "/api/v1/admin/models/"+m["id"].(string)+"/disable", "POST", map[string]any{}, 200)
	modelNativeCall(t, base, auth, path+"/runs", "POST", map[string]any{"sessionId": session, "submissionKey": "disabled-must-not-run", "prompt": "Reply with the selected model.", "inputMode": "text"}, 409)
	modelNativeCall(t, base, auth, "/api/v1/admin/models/"+m["id"].(string)+"/enable", "POST", map[string]any{}, 200)
	stop := modelNativeCall(t, base, auth, path+"/stop", "POST", map[string]string{"idempotencyKey": "restart-stop"}, 202)
	waitWorkOperation(t, ctx, a, stop["operationId"].(string))
	data := a.options.DataDirectory
	helpers := a.options
	if err := a.Close(ctx); err != nil {
		t.Fatal(err)
	}
	a, base, _ = appFixture(t, Options{DataDirectory: data, AgentGRPCListen: "0.0.0.0:0", PackageHelperImage: image, FileHelperImage: helpers.FileHelperImage, SnapshotHelperImage: helpers.SnapshotHelperImage, DockerOptions: helpers.DockerOptions})
	before = g.count()
	start := modelNativeCall(t, base, auth, path+"/start", "POST", map[string]string{"idempotencyKey": "restart-start"}, 202)
	waitWorkOperation(t, ctx, a, start["operationId"].(string))
	if g.count() != before {
		t.Fatal("restart replayed model history")
	}
	modelNativeRun(t, ctx, base, auth, work, session, "after-core-agent-restart")
	if g.last().Model != "renamed-alias" || g.last().Key != "synthetic-edited" {
		t.Fatal("restart lost model or credential")
	}
	modelNativeCall(t, base, auth, "/api/v1/admin/models/"+m["id"].(string), "DELETE", nil, 204)
	modelNativeCall(t, base, auth, "/api/v1/admin/model-providers/"+p["id"].(string), "DELETE", nil, 204)
	history := modelNativeCall(t, base, auth, path+"/sessions/"+session, "GET", nil, 200)
	if len(history["runs"].([]any)) < 3 {
		t.Fatal("deletion erased model history")
	}
	t.Log("Actual SDK inflight model/Thinking are immutable; edited names/endpoint/ID/Key, independent enable/disable, idempotent replay, Core/Agent restart and history-preserving deletion passed")
}

func TestNativeFlatUnknownDefaultAndDuplicateModelConnections(t *testing.T) {
	g, image := nativeModelGateway(t)
	t.Setenv("PIWORK_TEST_NATIVE_AGENT_IMAGE", image)
	a, base, auth, work, _ := nativeApplyFixture(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	path := "/api/v1/works/" + work
	var models []map[string]any
	for _, api := range []string{"openai-responses", "anthropic-messages"} {
		for _, suffix := range []string{"first", "second"} {
			m := modelNativeCall(t, base, auth, "/api/v1/admin/models", "POST", map[string]any{"model": "custom-same-unknown", "api": api, "baseUrl": g.URL + "/v1/", "credential": "synthetic-" + api + "-" + suffix}, 201)
			models = append(models, m)
		}
	}
	for i, m := range models {
		config := modelNativeCall(t, base, auth, path+"/configuration", "GET", nil, 200)["desired"].(map[string]any)
		config["modelRef"] = m["modelRef"]
		modelNativeCall(t, base, auth, path+"/configuration", "PUT", map[string]any{"configuration": config}, 200)
		op := modelNativeCall(t, base, auth, path+"/configuration/apply", "POST", map[string]string{"idempotencyKey": fmt.Sprint("unknown-default-", i)}, 202)
		waitWorkOperation(t, ctx, a, op["operationId"].(string))
		created := modelNativeCall(t, base, auth, path+"/sessions", "POST", map[string]string{"idempotencyKey": fmt.Sprint("unknown-session-", i)}, 201)
		if created["thinkingLevel"] != nil {
			t.Fatal("unknown default projected as confirmed Off", created)
		}
		list := modelNativeCall(t, base, auth, path+"/chat-models", "GET", nil, 200)
		def := list["defaultModel"].(map[string]any)
		if list["contractVersion"] != float64(3) || def["thinkingAvailability"] != "unknown" || len(def["thinkingLevels"].([]any)) != 0 {
			t.Fatal("unknown default hidden", list)
		}
		run := modelNativeRun(t, ctx, base, auth, work, created["sessionId"].(string), fmt.Sprint("unknown-default-run-", i))
		suffix := "first"
		if i%2 == 1 {
			suffix = "second"
		}
		got := g.last()
		if got.Model != "custom-same-unknown" || got.API != m["api"] || got.Key != "synthetic-"+m["api"].(string)+"-"+suffix || got.Thinking != nil || got.Reasoning != nil || run["thinkingLevel"] != nil {
			t.Fatal("ordinary execution mixed connection or Thinking")
		}
	}
	t.Log("Four flat model configs, duplicate unknown IDs and new default Sessions execute both SDK protocols with independent credentials and nullable ordinary facts")
}
