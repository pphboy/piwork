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
	if err != nil || version != "1.2.0" {
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
		if strings.Contains(file.Name, "/frontend/") || strings.Contains(string(content), "use FastAPI + React + TypeScript + Vite") {
			t.Fatal("retired standalone frontend in delivered brain:", file.Name)
		}
	}
	for name, expected := range map[string]string{
		"package.json":                          `"version": "1.2.0"`,
		"skills/deploy-work-service/SKILL.md":   "Python + NiceGUI + SQLite",
		"references/web-base.json":              `"environmentContract": 2`,
		"templates/web-app/app.py":              "from nicegui import app",
		"templates/web-app/ui.py":               "from nicegui import ui",
		"templates/web-app/page-files.json":     `"files": []`,
		"templates/workstation/page-files.json": `"files": []`,
	} {
		if !strings.Contains(files[name], expected) {
			t.Fatalf("%s omitted %q", name, expected)
		}
	}
}
