package fileprotocol

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"io"
	"strings"
	"testing"
)

func requestBody(action string) map[string]any {
	return map[string]any{"version": 1, "jobId": "filejob-1234567890123456", "workId": "work-1234567890123456", "epoch": 1, "action": action, "pathSegments": []string{"中文.txt"}, "destinationSegments": nil, "depth": nil, "overwrite": nil, "conditions": map[string]any{"ifMatch": nil, "ifNoneMatch": nil, "ifModifiedSince": nil, "ifUnmodifiedSince": nil}, "range": nil, "expectedLength": nil}
}
func TestFramesRejectInvalidDirectionLengthAndStrictJSON(t *testing.T) {
	for _, raw := range []string{`{"x":1,"x":2}`, `{"x":9007199254740992}`, `{"x":"` + string([]byte{255}) + `"}`, `[]`, `{} {}`} {
		var stream bytes.Buffer
		var header [5]byte
		header[0] = Request
		binary.BigEndian.PutUint32(header[1:], uint32(len(raw)))
		stream.Write(header[:])
		stream.WriteString(raw)
		if _, err := Read(&stream, true); err == nil {
			t.Fatal("unsafe JSON frame accepted", raw)
		}
	}
	for _, kind := range []byte{0, Meta, DataOut, 255} {
		var header [5]byte
		header[0] = kind
		if _, err := Read(bytes.NewReader(header[:]), true); err == nil {
			t.Fatal("outbound/unknown kind accepted", kind)
		}
	}
	for _, size := range []uint32{MaxData + 1, ^uint32(0)} {
		var header [5]byte
		header[0] = DataIn
		binary.BigEndian.PutUint32(header[1:], size)
		if _, err := Read(bytes.NewReader(header[:]), true); err == nil {
			t.Fatal("unbounded payload accepted")
		}
	}
	if _, err := Read(bytes.NewReader([]byte{1, 0, 0}), true); err == nil {
		t.Fatal("truncated header accepted")
	}
}
func TestRequestIdentityAndNullContracts(t *testing.T) {
	for _, edit := range []func(map[string]any){func(x map[string]any) { x["workId"] = "work-foreign12345678" }, func(x map[string]any) { x["epoch"] = 2 }, func(x map[string]any) { delete(x, "conditions") }, func(x map[string]any) { x["pathSegments"] = nil }, func(x map[string]any) { x["unknown"] = true }, func(x map[string]any) { x["temporaries"] = []any{} }} {
		value := requestBody("GET")
		edit(value)
		raw, _ := json.Marshal(value)
		if _, err := ValidateRequest(Frame{Kind: Request, Data: raw}, "filejob-1234567890123456", "work-1234567890123456", 1); err == nil {
			t.Fatal("invalid identity/shape accepted", value)
		}
	}
	raw, _ := json.Marshal(requestBody("GET"))
	if _, err := ValidateRequest(Frame{Kind: Request, Data: raw}, "filejob-1234567890123456", "work-1234567890123456", 1); err != nil {
		t.Fatal(err)
	}
}
func TestPutRequiresUploadEndAndCommitAcknowledgement(t *testing.T) {
	var input, output bytes.Buffer
	Write(&input, Request, requestBody("PUT"), true)
	Write(&input, DataIn, []byte{0, 255, 7}, true)
	Write(&input, End, map[string]any{}, true)
	Write(&input, Ack, map[string]any{"epoch": 1, "phase": "commit", "temporaryId": nil}, true)
	session := &Session{Source: &input, Sink: &output, JobID: "filejob-1234567890123456", WorkID: "work-1234567890123456", Epoch: 1}
	if _, err := session.Start(); err != nil {
		t.Fatal(err)
	}
	if err := session.SendResult(201, 0, 0); err == nil {
		t.Fatal("result before upload/commit permitted")
	}
	var uploaded bytes.Buffer
	count, err := session.Upload(func(data []byte) error { _, err := uploaded.Write(data); return err })
	if err != nil || count != 3 || !bytes.Equal(uploaded.Bytes(), []byte{0, 255, 7}) {
		t.Fatal(count, err)
	}
	if err := session.SendResult(201, count, 0); err == nil {
		t.Fatal("mutation before ACK permitted")
	}
	if err := session.Prepare("commit", nil, nil, nil, nil, nil); err != nil {
		t.Fatal(err)
	}
	if err := session.SendResult(201, count, 0); err != nil {
		t.Fatal(err)
	}
	prepared, err := Read(&output, false)
	if err != nil || prepared.Kind != Prepared {
		t.Fatal(prepared, err)
	}
	result, err := Read(&output, false)
	if err != nil || result.Kind != Result || !strings.Contains(string(result.Data), `"bytes":3`) {
		t.Fatal(result, err)
	}
	if _, err := io.ReadAll(&input); err != nil {
		t.Fatal(err)
	}
}
func TestMissingOrStaleCommitAckCannotAuthorizeMutation(t *testing.T) {
	for _, ack := range []map[string]any{nil, {"epoch": 2, "phase": "commit", "temporaryId": nil}, {"epoch": 1, "phase": "temporary", "temporaryId": nil}} {
		var input, output bytes.Buffer
		Write(&input, Request, requestBody("MKCOL"), true)
		if ack != nil {
			Write(&input, Ack, ack, true)
		}
		session := &Session{Source: &input, Sink: &output, JobID: "filejob-1234567890123456", WorkID: "work-1234567890123456", Epoch: 1}
		session.Start()
		if err := session.Prepare("commit", nil, nil, nil, nil, nil); err == nil || session.CommitGranted {
			t.Fatal("invalid ACK authorized mutation", ack)
		}
	}
}
