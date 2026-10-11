// Package releaseinfo provides offline, component-specific product information.
package releaseinfo

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"fmt"
	"piwork/internal/buildinfo"
	"strings"
)

const ReleasesURL = "https://github.com/pphboy/piwork/releases"

//go:embed notes.json
var notesJSON []byte

type Section struct {
	Title string   `json:"title"`
	Items []string `json:"items"`
}
type Notes struct {
	Version     string    `json:"version"`
	Component   string    `json:"component"`
	Title       string    `json:"title"`
	PublishedAt string    `json:"publishedAt,omitempty"`
	Sections    []Section `json:"sections"`
}
type Catalog struct {
	Version  int     `json:"version"`
	Releases []Notes `json:"releases"`
}
type Info struct {
	AboutAPIVersion int            `json:"aboutApiVersion"`
	Build           buildinfo.Info `json:"build"`
	ReleasesURL     string         `json:"releasesUrl"`
	ReleaseNotes    *Notes         `json:"releaseNotes"`
}

func Parse(raw []byte) (Catalog, error) {
	var catalog Catalog
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&catalog) != nil || catalog.Version != 1 {
		return catalog, fmt.Errorf("invalid release notes catalog")
	}
	seen := map[string]bool{}
	for _, notes := range catalog.Releases {
		key := notes.Version + ":" + notes.Component
		encoded, _ := json.Marshal(notes)
		if strings.TrimSpace(notes.Version) == "" || len(notes.Version) > 128 || notes.Component != "core" && notes.Component != "desktop" || strings.TrimSpace(notes.Title) == "" || len(notes.Title) > 256 || len(notes.PublishedAt) > 64 || len(notes.Sections) == 0 || len(notes.Sections) > 16 || len(encoded) > 65536 || seen[key] {
			return catalog, fmt.Errorf("invalid or duplicate release notes entry")
		}
		seen[key] = true
		for _, section := range notes.Sections {
			if strings.TrimSpace(section.Title) == "" || len(section.Title) > 256 || len(section.Items) == 0 || len(section.Items) > 128 {
				return catalog, fmt.Errorf("invalid release notes section")
			}
			for _, item := range section.Items {
				if strings.TrimSpace(item) == "" || len(item) > 8192 {
					return catalog, fmt.Errorf("invalid release notes item")
				}
			}
		}
	}
	return catalog, nil
}
func Read(program string) Info {
	build := buildinfo.Read(program)
	component := "core"
	if program == "piwork-cli" {
		component = "desktop"
	}
	info := Info{AboutAPIVersion: 1, Build: build, ReleasesURL: ReleasesURL}
	catalog, err := Parse(notesJSON)
	if err != nil {
		return info
	}
	if build.Version == "unknown" || strings.Contains(build.Version, "dev") || build.Version == "Unreleased" {
		return info
	}
	for _, notes := range catalog.Releases {
		if notes.Version == build.Version && notes.Component == component {
			copy := notes
			info.ReleaseNotes = &copy
			break
		}
	}
	return info
}
func Check(version string, components []string, requireCurrent bool) error {
	catalog, err := Parse(notesJSON)
	if err != nil {
		return err
	}
	if !requireCurrent {
		return nil
	}
	for _, component := range components {
		found := false
		for _, notes := range catalog.Releases {
			if notes.Version == version && notes.Component == component && version != "Unreleased" {
				found = true
			}
		}
		if !found {
			return fmt.Errorf("release notes are missing for %s %s", component, version)
		}
	}
	return nil
}
