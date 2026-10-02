package contracts

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"reflect"
	"strings"
	"testing"
)

func TestTSValidationFixtures(t *testing.T) {
	raw, err := os.ReadFile("testdata/ts-validation.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures []struct {
		Schema string
		Case   string
		JSON   string
		Valid  bool
	}
	if err := json.Unmarshal(raw, &fixtures); err != nil {
		t.Fatal(err)
	}
	covered := make(map[string]bool)
	for _, fixture := range fixtures {
		t.Run(fixture.Schema+"/"+fixture.Case, func(t *testing.T) {
			value, err := ParseJSON(strings.NewReader(fixture.JSON), 2<<20)
			if err == nil {
				err = Validate(fixture.Schema, value)
			}
			if (err == nil) != fixture.Valid {
				t.Fatalf("TS expected valid=%v; Go error=%v", fixture.Valid, err)
			}
		})
		covered[fixture.Schema] = true
	}
	if len(covered) != len(SchemaNames()) {
		t.Fatal("missing contract fixtures")
	}
}

func TestStrictJSON(t *testing.T) {
	for _, raw := range []string{
		`{"x":1,"x":2}`, `{"x":1,"\u0078":2}`, `{"x":{"y":1,"y":2}}`,
		`{} {}`, `{"x":NaN}`, `{"x":01}`, `{"x":1,}`, `{"x":9007199254740992}`,
		`{"x":-9007199254740992}`, `{"x":1e400}`, "{\"x\":\"\xff\"}", strings.Repeat("[", 130) + strings.Repeat("]", 130),
	} {
		if _, err := ParseJSON(strings.NewReader(raw), 1<<20); !errors.Is(err, ErrInvalidJSON) {
			t.Fatalf("expected strict rejection: %q", raw)
		}
	}
	if _, err := ParseJSON(strings.NewReader(`{"x":1}`), 4); !errors.Is(err, ErrJSONTooLarge) {
		t.Fatal(err)
	}
	value, err := ParseJSON(strings.NewReader(`{"max":9007199254740991,"exponent":1e3,"decimal":1.0,"false":false,"empty":[],"null":null}`), 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	object := value.(map[string]any)
	if object["max"] != MaxSafeInteger || object["exponent"] != int64(1000) || object["decimal"] != int64(1) {
		t.Fatal(object)
	}
}

func TestPresenceAndDTO(t *testing.T) {
	for _, raw := range []string{`{}`, `{"skills":[]}`, `{"agentsMd":""}`} {
		decoded, err := Decode[WorkConfigurationPatch](strings.NewReader(raw), "WorkConfigurationPatchSchema", 1<<20)
		if err != nil {
			t.Fatal(err)
		}
		encoded, err := json.Marshal(decoded)
		if err != nil {
			t.Fatal(err)
		}
		var got, want any
		_ = json.Unmarshal(encoded, &got)
		_ = json.Unmarshal([]byte(raw), &want)
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("presence changed: %s -> %s", raw, encoded)
		}
	}
	var f struct {
		Value Field[bool] `json:"value,omitzero"`
	}
	for _, raw := range []string{`{}`, `{"value":null}`, `{"value":false}`} {
		if err := json.Unmarshal([]byte(raw), &f); err != nil {
			t.Fatal(err)
		}
		got, err := json.Marshal(f)
		if err != nil {
			t.Fatal(err)
		}
		if string(got) != raw {
			t.Fatalf("lost null/false: %s -> %s", raw, got)
		}
		f = struct {
			Value Field[bool] `json:"value,omitzero"`
		}{}
	}
	decoded, err := Decode[FileHelperResult](strings.NewReader(`{"status":200,"bytes":1e3,"entries":0}`), "FileHelperResultSchema", 65536)
	if err != nil || decoded.Bytes != 1000 {
		t.Fatalf("numeric DTO conversion: %#v %v", decoded, err)
	}
}

func TestSafeErrors(t *testing.T) {
	secret := "/var/private/core.sqlite password=secret-token"
	for _, err := range []error{errors.New(secret), fmt.Errorf("storage: %w", errors.New(secret)), NewError(secret, secret), invalid(secret)} {
		_, view := ProjectError(err)
		encoded, _ := json.Marshal(view)
		for _, text := range []string{"private", "password", "secret", "sqlite"} {
			if bytes.Contains(encoded, []byte(text)) {
				t.Fatalf("unsafe error: %s", encoded)
			}
		}
	}
	status, view := ProjectError(fmt.Errorf("wrapped: %w", NewError("WORK_BUSY", "configuration.skills").WithRetryAfter(100)))
	if status != 409 || view.Code != "WORK_BUSY" || !view.Retryable || view.Field.Value != "configuration.skills" || view.RetryAfterMs.Value != 100 {
		t.Fatal(view)
	}
}

func TestTSCoreErrorProjection(t *testing.T) {
	raw, err := os.ReadFile("testdata/ts-errors.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures []struct {
		Name     string
		Code     string
		Expected struct {
			Status  int
			Code    string
			Message string
		}
	}
	if err := json.Unmarshal(raw, &fixtures); err != nil {
		t.Fatal(err)
	}
	for _, fixture := range fixtures {
		status, view := ProjectError(NewError(fixture.Code, ""))
		if status != fixture.Expected.Status || view.Code != fixture.Expected.Code || view.Message != fixture.Expected.Message {
			t.Fatalf("%s projection changed: %d %#v", fixture.Name, status, view)
		}
	}
}
