package releaseinfo

import (
	"encoding/json"
	"piwork/internal/buildinfo"
	"piwork/internal/contracts"
	"reflect"
	"strings"
	"testing"
)

func TestRunningIdentityAndEmbeddedNotes(t *testing.T) {
	for _, program := range []string{"piwork-cli", "piwork-core"} {
		value := Read(program)
		if !reflect.DeepEqual(value.Build, buildinfo.Read(program)) {
			t.Fatal("version command mismatch")
		}
		raw, _ := json.Marshal(value)
		decoded, err := contracts.ParseJSON(strings.NewReader(string(raw)), 1<<20)
		if err != nil || contracts.Validate("ProductInfoSchema", decoded) != nil {
			t.Fatalf("invalid about contract: %s", raw)
		}
		if value.ReleasesURL != ReleasesURL {
			t.Fatal("unsafe link")
		}
	}
	if err := Check("", nil, false); err != nil {
		t.Fatal(err)
	}
	if Check("missing", []string{"core"}, true) == nil {
		t.Fatal("candidate without matching notes passed")
	}
}
func TestCatalogRejectsInvalidAndDuplicateNotes(t *testing.T) {
	good := `{"version":1,"releases":[{"version":"1.0.0","component":"core","title":"Changes","sections":[{"title":"Fixes","items":["A fixed issue"]}]}]}`
	catalog, err := Parse([]byte(good))
	if err != nil {
		t.Fatal(err)
	}
	for _, mutate := range []func(*Catalog){func(c *Catalog) { c.Releases = append(c.Releases, c.Releases[0]) }, func(c *Catalog) { c.Releases[0].Sections = nil }, func(c *Catalog) { c.Releases[0].Sections[0].Items = []string{""} }, func(c *Catalog) { c.Releases[0].Sections[0].Items = []string{strings.Repeat("a", 65537)} }, func(c *Catalog) { c.Releases[0].Component = "console" }} {
		var copy Catalog
		b, _ := json.Marshal(catalog)
		_ = json.Unmarshal(b, &copy)
		mutate(&copy)
		raw, _ := json.Marshal(copy)
		if _, err := Parse(raw); err == nil {
			t.Fatal("invalid notes accepted")
		}
	}
	saved := notesJSON
	t.Cleanup(func() { notesJSON = saved })
	notesJSON = []byte(good)
	if Check("1.0.0", []string{"core"}, true) != nil {
		t.Fatal("matching candidate failed")
	}
	savedVersion := buildinfo.Version
	t.Cleanup(func() { buildinfo.Version = savedVersion })
	buildinfo.Version = "1.0.0"
	if Read("piwork-core").ReleaseNotes == nil || Read("piwork-cli").ReleaseNotes != nil {
		t.Fatal("wrong component match")
	}
	buildinfo.Version = "1.0.0-dev"
	if Read("piwork-core").ReleaseNotes != nil {
		t.Fatal("development version used formal notes")
	}
}
