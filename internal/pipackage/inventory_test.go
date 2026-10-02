package pipackage

import (
	"encoding/json"
	"os"
	"piwork/internal/contracts"
	"reflect"
	"testing"
)

func TestGlobAndInventoryParityWithTS(t *testing.T) {
	raw, err := os.ReadFile("testdata/ts-contracts.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures struct {
		Globs []struct {
			Pattern, Value string
			Matched        bool
		}
		Inventories []struct {
			Pi        json.RawMessage
			Tree      []contracts.DigestEntry
			Output    Inventory
			ErrorCode *string
		}
	}
	if err := json.Unmarshal(raw, &fixtures); err != nil {
		t.Fatal(err)
	}
	for _, item := range fixtures.Globs {
		t.Run(item.Pattern+"/"+item.Value, func(t *testing.T) {
			if got := compileGlob(item.Pattern).match(item.Value); got != item.Matched {
				t.Fatalf("got %v want %v", got, item.Matched)
			}
		})
	}
	for _, item := range fixtures.Inventories {
		t.Run("inventory/"+string(item.Pi), func(t *testing.T) {
			raw := []byte(`{"name":"tools"}`)
			if string(item.Pi) != "null" {
				raw = []byte(`{"name":"tools","pi":` + string(item.Pi) + `}`)
			}
			manifest, err := ParseManifest(raw)
			var got Inventory
			if err == nil {
				got, err = InspectResources(manifest, item.Tree)
			}
			if item.ErrorCode != nil {
				if ErrorCode(err) != *item.ErrorCode {
					t.Fatalf("got %v", err)
				}
				return
			}
			if err != nil || !reflect.DeepEqual(got, item.Output) {
				t.Fatalf("got %+v / %v, want %+v", got, err, item.Output)
			}
		})
	}
}
