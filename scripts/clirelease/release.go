// Package clirelease verifies and archives standalone clients using only Go's
// standard library. It is a build-time package, outside the client import graph.
package clirelease

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"debug/buildinfo"
	"debug/elf"
	"debug/pe"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

type Build struct {
	Version        int    `json:"version"`
	Program        string `json:"program"`
	ReleaseVersion string `json:"releaseVersion"`
	Commit         string `json:"commit"`
	Modified       bool   `json:"modified"`
	GoVersion      string `json:"goVersion"`
	Target         string `json:"target"`
	Binary         string `json:"binary"`
	Bytes          int64  `json:"bytes"`
	SHA256         string `json:"sha256"`
	DesktopUIHash  string `json:"desktopUIHash"`
}
type Scenario struct {
	ID         string   `json:"id"`
	Status     string   `json:"status"`
	Commands   []string `json:"commands"`
	Diagnostic string   `json:"diagnostic"`
}
type Evidence struct {
	Version       int        `json:"version"`
	Target        string     `json:"target"`
	SHA256        string     `json:"sha256"`
	Commit        string     `json:"commit"`
	GoVersion     string     `json:"goVersion"`
	DesktopUIHash string     `json:"desktopUIHash"`
	Environment   string     `json:"environment"`
	StartedAt     string     `json:"startedAt"`
	Scenarios     []Scenario `json:"scenarios"`
}

var RequiredScenarios = []string{
	"client-dependencies", "private-storage", "other-user", "symlink", "files", "auth",
	"desktop-control", "interrupts", "default-desktop", "preferences-storage", "preferences-api",
	"preferences-browser", "core-command-families", "core-packages-snapshots", "proxy-network",
	"browser-isolation", "standalone-runtime", "tls-negative",
}

type Manifest struct {
	Build
	EvidenceSHA256 string `json:"evidenceSha256"`
}

func hash(data []byte) string { value := sha256.Sum256(data); return hex.EncodeToString(value[:]) }
func readJSON(path string, value any) ([]byte, error) {
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() {
		return nil, errors.New("release metadata must be a regular file")
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	raw, err := io.ReadAll(io.LimitReader(f, (4<<20)+1))
	if err != nil || len(raw) > 4<<20 {
		return nil, errors.New("invalid release metadata size")
	}
	if err := uniqueJSON(raw); err != nil {
		return nil, err
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		return nil, err
	}
	if decoder.Decode(new(any)) != io.EOF {
		return nil, errors.New("trailing metadata")
	}
	return raw, nil
}

// encoding/json accepts duplicate fields by choosing the last value. Release
// evidence must have one unambiguous meaning for every nested object.
func uniqueJSON(raw []byte) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	var visit func() error
	visit = func() error {
		token, err := decoder.Token()
		if err != nil {
			return err
		}
		opening, compound := token.(json.Delim)
		if !compound {
			return nil
		}
		if opening != '{' && opening != '[' {
			return errors.New("invalid JSON delimiter")
		}
		seen := map[string]bool{}
		for decoder.More() {
			if opening == '{' {
				key, err := decoder.Token()
				if err != nil {
					return err
				}
				name, ok := key.(string)
				if !ok || seen[name] {
					return errors.New("duplicate or invalid JSON field")
				}
				seen[name] = true
			}
			if err := visit(); err != nil {
				return err
			}
		}
		closing, err := decoder.Token()
		if err != nil {
			return err
		}
		if opening == '{' && closing != json.Delim('}') || opening == '[' && closing != json.Delim(']') {
			return errors.New("invalid JSON closure")
		}
		return nil
	}
	if err := visit(); err != nil {
		return err
	}
	if _, err := decoder.Token(); err != io.EOF {
		return errors.New("trailing release JSON")
	}
	return nil
}

