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
	if err != nil || version != "1.2.2" {
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
		"package.json":                                       `"version": "1.2.2"`,
		"skills/application-awareness/SKILL.md":              "name: application-awareness",
		"skills/application-awareness/references/nicegui.md": "Desktop Service",
		"skills/deploy-work-service/SKILL.md":                "Python + NiceGUI + SQLite",
		"references/web-base.json":                           `"environmentContract": 2`,
		"templates/web-app/app.py":                           "from nicegui import app",
		"templates/web-app/ui.py":                            "from nicegui import ui",
		"templates/web-app/page-files.json":                  `"files": []`,
		"templates/workstation/page-files.json":              `"files": []`,
	} {
		if !strings.Contains(files[name], expected) {
			t.Fatalf("%s omitted %q", name, expected)
		}
	}
	awareness := files["skills/application-awareness/SKILL.md"]
	for _, required := range []string{"1. Product", "2. UI", "3. UX", "4. Reactivity", "5. Engineering Judgment", "功能可用、操作直观、状态正确、界面整洁", "普通 Query/Action", "不增加独立设计阶段"} {
		if !strings.Contains(awareness, required) {
			t.Fatalf("delivered application awareness omitted %q", required)
		}
	}
	brain := files["brain.md"]
	if !strings.Contains(brain, "[application-awareness](skills/application-awareness/SKILL.md) directly") ||
		!strings.Contains(brain, "service start/stop and unchanged third-party deployments") {
		t.Fatal("default cognition omitted independent routing or its business boundary")
	}
	if strings.Contains(brain, "### 1. Product") || strings.Contains(files["skills/deploy-work-service/SKILL.md"], "### 1. Product") {
		t.Fatal("full application cognition duplicated into the permanent prompt or deployment Skill")
	}
	var skills int
	for path := range files {
		if strings.HasPrefix(path, "skills/") && strings.HasSuffix(path, "/SKILL.md") {
			skills++
		}
	}
	if skills != 2 {
		t.Fatal("expected exactly two peer Skills", skills)
	}
}
