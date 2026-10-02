package cli

import (
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
	"strconv"
	"testing"
	"time"

	"piwork/internal/client"
)

func TestExportObservationTimeoutRetainsSnapshotWithoutResubmitting(t *testing.T) {
	mutations := 0
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "POST" && r.URL.Path == "/api/v1/works/work-1/exports" {
			mutations++
			w.WriteHeader(202)
			io.WriteString(w, `{"workId":"work-1","snapshotId":"snapshot-original","operationId":"operation-original","correlationId":"correlation-original"}`)
			return
		}
		if r.URL.Path == "/api/v1/operations/operation-original" {
			<-r.Context().Done()
			return
		}
		t.Error("export timeout issued a download or second mutation", r.Method, r.URL.Path)
		w.WriteHeader(500)
	}))
	defer core.Close()
	api, _ := client.New(core.URL, "token")
	output := filepath.Join(t.TempDir(), "export.work")
	value, err := runUserSnapshotWithin(context.Background(), api, []string{"export", "work-1", "--output", output}, io.Discard, 40*time.Millisecond)
	envelope, ok := value.(map[string]any)
	apiErr, isAPIError := err.(*client.APIError)
	if !ok || !isAPIError || apiErr.Code != "OPERATION_WAIT_TIMEOUT" || mutations != 1 || envelope["state"] != "waiting" ||
		envelope["snapshotId"] != "snapshot-original" || envelope["operationId"] != "operation-original" || envelope["correlationId"] != "correlation-original" {
		t.Fatal(value, err, mutations)
	}
	if _, err := os.Stat(output); !os.IsNotExist(err) {
		t.Fatal("timeout published a partial package", err)
	}
}

func TestSnapshotDownloadVerifiesAndPublishesAtomically(t *testing.T) {
	source, err := os.ReadFile(filepath.Join("..", "workpackage", "testdata", "golden-native-pi-package.work"))
	if err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256(source)
	digest := hex.EncodeToString(hash[:])
	requests := 0
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/work-snapshots/snapshot-1":
			json.NewEncoder(w).Encode(map[string]any{"workId": "work-1", "snapshotId": "snapshot-1", "operationId": "operation-1", "state": "succeeded", "digest": digest, "size": len(source)})
		case "/api/v1/work-snapshots/snapshot-1/content":
			requests++
			if r.Header.Get("Range") != "" {
				t.Error("CLI sent Range")
			}
			w.Header().Set("Content-Type", workPackageMIME)
			w.Header().Set("X-Piwork-Sha256", digest)
			w.Header().Set("Content-Length", strconv.Itoa(len(source)))
			w.Write(source)
		default:
			http.NotFound(w, r)
		}
	}))
	defer core.Close()
	credential := filepath.Join(t.TempDir(), "credentials", "client.json")
	t.Setenv("PIWORK_CONFIG_PATH", credential)
	if err := (client.CredentialStore{Path: credential}).Save(client.Credential{Version: 1, CoreURL: core.URL + "/", Token: "token",
		ExpiresAt: "2099-01-01T00:00:00Z", User: client.Identity{ID: "user-1", Account: "owner", Role: "user"}}); err != nil {
		t.Fatal(err)
	}
	output := filepath.Join(t.TempDir(), "download.work")
	var out, diagnostic bytes.Buffer
	if code := runUser([]string{"work", "snapshot", "download", "snapshot-1", "--output", output}, &out, &diagnostic); code != 0 {
		t.Fatal(code, diagnostic.String())
	}
	got, err := os.ReadFile(output)
	if err != nil || !bytes.Equal(got, source) || requests != 1 {
		t.Fatal("download contents or identity changed", err, requests)
	}
	if code := runUser([]string{"work", "snapshot", "download", "snapshot-1", "--output", output}, &out, &diagnostic); code == 0 || requests != 1 {
		t.Fatal("existing destination overwritten", code, requests)
	}
}

