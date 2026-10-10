package servicedefinition

import (
	"encoding/json"
	"testing"
)

func TestMemoryCompatibilityDefaultAndValidation(t *testing.T) {
	for _, memory := range []string{"", `,"memoryBytes":0`, `,"memoryBytes":134217728`} {
		input, err := Normalize(json.RawMessage(`{"name":"app","image":{"reference":"fixture/app"},"command":"app","workingDirectory":"/"` + memory + `}`))
		if err != nil {
			t.Fatal(memory, err)
		}
		if memory == "" && input.MemoryBytes.Value != 0 {
			t.Fatal("omission must mean unlimited", input.MemoryBytes.Value)
		}
	}
	for _, memory := range []string{"-1", "1.5", "9007199254740992", `"0"`} {
		if _, err := Normalize(json.RawMessage(`{"name":"app","image":{"reference":"fixture/app"},"command":"app","workingDirectory":"/","memoryBytes":` + memory + `}`)); err == nil {
			t.Fatal("accepted invalid compatibility value", memory)
		}
	}
}
