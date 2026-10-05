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

	"piwork/internal/client"
	"piwork/internal/clientfs"
)

func TestSnapshotDownloadRejectsDigestSizeAndConcurrentTarget(t *testing.T) {
	source, err := os.ReadFile(filepath.Join("..", "workpackage", "testdata", "golden-native-pi-package.work"))
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(source)
	digest := hex.EncodeToString(sum[:])
	for _, scenario := range []string{"digest", "size", "target"} {
		t.Run(scenario, func(t *testing.T) {
			directory := t.TempDir()
			output := filepath.Join(directory, "snapshot.work")
			core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				payload := bytes.Clone(source)
				size := len(source)
				if scenario == "digest" {
					payload[len(payload)-1] ^= 1
				}
				if scenario == "size" {
					size++
				}
				if scenario == "target" {
					if err := os.WriteFile(output, []byte("concurrent winner"), 0600); err != nil {
						t.Error(err)
					}
				}
				w.Header().Set("Content-Type", workPackageMIME)
				w.Header().Set("X-Piwork-Sha256", digest)
				w.Header().Set("Content-Length", strconv.Itoa(size))
				_, _ = w.Write(payload)
			}))
			defer core.Close()
			api, _ := client.New(core.URL, "fixture")
			if _, err := saveSnapshotDownload(context.Background(), api, "snapshot-original", output, digest, int64(len(source))); err == nil {
				t.Fatal("unsafe download published")
			}
			entries, err := os.ReadDir(directory)
			if err != nil {
				t.Fatal(err)
			}
			if scenario == "target" {
				raw, err := os.ReadFile(output)
				if err != nil || string(raw) != "concurrent winner" || len(entries) != 1 {
					t.Fatal("concurrent target was replaced", err, entries)
				}
			} else if len(entries) != 0 {
				t.Fatal("failed download left partial files", entries)
			}
		})
	}
}

func TestSnapshotImportRejectsInputReplacementAfterUpload(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "workpackage", "testdata", "golden-native-pi-package.work"))
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(raw)
	digest := hex.EncodeToString(sum[:])
	directory := t.TempDir()
	input := filepath.Join(directory, "input.work")
	if err := os.WriteFile(input, raw, 0600); err != nil {
		t.Fatal(err)
	}
	uploads, imports := 0, 0
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/work-packages" {
			uploads++
			received, err := io.ReadAll(r.Body)
			if err != nil || !bytes.Equal(received, raw) {
				t.Error("unexpected upload", err)
			}
			replacement := filepath.Join(directory, "replacement")
			if err := os.WriteFile(replacement, raw, 0600); err != nil {
				t.Error(err)
			}
			parent, openErr := clientfs.OpenDirectory(directory)
			if openErr != nil {
				t.Error(openErr)
				w.WriteHeader(500)
				return
			}
			defer parent.Close()
			if err := parent.PublishReplace(context.Background(), "replacement", "input.work"); err != nil {
				t.Error("native replacement fixture failed", err)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"packageId": "uploaded-original", "digest": digest, "size": len(raw)})
			return
		}
		if r.URL.Path == "/api/v1/work-imports" {
			imports++
		}
		w.WriteHeader(500)
	}))
	defer core.Close()
	api, _ := client.New(core.URL, "fixture")
	if _, err := importUserSnapshot(context.Background(), api, snapshotCommand{kind: "import", id: input}, io.Discard); err == nil {
		t.Fatal("replaced input submitted import")
	}
	if uploads != 1 || imports != 0 {
		t.Fatal("input replacement changed import boundary", uploads, imports)
	}
}
