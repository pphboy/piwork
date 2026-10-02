package pipackage

import (
	"encoding/json"
	"errors"
	"os"
	"reflect"
	"testing"
)

type contractFixture struct {
	Sources []struct {
		Input     string
		Output    json.RawMessage
		ErrorCode *string
	}
	Manifests []struct {
		Input     string
		Output    json.RawMessage
		ErrorCode *string
	}
	Peers []struct {
		Range, Version                      string
		RangeValid, VersionValid, Satisfied bool
	}
}

func TestManifestSourceAndPeerParityWithTS(t *testing.T) {
	raw, err := os.ReadFile("testdata/ts-contracts.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture contractFixture
	if json.Unmarshal(raw, &fixture) != nil {
		t.Fatal("invalid frozen fixture")
	}
	for _, item := range fixture.Manifests {
		t.Run("manifest/"+item.Input, func(t *testing.T) {
			manifest, err := ParseManifest([]byte(item.Input))
			if item.ErrorCode != nil {
				if ErrorCode(err) != *item.ErrorCode {
					t.Fatalf("error parity: %v", err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			got, _ := json.Marshal(manifest)
			var expected, actual any
			json.Unmarshal(item.Output, &expected)
			json.Unmarshal(got, &actual)
			if !reflect.DeepEqual(expected, actual) {
				t.Fatalf("manifest parity: %s", got)
			}
		})
	}
	for _, item := range fixture.Sources {
		t.Run("source/"+item.Input, func(t *testing.T) {
			source, err := ParseSource(item.Input)
			if item.ErrorCode != nil {
				if !errors.Is(err, ErrSource) {
					t.Fatal(err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			var expected Source
			if json.Unmarshal(item.Output, &expected) != nil || !reflect.DeepEqual(source, expected) {
				t.Fatalf("source parity: %+v / %+v", source, expected)
			}
		})
	}
	for _, item := range fixture.Peers {
		t.Run("peer/"+item.Range+"/"+item.Version, func(t *testing.T) {
			_, rangeErr := parsePeerRange(item.Range)
			if (rangeErr == nil) != item.RangeValid {
				t.Fatalf("range validation parity: %v", rangeErr)
			}
			_, versionErr := validHostVersion(item.Version)
			if (versionErr == nil) != item.VersionValid {
				t.Fatalf("host version validation parity: %v", versionErr)
			}
			versions := make(map[string]string)
			for _, name := range HostModules {
				versions[name] = item.Version
			}
			err := CheckHostPeers(Manifest{PeerDependencies: map[string]string{HostModules[0]: item.Range}}, versions)
			if (err == nil) != item.Satisfied {
				t.Fatalf("peer satisfaction parity: %v", err)
			}
		})
	}
}
