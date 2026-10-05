package clirelease

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"encoding/json"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func fixtureBuild(t *testing.T, target string) (string, Build) {
	t.Helper()
	directory := t.TempDir()
	metadata := Build{Version: 1, Program: "piwork-cli", ReleaseVersion: "0.1.0-test", Commit: strings.Repeat("a", 40), Modified: true, GoVersion: "go1.25.5", Target: target, Binary: "piwork-cli", DesktopUIHash: strings.Repeat("b", 64)}
	if strings.HasPrefix(target, "windows/") {
		metadata.Binary += ".exe"
	}
	identity, _ := json.Marshal(map[string]any{"releaseVersion": metadata.ReleaseVersion, "commit": metadata.Commit, "modified": metadata.Modified, "desktopUIHash": metadata.DesktopUIHash, "target": metadata.Target, "goVersion": metadata.GoVersion})
	flags := "-X 'piwork/internal/buildinfo.ClientReleaseIdentity=piwork-cli-release-v1:" + string(identity) + "'"
	binary := filepath.Join(directory, metadata.Binary)
	command := exec.Command("go", "build", "-mod=readonly", "-trimpath", "-ldflags", flags, "-o", binary, "./cmd/piwork-cli")
	command.Dir = "../.."
	parts := strings.Split(target, "/")
	command.Env = append(os.Environ(), "CGO_ENABLED=0", "GOTOOLCHAIN=local", "GOOS="+parts[0], "GOARCH="+parts[1])
	if result, err := command.CombinedOutput(); err != nil {
		t.Fatalf("build candidate: %v %s", err, result)
	}
	raw, err := os.ReadFile(binary)
	if err != nil {
		t.Fatal(err)
	}
	metadata.SHA256 = hash(raw)
	metadata.Bytes = int64(len(raw))
	writeFixtureJSON(t, filepath.Join(directory, "build.json"), metadata)
	return directory, metadata
}
func writeFixtureJSON(t *testing.T, path string, value any) {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(path, raw, 0600); err != nil {
		t.Fatal(err)
	}
}
func fixtureEvidence(metadata Build) Evidence {
	result := Evidence{Version: 1, Target: metadata.Target, SHA256: metadata.SHA256, Commit: metadata.Commit, GoVersion: metadata.GoVersion, DesktopUIHash: metadata.DesktopUIHash, Environment: "synthetic unit-test fixture; not native release evidence", StartedAt: time.Now().UTC().Format(time.RFC3339)}
	for _, id := range RequiredScenarios {
		result.Scenarios = append(result.Scenarios, Scenario{ID: id, Status: "pass", Commands: []string{"synthetic test assertion"}})
	}
	return result
}

func TestReleaseRejectsMetadataHeaderIdentityAndEvidenceMismatch(t *testing.T) {
	directory, metadata := fixtureBuild(t, "linux/amd64")
	if _, _, err := ValidateBuild(directory); err != nil {
		t.Fatal("valid Go candidate rejected", err)
	}
	for _, kind := range []string{"size", "digest", "target", "version", "commit", "ui", "go", "binary", "type"} {
		t.Run(kind, func(t *testing.T) {
			changed := metadata
			switch kind {
			case "size":
				changed.Bytes++
			case "digest":
				changed.SHA256 = strings.Repeat("c", 64)
			case "target":
				changed.Target = "linux/arm64"
			case "version":
				changed.ReleaseVersion = "0.2.0"
			case "commit":
				changed.Commit = strings.Repeat("c", 40)
			case "ui":
				changed.DesktopUIHash = strings.Repeat("c", 64)
			case "go":
				changed.GoVersion = "go1.24.0"
			case "binary":
				changed.Binary = "../piwork-cli"
			case "type":
				if err := os.Rename(filepath.Join(directory, metadata.Binary), filepath.Join(directory, "held")); err != nil {
					t.Fatal(err)
				}
				if err := os.Mkdir(filepath.Join(directory, metadata.Binary), 0700); err != nil {
					t.Fatal(err)
				}
				defer func() {
					os.Remove(filepath.Join(directory, metadata.Binary))
					os.Rename(filepath.Join(directory, "held"), filepath.Join(directory, metadata.Binary))
				}()
			}
			writeFixtureJSON(t, filepath.Join(directory, "build.json"), changed)
			if _, _, err := ValidateBuild(directory); err == nil {
				t.Fatal("invalid candidate accepted")
			}
		})
	}
	writeFixtureJSON(t, filepath.Join(directory, "build.json"), metadata)
	for _, kind := range []string{"digest", "target", "ui", "commit", "missing", "fail", "skip", "unverified", "duplicate", "no-command"} {
		t.Run("evidence-"+kind, func(t *testing.T) {
			evidence := fixtureEvidence(metadata)
			switch kind {
			case "digest":
				evidence.SHA256 = strings.Repeat("c", 64)
			case "target":
				evidence.Target = "windows/amd64"
			case "ui":
				evidence.DesktopUIHash = strings.Repeat("c", 64)
			case "commit":
				evidence.Commit = strings.Repeat("c", 40)
			case "missing":
				evidence.Scenarios = evidence.Scenarios[1:]
			case "duplicate":
				evidence.Scenarios = append(evidence.Scenarios, evidence.Scenarios[0])
			case "no-command":
				evidence.Scenarios[0].Commands = nil
			default:
				evidence.Scenarios[0].Status = kind
			}
			if err := ValidateEvidence(metadata, evidence); err == nil {
				t.Fatal("invalid native evidence accepted")
			}
		})
	}
	if _, err := Package(directory, filepath.Join(directory, "missing-evidence.json"), t.TempDir()); err == nil {
		t.Fatal("missing report accepted")
	}
}

