package coreoperator

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"piwork/internal/contracts"
)

const packageOperationID = "11111111-1111-4111-8111-111111111111"
const packageUploadID = "upload-22222222-2222-4222-8222-222222222222"

func packageAcceptance() contracts.PiPackageOperationAcceptance {
	return contracts.PiPackageOperationAcceptance{OperationId: packageOperationID, WorkId: json.RawMessage(`null`), CorrelationId: packageOperationID, Scope: "core", Kind: "pi-package-install", Name: json.RawMessage(`null`)}
}

func TestPackageSyntaxAndSourceSelectionPrecedeAllIO(t *testing.T) {
	for _, args := range [][]string{
		{"packages", "update", "tools"},
		{"packages", "update", "tools", "--source", "npm:tools", "--source", "./other"},
		{"packages", "install", "npm:tools", "--verbose"},
		{"packages", "install", "npm:tools", "--wait", "--wait"},
		{"packages", "install", "npm:tools", "./other"},
		{"packages", "install", "ssh:private"},
		{"packages", "enable", "tools", "--wait"},
		{"skills", "add", "--path", "./relative"},
		{"skills", "show", "../unsafe"},
		{"work", "packages", "list", "work-fixture"},
	} {
		args = append(args, "--operator-credential-file", "/nonexistent/credential", "--env-file", "/nonexistent/config")
		code, out, err := call(t, args, forbiddenReader{}, "http://127.0.0.1:1")
		if code != 2 || out != "" || err == "" {
			t.Fatal(args, code, out, err)
		}
	}
	for _, args := range [][]string{{"packages", "install", "--help"}, {"packages", "update", "tools", "--help"}, {"skills", "--help"}, {"operation", "--help"}} {
		args = append(args, "--operator-credential-file", "/nonexistent/credential")
		code, out, err := call(t, args, forbiddenReader{}, "invalid")
		if code != 0 || out == "" || err != "" {
			t.Fatal(args, code, out, err)
		}
	}
}

func TestOperatorPackageFourSourcesUploadOnceAndReturnSingleJSON(t *testing.T) {
	directory := t.TempDir()
	if err := os.Chmod(directory, 0700); err != nil {
		t.Fatal(err)
	}
	local := filepath.Join(directory, "tools")
	if err := os.Mkdir(local, 0700); err != nil {
		t.Fatal(err)
	}
	manifest := `{"name":"tools","version":"1.0.0","scripts":{"postinstall":"touch should-never-exist"}}`
	if err := os.WriteFile(filepath.Join(local, "package.json"), []byte(manifest), 0644); err != nil {
		t.Fatal(err)
	}
	zipPath := filepath.Join(directory, "tools.zip")
	var zipped bytes.Buffer
	writer := zip.NewWriter(&zipped)
	file, err := writer.Create("package.json")
	if err != nil {
		t.Fatal(err)
	}
	io.WriteString(file, manifest)
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(zipPath, zipped.Bytes(), 0600); err != nil {
		t.Fatal(err)
	}
	credential := filepath.Join(directory, "operator.credential")
	if err := os.WriteFile(credential, []byte(strings.Repeat("a", 48)), 0600); err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct{ source, kind string }{{"npm:tools@1.0.0", "npm"}, {"git:github.com/example/tools@v1", "git"}, {local, "local"}, {zipPath, "zip"}} {
		t.Run(test.kind, func(t *testing.T) {
			uploads, installs := 0, 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Authorization") != "Operator "+strings.Repeat("a", 48) {
					t.Error("wrong credential")
					w.WriteHeader(401)
					return
				}
				switch r.URL.Path {
				case "/control/package-uploads":
					uploads++
					body, _ := io.ReadAll(r.Body)
					hash := sha256.Sum256(body)
					if r.ContentLength != int64(len(body)) || r.Header.Get("X-Piwork-Sha256") != hex.EncodeToString(hash[:]) || r.Header.Get("X-Piwork-Package-Source") != test.kind || r.Header.Get("Content-Type") != "application/zip" {
						t.Error("bad streaming upload contract")
					}
					json.NewEncoder(w).Encode(map[string]any{"uploadId": packageUploadID, "expiresAt": "2026-10-01T10:00:00Z"})
				case "/control/packages":
					installs++
					var body map[string]any
					json.NewDecoder(r.Body).Decode(&body)
					if err := contracts.Validate("PiPackageInstallRequestSchema", body); err != nil {
						t.Error("request does not match shared source union", err)
					}
					source := body["source"].(map[string]any)
					expectedKind := test.kind
					if test.kind == "local" || test.kind == "zip" {
						expectedKind = "upload"
					}
					if source["kind"] != expectedKind || body["idempotencyKey"] == "" || body["addToDefaults"] != true {
						t.Error("wrong source or key")
					}
					if test.kind == "local" || test.kind == "zip" {
						if source["uploadId"] != packageUploadID || source["path"] != nil {
							t.Error("local path sent to Core")
						}
					} else if source["spec"] == nil {
						t.Error("missing source spec")
					}
					w.WriteHeader(202)
					json.NewEncoder(w).Encode(packageAcceptance())
				default:
					t.Errorf("unexpected request %s", r.URL.Path)
					w.WriteHeader(404)
				}
			}))
			defer server.Close()
			code, out, stderr := call(t, []string{"--core", server.URL, "--operator-credential-file", credential, "--json", "packages", "install", test.source, "--default"}, forbiddenReader{}, "invalid")
			if code != 0 || stderr != "" || singleJSON(t, out)["operationId"] != packageOperationID {
				t.Fatal(code, out, stderr)
			}
			expectedUploads := 0
			if test.kind == "local" || test.kind == "zip" {
				expectedUploads = 1
			}
			if uploads != expectedUploads || installs != 1 {
				t.Fatal("repeated mutation", uploads, installs)
			}
			if strings.Contains(out+stderr, directory) {
				t.Fatal("source path leaked")
			}
		})
	}
	if _, err := os.Stat(filepath.Join(local, "should-never-exist")); !os.IsNotExist(err) {
		t.Fatal("source script executed")
	}
}