var hexDigest = regexp.MustCompile(`^[a-f0-9]{64}$`)
var commitPattern = regexp.MustCompile(`^[a-f0-9]{40}$`)
var releaseVersionPattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._-]*$`)

func binaryTarget(filename string) (string, error) {
	if image, err := pe.Open(filename); err == nil {
		defer image.Close()
		arch := map[uint16]string{pe.IMAGE_FILE_MACHINE_AMD64: "amd64", pe.IMAGE_FILE_MACHINE_I386: "386", pe.IMAGE_FILE_MACHINE_ARM64: "arm64"}[image.Machine]
		if arch == "" {
			return "", errors.New("unknown PE architecture")
		}
		return "windows/" + arch, nil
	}
	image, err := elf.Open(filename)
	if err != nil {
		return "", errors.New("client is neither PE nor ELF")
	}
	defer image.Close()
	arch := map[elf.Machine]string{elf.EM_X86_64: "amd64", elf.EM_386: "386", elf.EM_ARM: "arm", elf.EM_AARCH64: "arm64", elf.EM_RISCV: "riscv64", elf.EM_S390: "s390x", elf.EM_LOONGARCH: "loong64"}[image.Machine]
	if image.Machine == elf.EM_PPC64 {
		arch = "ppc64"
		if image.Data == elf.ELFDATA2LSB {
			arch += "le"
		}
	}
	if image.Machine == elf.EM_MIPS {
		arch = "mips"
		if image.Class == elf.ELFCLASS64 {
			arch += "64"
		}
		if image.Data == elf.ELFDATA2LSB {
			arch += "le"
		}
	}
	if arch == "" {
		return "", errors.New("unknown ELF architecture")
	}
	return "linux/" + arch, nil
}

func ValidateBuild(directory string) (Build, string, error) {
	var metadata Build
	if _, err := readJSON(filepath.Join(directory, "build.json"), &metadata); err != nil {
		return metadata, "", err
	}
	if metadata.Version != 1 || metadata.Program != "piwork-cli" || !releaseVersionPattern.MatchString(metadata.ReleaseVersion) || !commitPattern.MatchString(metadata.Commit) || !hexDigest.MatchString(metadata.SHA256) || !hexDigest.MatchString(metadata.DesktopUIHash) || metadata.GoVersion != "go1.25.5" {
		return metadata, "", errors.New("invalid client build identity")
	}
	expected := "piwork-cli"
	if strings.HasPrefix(metadata.Target, "windows/") {
		expected += ".exe"
	}
	if metadata.Binary != expected {
		return metadata, "", errors.New("invalid client binary path")
	}
	filename := filepath.Join(directory, metadata.Binary)
	info, err := os.Lstat(filename)
	if err != nil || !info.Mode().IsRegular() {
		return metadata, "", errors.New("client must be a regular file")
	}
	raw, err := os.ReadFile(filename)
	if err != nil {
		return metadata, "", err
	}
	if info.Size() != metadata.Bytes || hash(raw) != metadata.SHA256 {
		return metadata, "", errors.New("client size/digest mismatch")
	}
	target, err := binaryTarget(filename)
	if err != nil {
		return metadata, "", err
	}
	if target != metadata.Target {
		return metadata, "", errors.New("client native header does not match target")
	}
	build, err := buildinfo.ReadFile(filename)
	if err != nil {
		return metadata, "", err
	}
	if build.Path != "piwork/cmd/piwork-cli" || build.GoVersion != metadata.GoVersion {
		return metadata, "", errors.New("client Go metadata mismatch")
	}
	settings := map[string]string{}
	for _, setting := range build.Settings {
		settings[setting.Key] = setting.Value
	}
	osArch := strings.Split(metadata.Target, "/")
	if len(osArch) != 2 || settings["GOOS"] != osArch[0] || settings["GOARCH"] != osArch[1] || settings["CGO_ENABLED"] != "0" || settings["-trimpath"] != "true" {
		return metadata, "", errors.New("client Go target or build flags mismatch")
	}
	if err := validateStamp(raw, metadata); err != nil {
		return metadata, "", err
	}
	return metadata, filename, nil
}

func validateStamp(raw []byte, metadata Build) error {
	prefix := []byte("piwork-cli-release-v1:" + "{")
	index := bytes.Index(raw, prefix)
	if index < 0 || bytes.Contains(raw[index+len(prefix):], prefix) {
		return errors.New("missing or ambiguous client release stamp")
	}
	var stamp struct {
		ReleaseVersion string `json:"releaseVersion"`
		Commit         string `json:"commit"`
		Modified       bool   `json:"modified"`
		DesktopUIHash  string `json:"desktopUIHash"`
		Target         string `json:"target"`
		GoVersion      string `json:"goVersion"`
	}
	decoder := json.NewDecoder(bytes.NewReader(raw[index+len(prefix)-1:]))
	var encoded json.RawMessage
	if err := decoder.Decode(&encoded); err != nil || uniqueJSON(encoded) != nil {
		return errors.New("invalid client release stamp")
	}
	decoder = json.NewDecoder(bytes.NewReader(encoded))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&stamp); err != nil {
		return errors.New("invalid client release stamp")
	}
	if stamp.ReleaseVersion != metadata.ReleaseVersion || stamp.Commit != metadata.Commit || stamp.Modified != metadata.Modified || stamp.DesktopUIHash != metadata.DesktopUIHash || stamp.Target != metadata.Target || stamp.GoVersion != metadata.GoVersion {
		return errors.New("client release/UI identity mismatch")
	}
	return nil
}

func ValidateEvidence(metadata Build, evidence Evidence) error {
	if evidence.Version != 1 || evidence.Target != metadata.Target || evidence.SHA256 != metadata.SHA256 || evidence.Commit != metadata.Commit || evidence.GoVersion != metadata.GoVersion || evidence.DesktopUIHash != metadata.DesktopUIHash || evidence.Environment == "" {
		return errors.New("native evidence does not match client identity")
	}
	if _, err := time.Parse(time.RFC3339, evidence.StartedAt); err != nil {
		return errors.New("invalid native evidence time")
	}
	seen := map[string]bool{}
	for _, scene := range evidence.Scenarios {
		if scene.ID == "" || seen[scene.ID] || scene.Status != "pass" || len(scene.Commands) == 0 {
			return errors.New("native evidence contains failed, skipped, missing or duplicate scenarios")
		}
		seen[scene.ID] = true
	}
	for _, scene := range RequiredScenarios {
		if !seen[scene] {
			return fmt.Errorf("native scenario missing: %s", scene)
		}
	}
	return nil
}

func Package(directory, evidencePath, outputDirectory string) (string, error) {
	metadata, filename, err := ValidateBuild(directory)
	if err != nil {
		return "", err
	}
	var evidence Evidence
	evidenceRaw, err := readJSON(evidencePath, &evidence)
	if err != nil {
		return "", err
	}
	if err := ValidateEvidence(metadata, evidence); err != nil {
		return "", err
	}
	manifest, err := json.MarshalIndent(Manifest{Build: metadata, EvidenceSHA256: hash(evidenceRaw)}, "", "  ")
	if err != nil {
		return "", err
	}
	manifest = append(manifest, '\n')
	binary, err := os.ReadFile(filename)
	if err != nil || hash(binary) != metadata.SHA256 {
		return "", errors.New("client changed after validation")
	}
	note := []byte("Piwork CLI " + metadata.ReleaseVersion + "\n\nRun piwork-cli[.exe] from any directory to start Desktop. Use --core <origin> for this launch.\nUse --help for retained business commands; use desktop --no-open to print the browser address.\nDesktop can save or clear a default Core for the next launch. Parameters and PIWORK_CORE_URL override it.\nBusiness commands resolve --core, PIWORK_CORE_URL, saved credentials, then local Core; they do not read Desktop preferences.\nConnect to an existing Core. The client does not require Go, Node, Python, Docker or source files.\nCtrl+C exits Desktop/proxy; closing the browser leaves the client running. Forced termination may leave safe stale resources.\n")
	if err := os.MkdirAll(outputDirectory, 0755); err != nil {
		return "", err
	}
	name := "piwork-cli-" + strings.ReplaceAll(metadata.Target, "/", "-") + "-" + metadata.ReleaseVersion + "-" + metadata.Commit[:12]
	extension := ".tar.gz"
	if strings.HasPrefix(metadata.Target, "windows/") {
		extension = ".zip"
	}
	output := filepath.Join(outputDirectory, name+extension)
	file, err := os.CreateTemp(outputDirectory, ".client-release-")
	if err != nil {
		return "", err
	}
	temporary := file.Name()
	defer os.Remove(temporary)
	defer file.Close()
	entries := []struct {
		name string
		raw  []byte
		mode int64
	}{{metadata.Binary, binary, 0755}, {"manifest.json", manifest, 0644}, {"README.txt", note, 0644}}
	if extension == ".zip" {
		writer := zip.NewWriter(file)
		for _, entry := range entries {
			header := &zip.FileHeader{Name: name + "/" + entry.name, Method: zip.Deflate}
			header.SetMode(os.FileMode(entry.mode))
			stream, e := writer.CreateHeader(header)
			if e != nil {
				return "", e
			}
			if _, e = stream.Write(entry.raw); e != nil {
				return "", e
			}
		}
		err = writer.Close()
	} else {
		compressed := gzip.NewWriter(file)
		writer := tar.NewWriter(compressed)
		for _, entry := range entries {
			if e := writer.WriteHeader(&tar.Header{Name: name + "/" + entry.name, Mode: entry.mode, Size: int64(len(entry.raw)), Typeflag: tar.TypeReg}); e != nil {
				return "", e
			}
			if _, e := writer.Write(entry.raw); e != nil {
				return "", e
			}
		}
		err = errors.Join(writer.Close(), compressed.Close())
	}
	if err = errors.Join(err, file.Sync(), file.Close()); err != nil {
		return "", err
	}
	// Do not replace an existing release with different bytes or evidence.
	if err = os.Link(temporary, output); err != nil {
		return "", err
	}
	complete := false
	defer func() {
		if !complete {
			// Only remove the file this invocation published, preserving an
			// existing checksum or any externally replaced output.
			a, ea := os.Stat(temporary)
			b, eb := os.Stat(output)
			if ea == nil && eb == nil && os.SameFile(a, b) {
				_ = os.Remove(output)
			}
		}
	}()
	archive, err := os.ReadFile(output)
	if err != nil {
		return "", err
	}
	checksum := []byte(hash(archive) + "  " + filepath.Base(output) + "\n")
	sum, err := os.OpenFile(output+".sha256", os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0644)
	if err != nil {
		return "", err
	}
	_, writeErr := sum.Write(checksum)
	err = errors.Join(writeErr, sum.Sync(), sum.Close())
	if err != nil {
		_ = os.Remove(output + ".sha256")
		return "", err
	}
	complete = true
	return output, nil
}
