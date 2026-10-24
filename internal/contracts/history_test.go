package contracts

import (
	"bytes"
	"encoding/json"
	"os"
	"testing"
)

func TestHistoryEncodingMatchesTSBudget(t *testing.T) {
	raw, err := os.ReadFile("testdata/history-encoding.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct{ Text, Encoded string }
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	for _, c := range cases {
		var out bytes.Buffer
		if err := json.NewEncoder(&out).Encode(map[string]string{"text": c.Text}); err != nil {
			t.Fatal(err)
		}
		if out.String() != c.Encoded {
			t.Fatal("history JSON escaped byte budget differs between Go and TS")
		}
	}
	if HistoryPageBytes != 512<<10 || HistoryRpcBytes != 1<<20 || HistoryFragmentBytes != 32<<10 {
		t.Fatal("history budgets changed")
	}
}
