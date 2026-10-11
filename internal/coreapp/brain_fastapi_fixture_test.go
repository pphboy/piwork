package coreapp

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"os"
	"testing"

	"piwork/internal/packageprepare"
)

// The complete 1.1.0 package is a migration input, never a current delivery.
func fastAPIBrainPreparer(t *testing.T) func(context.Context) (packageprepare.Result, error) {
	t.Helper()
	return unitBrainArchivePreparer(t, func() ([]byte, error) {
		return os.ReadFile("testdata/piwork-brain-fastapi-1.1.0.zip")
	})
}

func TestFastAPIBrainMigrationFixtureIsCompleteAndPrepared(t *testing.T) {
	raw, err := os.ReadFile("testdata/piwork-brain-fastapi-1.1.0.zip")
	if err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256(raw)
	archive, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		t.Fatal(err)
	}
	files := map[string][]byte{}
	for _, file := range archive.File {
		reader, err := file.Open()
		if err != nil {
			t.Fatal(err)
		}
		files[file.Name], err = io.ReadAll(reader)
		reader.Close()
		if err != nil {
			t.Fatal(err)
		}
	}
	var manifest struct{ Name, Version string }
	if err := json.Unmarshal(files["package.json"], &manifest); err != nil || manifest.Name != "piwork-brain" || manifest.Version != "1.1.0" {
		t.Fatal("invalid migration package", manifest, err)
	}
	for _, name := range []string{"brain.md", "extensions/brain.js", "skills/deploy-work-service/initialize.mjs", "skills/deploy-work-service/SKILL.md", "references/web-base.json", "templates/web-app/SPEC.md", "templates/workstation/backend/main.py", "templates/workstation/frontend/src/App.tsx", "templates/workstation/frontend/package-lock.json", "templates/workstation/workstation.py", "templates/workstation/piwork_protocol.py"} {
		if len(files[name]) == 0 {
			t.Fatal("incomplete migration fixture", name)
		}
	}
	if !bytes.Contains(files["skills/deploy-work-service/SKILL.md"], []byte("FastAPI + React + TypeScript + Vite")) {
		t.Fatal("fixture does not preserve the actual old guidance")
	}
	prepared, err := fastAPIBrainPreparer(t)(context.Background())
	if err != nil || prepared.ZipBytes == 0 || prepared.Artifact.Metadata.Name != "piwork-brain" {
		t.Fatal("migration fixture did not pass real artifact validation", err)
	}
	t.Logf("complete old package prepared: sourceSHA256=%s bytes=%d", hex.EncodeToString(hash[:]), len(raw))
}