func TestSnapshotInterruptedDownloadRetriesOriginalIDWithoutPublishingPartial(t *testing.T) {
	source, err := os.ReadFile(filepath.Join("..", "workpackage", "testdata", "golden-native-pi-package.work"))
	if err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256(source)
	digest := hex.EncodeToString(hash[:])
	requests := 0
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/work-snapshots/snapshot-original":
			_ = json.NewEncoder(w).Encode(map[string]any{"workId": "work-1", "snapshotId": "snapshot-original",
				"operationId": "operation-original", "state": "succeeded", "digest": digest, "size": len(source)})
		case "/api/v1/work-snapshots/snapshot-original/content":
			requests++
			if r.Header.Get("Range") != "" {
				t.Error("snapshot retry used Range")
			}
			w.Header().Set("Content-Type", workPackageMIME)
			w.Header().Set("X-Piwork-Sha256", digest)
			w.Header().Set("Content-Length", strconv.Itoa(len(source)))
			if requests == 1 {
				_, _ = w.Write(source[:len(source)/2])
				return
			}
			_, _ = w.Write(source)
		default:
			http.NotFound(w, r)
		}
	}))
	defer core.Close()
	credential := filepath.Join(t.TempDir(), "credentials", "client.json")
	t.Setenv("PIWORK_CONFIG_PATH", credential)
	if err := (client.CredentialStore{Path: credential}).Save(client.Credential{Version: 1, CoreURL: core.URL + "/", Token: "token",
		ExpiresAt: "2099-01-01T00:00:00Z", User: client.Identity{ID: "user-1", Account: "owner", Role: "user"}}); err != nil {
		t.Fatal(err)
	}
	directory := t.TempDir()
	output := filepath.Join(directory, "retry.work")
	var stdout, diagnostic bytes.Buffer
	args := []string{"work", "snapshot", "download", "snapshot-original", "--output", output}
	if code := runUser(args, &stdout, &diagnostic); code == 0 {
		t.Fatal("truncated snapshot was published", stdout.String())
	}
	if _, err := os.Stat(output); !os.IsNotExist(err) {
		t.Fatal("partial output exists", err)
	}
	stdout.Reset()
	diagnostic.Reset()
	if code := runUser(args, &stdout, &diagnostic); code != 0 {
		t.Fatal("retry of original snapshot ID failed", code, diagnostic.String())
	}
	got, err := os.ReadFile(output)
	if err != nil || !bytes.Equal(got, source) || requests != 2 {
		t.Fatal("original snapshot retry changed content or identity", err, requests)
	}
}

func TestOfflineInspectPrecedesUploadAndImport(t *testing.T) {
	source := filepath.Join("..", "workpackage", "testdata", "golden-native-pi-package.work")
	raw, err := os.ReadFile(source)
	if err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256(raw)
	digest := hex.EncodeToString(hash[:])
	uploads, imports := 0, 0
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/work-packages":
			uploads++
			if r.Header.Get("X-Piwork-Sha256") != digest || r.Header.Get("Content-Type") != workPackageMIME {
				t.Error("upload identity missing")
			}
			body, _ := io.ReadAll(r.Body)
			if !bytes.Equal(body, raw) {
				t.Error("uploaded package differs")
			}
			json.NewEncoder(w).Encode(map[string]any{"packageId": "package-1", "digest": digest, "size": len(raw)})
		case "/api/v1/work-imports":
			imports++
			var input map[string]string
			if json.NewDecoder(r.Body).Decode(&input) != nil || input["packageId"] != "package-1" || input["name"] != "Restored" || input["idempotencyKey"] != "stable-import" {
				t.Error("wrong import request", input)
			}
			w.WriteHeader(202)
			json.NewEncoder(w).Encode(map[string]string{"workId": "work-new", "operationId": "operation-1", "name": "Restored"})
		default:
			http.NotFound(w, r)
		}
	}))
	defer core.Close()
	credential := filepath.Join(t.TempDir(), "credentials", "client.json")
	t.Setenv("PIWORK_CONFIG_PATH", credential)
	if err := (client.CredentialStore{Path: credential}).Save(client.Credential{Version: 1, CoreURL: core.URL + "/", Token: "token",
		ExpiresAt: "2099-01-01T00:00:00Z", User: client.Identity{ID: "user-1", Account: "owner", Role: "user"}}); err != nil {
		t.Fatal(err)
	}
	var out, diagnostic bytes.Buffer
	if code := runUser([]string{"work", "import", source, "--name", "Restored", "--idempotency-key", "stable-import"}, &out, &diagnostic); code != 0 {
		t.Fatal(code, diagnostic.String())
	}
	if uploads != 1 || imports != 1 {
		t.Fatal("import sequence wrong", uploads, imports)
	}
	out.Reset()
	diagnostic.Reset()
	legacy := filepath.Join("..", "workpackage", "testdata", "golden.work")
	if code := runUser([]string{"work", "import", legacy}, &out, &diagnostic); code == 0 || uploads != 1 || imports != 1 {
		t.Fatal("invalid package reached Core", code, uploads, imports)
	}
}