func TestReleaseArchiveContainsOnlyClientManifestAndInstructions(t *testing.T) {
	for _, target := range []string{"linux/amd64", "windows/amd64"} {
		t.Run(target, func(t *testing.T) {
			directory, metadata := fixtureBuild(t, target)
			report := filepath.Join(directory, "unit-fixture.json")
			writeFixtureJSON(t, report, fixtureEvidence(metadata))
			outputDirectory := t.TempDir()
			filename, err := Package(directory, report, outputDirectory)
			if err != nil {
				t.Fatal(err)
			}
			contents := map[string][]byte{}
			modes := map[string]int64{}
			if strings.HasSuffix(filename, ".zip") {
				reader, err := zip.OpenReader(filename)
				if err != nil {
					t.Fatal(err)
				}
				defer reader.Close()
				for _, entry := range reader.File {
					stream, err := entry.Open()
					if err != nil {
						t.Fatal(err)
					}
					raw, err := io.ReadAll(stream)
					stream.Close()
					if err != nil {
						t.Fatal(err)
					}
					contents[filepath.Base(entry.Name)] = raw
					modes[filepath.Base(entry.Name)] = int64(entry.Mode().Perm())
				}
			} else {
				file, err := os.Open(filename)
				if err != nil {
					t.Fatal(err)
				}
				defer file.Close()
				compressed, err := gzip.NewReader(file)
				if err != nil {
					t.Fatal(err)
				}
				defer compressed.Close()
				reader := tar.NewReader(compressed)
				for {
					entry, err := reader.Next()
					if err == io.EOF {
						break
					}
					if err != nil {
						t.Fatal(err)
					}
					raw, err := io.ReadAll(reader)
					if err != nil {
						t.Fatal(err)
					}
					contents[filepath.Base(entry.Name)] = raw
					modes[filepath.Base(entry.Name)] = entry.Mode
				}
			}
			if len(contents) != 3 || hash(contents[metadata.Binary]) != metadata.SHA256 || modes[metadata.Binary] != 0755 || !strings.Contains(string(contents["README.txt"]), "--core") {
				t.Fatal("archive contents or executable mode differs")
			}
			var manifest Manifest
			if err := json.Unmarshal(contents["manifest.json"], &manifest); err != nil || manifest.Build != metadata {
				t.Fatal("manifest differs", err)
			}
			reportRaw, _ := os.ReadFile(report)
			if manifest.EvidenceSHA256 != hash(reportRaw) {
				t.Fatal("report hash missing")
			}
			archiveRaw, _ := os.ReadFile(filename)
			checksum, err := os.ReadFile(filename + ".sha256")
			if err != nil || !strings.HasPrefix(string(checksum), hash(archiveRaw)+"  ") {
				t.Fatal("archive checksum differs", err)
			}
			before := hash(archiveRaw)
			if _, err := Package(directory, report, outputDirectory); err == nil {
				t.Fatal("existing release overwritten")
			}
			after, _ := os.ReadFile(filename)
			if hash(after) != before {
				t.Fatal("existing release changed")
			}
		})
	}
}

func TestReleaseJSONRejectsDuplicateFieldsAtEveryDepth(t *testing.T) {
	for _, raw := range []string{`{"target":"windows/amd64","target":"linux/amd64"}`, `{"scenarios":[{"status":"fail","status":"pass"}]}`, `{"version":1} {"version":2}`} {
		if err := uniqueJSON([]byte(raw)); err == nil {
			t.Fatal("ambiguous release JSON accepted", raw)
		}
	}
	if err := uniqueJSON([]byte(`{"scenarios":[{"status":"pass"}],"version":1}`)); err != nil {
		t.Fatal(err)
	}
}

func TestChecksumConflictDoesNotLeaveArchiveOrOverwriteExistingSum(t *testing.T) {
	directory, metadata := fixtureBuild(t, "linux/amd64")
	evidence := filepath.Join(t.TempDir(), "evidence.json")
	writeFixtureJSON(t, evidence, fixtureEvidence(metadata))
	output := t.TempDir()
	name := "piwork-cli-linux-amd64-" + metadata.ReleaseVersion + "-" + metadata.Commit[:12] + ".tar.gz"
	sumPath := filepath.Join(output, name+".sha256")
	if err := os.WriteFile(sumPath, []byte("existing checksum"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := Package(directory, evidence, output); err == nil {
		t.Fatal("checksum conflict accepted")
	}
	if _, err := os.Stat(filepath.Join(output, name)); !os.IsNotExist(err) {
		t.Fatal("incomplete release was left published", err)
	}
	raw, err := os.ReadFile(sumPath)
	if err != nil || string(raw) != "existing checksum" {
		t.Fatal("existing checksum changed", err)
	}
}
