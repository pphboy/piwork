package distribution

import (
	"encoding/base64"
	"strings"
	"testing"
)

func TestEmbeddedDependenciesAreNonsecretAndRejectMalformedOverrides(t *testing.T) {
	prior := EncodedImages
	defer func() { EncodedImages = prior }()
	EncodedImages = ""
	defaults, err := Defaults()
	if err != nil || defaults.Agent == "" {
		t.Fatal("embedded release defaults unavailable")
	}
	valid := `{"agent":"test/agent:1","packageHelper":"test/package:1","fileHelper":"test/file:1","snapshotHelper":"test/snapshot:1"}`
	for _, raw := range []string{valid, strings.Replace(valid, `test/agent:1`, `test/agent:latest`, 1), strings.Replace(valid, `test/agent:1`, `https://synthetic-secret@invalid`, 1), strings.Replace(valid, `"agent":`, `"password":"synthetic-secret","agent":`, 1), valid + `{}`} {
		EncodedImages = base64.RawStdEncoding.EncodeToString([]byte(raw))
		_, err := Defaults()
		if (raw == valid) != (err == nil) {
			t.Fatal("release override acceptance changed")
		}
		if err != nil && strings.Contains(err.Error(), "synthetic-secret") {
			t.Fatal("release failure exposed input")
		}
	}
	EncodedImages = "invalid"
	if _, err := Defaults(); err == nil {
		t.Fatal("invalid encoded override accepted")
	}
}
