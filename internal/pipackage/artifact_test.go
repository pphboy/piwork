package pipackage

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"piwork/internal/contracts"
	"testing"
)

func TestArtifactEnvironmentAndCompleteStaticIdentity(t *testing.T) {
	environment := contracts.PiPackagePreparedEnvironment{Os: "linux", Architecture: "amd64", Variant: json.RawMessage("null"), NodeAbi: "137", PiSdkVersion: "0.86.1"}
	if err := AssertEnvironment(environment, environment); err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"os", "architecture", "variant", "abi", "sdk"} {
		actual := environment
		switch field {
		case "os":
			actual.Os = "other"
		case "architecture":
			actual.Architecture = "arm64"
		case "variant":
			actual.Variant = []byte(`"v8"`)
		case "abi":
			actual.NodeAbi = "136"
		case "sdk":
			actual.PiSdkVersion = "0.86.0"
		}
		if err := AssertEnvironment(environment, actual); !errors.Is(err, ErrEnvironment) {
			t.Fatal("environment mismatch accepted", field, err)
		}
	}
	for _, raw := range []string{`{}`, `{"os":"linux","os":"other"}`, `{"os":"linux","architecture":"amd64","variant":null,"nodeAbi":"137","piSdkVersion":"0.86.1","unknown":true}`} {
		if _, err := ValidateEnvironment([]byte(raw)); !errors.Is(err, ErrManifest) {
			t.Fatal("invalid environment accepted")
		}
	}
	tree, err := OpenTree(context.Background(), createPackageTree(t))
	if err != nil {
		t.Fatal(err)
	}
	defer tree.Close()
	artifact, err := ValidateArtifact(tree, "local", "tools", environment, "")
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(artifact.Metadata)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := contracts.Decode[contracts.PiPackageArtifactMetadata](bytes.NewReader(encoded), "PiPackageArtifactMetadataSchema", ManifestBytes); err != nil {
		t.Fatal("native metadata violated shared schema", err)
	}
	if _, err := ValidateArtifact(tree, "zip", "tools.zip", environment, string(artifact.Metadata.ContentDigest)); err != nil {
		t.Fatal(err)
	}
	if _, err := ValidateArtifact(tree, "zip", "tools.zip", environment, "sha256:wrong"); !errors.Is(err, ErrManifest) {
		t.Fatal("digest mismatch accepted")
	}
	for _, source := range []string{"", "https://private:credential@example.invalid/a/b", "bad\x00source"} {
		if _, err := ValidateArtifact(tree, "git", source, environment, ""); !errors.Is(err, ErrSource) {
			t.Fatal("private resolved source accepted")
		}
	}
}

func TestEnvironmentCompatibilityParityWithTS(t *testing.T) {
	raw, err := os.ReadFile("testdata/ts-contracts.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Environments []struct {
			Expected, Actual json.RawMessage
			Valid            bool
		}
	}
	if json.Unmarshal(raw, &fixture) != nil {
		t.Fatal("invalid environment fixture")
	}
	for _, item := range fixture.Environments {
		expected, err := ValidateEnvironment(item.Expected)
		if err != nil {
			t.Fatal(err)
		}
		actual, err := ValidateEnvironment(item.Actual)
		if err == nil {
			err = AssertEnvironment(expected, actual)
		}
		if (err == nil) != item.Valid {
			t.Fatal("environment compatibility differs", string(item.Actual), err)
		}
	}
}
