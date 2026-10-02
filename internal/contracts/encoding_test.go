package contracts

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"strings"
	"testing"
)

func TestTSSharedEncoding(t *testing.T) {
	raw, err := os.ReadFile("testdata/ts-encoding.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Trees []struct {
			Name    string
			Kind    string
			Digest  string
			Entries []struct {
				Path    string
				Type    string
				Mode    uint32
				DataHex string
				Target  string
			}
		}
		JSON []struct {
			Input      string
			EncodedHex string
		}
		Names []struct {
			Name string
			Key  string
		}
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	for _, tree := range fixture.Trees {
		t.Run(tree.Name, func(t *testing.T) {
			var entries []DigestEntry
			for _, item := range tree.Entries {
				data, err := hex.DecodeString(item.DataHex)
				if err != nil {
					t.Fatal(err)
				}
				entries = append(entries, DigestEntry{Path: item.Path, Type: item.Type, Mode: item.Mode, Size: int64(len(data)), Target: item.Target,
					Open: func() (io.ReadCloser, error) { return io.NopCloser(bytes.NewReader(data)), nil }})
			}
			var digest string
			var err error
			if tree.Kind == "skill" {
				digest, err = SkillDigest(entries)
			} else {
				digest, err = PiPackageDigest(entries)
			}
			if err != nil || digest != tree.Digest {
				t.Fatalf("TS/Go mismatch: %s != %s: %v", digest, tree.Digest, err)
			}
		})
	}
	for _, sample := range fixture.JSON {
		value, err := ParseJSON(strings.NewReader(sample.Input), 1<<20)
		if err != nil {
			t.Fatal(err)
		}
		encoded, err := EncodeCanonicalJSON(value)
		if err != nil || hex.EncodeToString(encoded) != sample.EncodedHex {
			t.Fatalf("canonical JSON changed for %s: %s, %v", sample.Input, encoded, err)
		}
	}
	for _, sample := range fixture.Names {
		if PackageNameKey(sample.Name) != sample.Key {
			t.Fatal("context package key changed")
		}
	}
}

func TestPrivateDigestStableAndSeparated(t *testing.T) {
	a := map[string]any{"b": int64(1), "a": []any{false, "中文"}}
	b := map[string]any{"a": []any{false, "中文"}, "b": int64(1)}
	first, err := PrivateDigest("service-spec", a)
	if err != nil {
		t.Fatal(err)
	}
	second, err := PrivateDigest("service-spec", b)
	if err != nil || first != second {
		t.Fatal("private digest depends on map insertion order")
	}
	other, err := PrivateDigest("request", a)
	if err != nil || other == first {
		t.Fatal("digest domains collide")
	}
	if _, err := PrivateDigest("", a); !errors.Is(err, ErrEncoding) {
		t.Fatal("empty hash domain accepted")
	}
}

func TestTreeDigestRejectsUnsafeInputsAndChangedFiles(t *testing.T) {
	file := func(name string) DigestEntry {
		return DigestEntry{Path: name, Type: "file", Size: 1, Open: func() (io.ReadCloser, error) { return io.NopCloser(strings.NewReader("x")), nil }}
	}
	for _, entries := range [][]DigestEntry{
		{file("../outside")}, {file("x"), file("x")}, {{Path: "link", Type: "symlink", Target: "../../outside"}},
		{{Path: "link", Type: "symlink", Target: "link"}}, {{Path: "link", Type: "symlink", Target: "missing"}},
	} {
		if _, err := PiPackageDigest(entries); !errors.Is(err, ErrEncoding) {
			t.Fatal("unsafe package tree accepted")
		}
	}
	changed := file("SKILL.md")
	changed.Size = 0
	if _, err := SkillDigest([]DigestEntry{changed}); !errors.Is(err, ErrEncoding) {
		t.Fatal("file size changed while hashing")
	}
	if _, err := SkillDigest([]DigestEntry{file("not-the-manifest")}); !errors.Is(err, ErrEncoding) {
		t.Fatal("missing SKILL.md accepted")
	}
	if _, err := SkillDigest([]DigestEntry{file("SKILL.md"), {Path: "link", Type: "symlink", Target: "SKILL.md"}}); !errors.Is(err, ErrEncoding) {
		t.Fatal("Skill symlink accepted")
	}
}
