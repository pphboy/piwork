package consoleapp

import (
	"bytes"
	"encoding/json"
	"reflect"
	"testing"

	"piwork/internal/buildinfo"
)

func TestEntryHelpAndVersionKeepOperatorContract(t *testing.T) {
	t.Setenv("PIWORK_CONFIG_PATH", "/unavailable/client.json")
	for _, args := range [][]string{{"--help"}, {"-h"}, {"help"}, {"serve", "--help"}} {
		var out, errOut bytes.Buffer
		if code := Entry(args, &out, &errOut); code != 0 || out.String() != consoleHelp || errOut.Len() != 0 {
			t.Fatalf("%v: code=%d stdout=%q stderr=%q", args, code, out.String(), errOut.String())
		}
	}
	for _, args := range [][]string{{"--version"}, {"version"}} {
		var out, errOut bytes.Buffer
		if code := Entry(args, &out, &errOut); code != 0 || errOut.Len() != 0 {
			t.Fatalf("%v: code=%d stderr=%q", args, code, errOut.String())
		}
		var got, expected any
		if err := json.Unmarshal(out.Bytes(), &got); err != nil {
			t.Fatal(err)
		}
		raw, err := json.Marshal(buildinfo.Read("piwork-console"))
		if err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal(raw, &expected); err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(got, expected) {
			t.Fatalf("version changed: got %v want %v", got, expected)
		}
	}
}