func TestPackageWaitSurvivesLongPrepareRetriesAndInterruptedObservation(t *testing.T) {
	for _, scenario := range []string{"long", "failed", "interrupt", "unauthorized", "missing"} {
		t.Run(scenario, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != "GET" || r.URL.Path != "/control/operations/"+packageOperationID {
					t.Error("waiting mutated or queried another operation")
					w.WriteHeader(400)
					return
				}
				calls++
				if scenario == "unauthorized" {
					w.WriteHeader(403)
					io.WriteString(w, `{"code":"PERMISSION_DENIED"}`)
					return
				}
				if scenario == "missing" {
					w.WriteHeader(404)
					io.WriteString(w, `{"code":"NOT_FOUND"}`)
					return
				}
				if scenario == "long" && calls >= 5 && calls <= 12 {
					w.WriteHeader(503)
					io.WriteString(w, `{"code":"RUNTIME_UNAVAILABLE"}`)
					return
				}
				state, phase := "running", "prepare"
				if scenario == "long" && calls > 620 {
					state, phase = "succeeded", "succeeded"
				} else if scenario == "failed" {
					state, phase = "failed", "failed"
				}
				view := map[string]any{"operationId": packageOperationID, "workId": nil, "kind": "pi-package-install", "state": state, "packagePhase": phase, "name": "tools", "result": nil, "error": nil, "createdAt": "2026-10-01T00:00:00Z", "updatedAt": "2026-10-01T00:00:00Z"}
				if state == "failed" {
					view["error"] = map[string]any{"stage": "prepare", "code": "PI_PACKAGE_DEPENDENCY_INSTALL_FAILED", "message": "secret /private/path"}
				}
				json.NewEncoder(w).Encode(view)
			}))
			defer server.Close()
			connection, err := connect(server.URL)
			if err != nil {
				t.Fatal(err)
			}
			defer connection.close()
			virtual := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
			started := virtual
			delays := []time.Duration{}
			clock := packageWaitClock{now: func() time.Time { return virtual }, pause: func(ctx context.Context, delay time.Duration) error {
				delays = append(delays, delay)
				virtual = virtual.Add(delay)
				if scenario == "interrupt" {
					cancel()
					return ctx.Err()
				}
				return nil
			}}
			var stdout, stderr bytes.Buffer
			code := waitPackageOperation(ctx, connection, packageAcceptance(), true, true, &stdout, &stderr, clock)
			view := singleJSON(t, stdout.String())
			switch scenario {
			case "long":
				if code != 0 || view["state"] != "succeeded" || virtual.Sub(started) <= 120*time.Second {
					t.Fatal(code, view, virtual.Sub(started))
				}
				if !strings.Contains(stderr.String(), "observation retry") || !strings.Contains(stderr.String(), "observation recovered") || !strings.Contains(stderr.String(), "still prepare") {
					t.Fatal("missing progress", stderr.String())
				}
				maximum := time.Duration(0)
				for _, delay := range delays {
					maximum = max(maximum, delay)
				}
				if maximum != 5*time.Second {
					t.Fatal("retry is not bounded", maximum)
				}
			case "failed":
				if code != 6 || view["state"] != "failed" || !strings.Contains(stderr.String(), "terminal stage=prepare code=PI_PACKAGE_DEPENDENCY_INSTALL_FAILED") ||
					strings.Contains(stdout.String()+stderr.String(), "secret /private/path") {
					t.Fatal(code, view, stderr.String())
				}
			case "interrupt":
				if code != 130 || view["state"] != "waiting" {
					t.Fatal(code, view)
				}
			default:
				if code != 5 || calls != 1 || view["state"] != "waiting" {
					t.Fatal(code, calls, view)
				}
			}
			if code != 0 && !strings.Contains(stderr.String(), "operation show "+packageOperationID) {
				t.Fatal("missing durable recovery command", stderr.String())
			}
		})
	}
}
