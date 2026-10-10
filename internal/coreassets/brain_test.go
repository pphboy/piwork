package coreassets

import (
	"archive/zip"
	"bytes"
	"io"
	"strings"
	"testing"
)

func TestBrainArchiveDeliversCurrentWebStack(t *testing.T) {
	version, err := BrainPackageVersion()
	if err != nil || version != "1.1.0" {
		t.Fatal(version, err)
	}
	raw, err := BrainPackageArchive()
	if err != nil {
		t.Fatal(err)
	}
	archive, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		t.Fatal(err)
	}
	files := map[string]string{}
	for _, file := range archive.File {
		reader, err := file.Open()
		if err != nil {
			t.Fatal(err)
		}
		content, err := io.ReadAll(reader)
		reader.Close()
		if err != nil {
			t.Fatal(err)
		}
		files[file.Name] = string(content)
		if strings.Contains(strings.ToLower(file.Name+string(content)), "nicegui") {
			t.Fatal("retired stack in delivered brain:", file.Name)
		}
	}
	for name, expected := range map[string]string{
		"package.json":                            `"version": "1.1.0"`,
		"skills/deploy-work-service/SKILL.md":     "FastAPI + React + TypeScript + Vite",
		"references/web-base.json":                "@sha256:",
		"templates/web-app/backend/main.py":       "FastAPI",
		"templates/web-app/frontend/package.json": `"vite"`,
	} {
		if !strings.Contains(files[name], expected) {
			t.Fatalf("%s omitted %q", name, expected)
		}
	}
}
