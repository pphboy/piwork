package filehelper

import (
	"encoding/json"
	"testing"

	"piwork/internal/contracts"
	"piwork/internal/fileprotocol"
)

func TestFileExistenceConditionsDoNotInventETags(t *testing.T) {
	info := &contracts.FileHelperMeta{Kind: "file", Size: raw(1), ModifiedMs: raw(2000)}
	for _, test := range []struct {
		method, header, value string
		missing               bool
		status                int64
		code                  string
	}{
		{"GET", "ifMatch", "*", false, 0, ""}, {"GET", "ifMatch", "*", true, 0, "FILE_PRECONDITION_FAILED"},
		{"GET", "ifMatch", `"version"`, false, 0, "FILE_PRECONDITION_FAILED"}, {"GET", "ifMatch", `W/"one", "two"`, false, 0, "FILE_PRECONDITION_FAILED"},
		{"GET", "ifNoneMatch", "*", false, 304, ""}, {"HEAD", "ifNoneMatch", "*", false, 304, ""}, {"PUT", "ifNoneMatch", "*", false, 0, "FILE_PRECONDITION_FAILED"},
		{"GET", "ifNoneMatch", `"version"`, false, 0, ""}, {"PUT", "ifNoneMatch", "*", true, 0, ""},
		{"GET", "ifNoneMatch", "wrong", false, 0, "FILE_REQUEST_INVALID"}, {"GET", "ifMatch", `"one",`, false, 0, "FILE_REQUEST_INVALID"},
		{"GET", "ifModifiedSince", "Thu, 01 Jan 1970 00:00:03 GMT", false, 304, ""}, {"PUT", "ifUnmodifiedSince", "Thu, 01 Jan 1970 00:00:01 GMT", false, 0, "FILE_PRECONDITION_FAILED"},
		{"GET", "ifModifiedSince", "not a date", false, 0, ""}, {"GET", "ifModifiedSince", "Thu Jan  1 00:00:03 1970", false, 0, ""},
	} {
		body := helperRequest(test.method, "data")
		body["conditions"].(map[string]any)[test.header] = test.value
		data, _ := json.Marshal(body)
		request, err := fileprotocol.ValidateRequest(fileprotocol.Frame{Kind: fileprotocol.Request, Data: data}, "filejob-1234567890123456", "work-1234567890123456", 1)
		if err != nil {
			t.Fatal(err)
		}
		current := info
		if test.missing {
			current = nil
		}
		status, err := evaluateConditions(request, current)
		code := ""
		if err != nil {
			code = fileprotocol.Code(err)
		}
		if status != test.status || code != test.code {
			t.Fatalf("%+v: %d %s", test, status, code)
		}
	}
}
