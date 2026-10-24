package sessionhistory

import (
	"net/url"
	"testing"
)

func TestStrictHistoryQuery(t *testing.T) {
	for _, raw := range []string{"limit=0", "limit=101", "limit=1&limit=2", "snapshot=x&snapshot=y", "direction=back", "content=result", "private=/var/data", "cursor=", "imageProfile=unknown"} {
		values, _ := url.ParseQuery(raw)
		if _, err := ParseQuery(values); err == nil {
			t.Fatal("accepted", raw)
		}
	}
	for _, raw := range []string{"", "limit=100&direction=older", "content=result&runId=run-1&snapshot=one", "content=runs&cursor=one"} {
		values, _ := url.ParseQuery(raw)
		q, err := ParseQuery(values)
		if err != nil {
			t.Fatal(raw, err)
		}
		if _, err = ParseQuery(QueryValues(q)); err != nil {
			t.Fatal(err)
		}
	}
}
