package coreapp

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"reflect"
	"testing"

	"piwork/internal/contracts"
)

func TestServiceDefinitionsMatchFrozenTSNormalization(t *testing.T) {
	raw, err := os.ReadFile("testdata/service-definitions.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures []struct {
		Name              string
		Input, Normalized json.RawMessage
		Error             *struct{ Code, Field string }
	}
	if err := json.Unmarshal(raw, &fixtures); err != nil {
		t.Fatal(err)
	}
	for _, fixture := range fixtures {
		t.Run(fixture.Name, func(t *testing.T) {
			normalized, err := normalizeServiceDefinition(fixture.Input)
			if fixture.Error != nil {
				var rejected *serviceDefinitionValidationError
				if !errors.As(err, &rejected) || rejected.Code != fixture.Error.Code || rejected.Field != fixture.Error.Field {
					t.Fatal("definition rejection differs", err, rejected, fixture.Error)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			encoded, err := json.Marshal(normalized)
			if err != nil {
				t.Fatal(err)
			}
			var expected, actual any
			if json.Unmarshal(fixture.Normalized, &expected) != nil || json.Unmarshal(encoded, &actual) != nil || !reflect.DeepEqual(expected, actual) {
				t.Fatal("normalization differs", string(encoded), string(fixture.Normalized))
			}
			definition := assignServiceDefinition(normalized, "service-fixture-0001", 1)
			encoded, _ = json.Marshal(definition)
			if _, err := contracts.Decode[contracts.ServiceDefinition](bytes.NewReader(encoded), "ServiceDefinitionSchema", serviceRequestLimit); err != nil {
				t.Fatal("assigned definition breaks contract", err)
			}
		})
	}
}
