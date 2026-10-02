package filehelper

import (
	"bytes"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"golang.org/x/sys/unix"
	"piwork/internal/contracts"
	"piwork/internal/fileprotocol"
)

func helperRequest(action string, path ...string) map[string]any {
	return map[string]any{"version": 1, "jobId": "filejob-1234567890123456", "workId": "work-1234567890123456", "epoch": 1, "action": action, "pathSegments": path, "destinationSegments": nil, "depth": nil, "overwrite": nil, "conditions": map[string]any{"ifMatch": nil, "ifNoneMatch": nil, "ifModifiedSince": nil, "ifUnmodifiedSince": nil}, "range": nil, "expectedLength": nil}
}

type helperReply struct {
	Result   contracts.FileHelperResult
	Data     []byte
	Metadata []contracts.FileHelperMeta
	Errors   []contracts.FileHelperError
	Notices  []contracts.FileHelperPrepared
}

// The fake Core speaks the actual framed protocol. Hooks inject filesystem
// changes precisely while the helper is waiting for a durable permission ACK.
func runHelper(t *testing.T, root string, request map[string]any, upload []byte, hook func(contracts.FileHelperPrepared) map[string]any) helperReply {
	t.Helper()
	source, input := io.Pipe()
	output, sink := io.Pipe()
	defer source.Close()
	defer input.Close()
	defer output.Close()
	defer sink.Close()
	done := make(chan error, 1)
	go func() {
		session := &fileprotocol.Session{Source: source, Sink: sink, JobID: "filejob-1234567890123456", WorkID: "work-1234567890123456", Epoch: 1}
		parsed, err := session.Start()
		if err == nil {
			err = Handle(session, parsed, root)
		}
		if err != nil {
			_ = session.SendError(fileprotocol.Code(err), nil, true)
		}
		sink.Close()
		done <- err
	}()
	if err := fileprotocol.Write(input, fileprotocol.Request, request, true); err != nil {
		t.Fatal(err)
	}
	var reply helperReply
	for {
		frame, err := fileprotocol.Read(output, false)
		if err != nil {
			t.Fatal("helper ended without a terminal frame", err)
		}
		switch frame.Kind {
		case fileprotocol.Prepared:
			notice, err := fileprotocol.Decode[contracts.FileHelperPrepared](frame, "FileHelperPreparedSchema")
			if err != nil {
				t.Fatal(err)
			}
			reply.Notices = append(reply.Notices, notice)
			ack := map[string]any{"epoch": notice.Epoch, "phase": notice.Phase, "temporaryId": notice.TemporaryId}
			if hook != nil {
				if override := hook(notice); override != nil {
					ack = override
				}
			}
			if err := fileprotocol.Write(input, fileprotocol.Ack, ack, true); err != nil {
				t.Fatal(err)
			}
			if request["action"] == "PUT" && notice.Phase == "temporary" && string(notice.Device) != "null" {
				if err := fileprotocol.Write(input, fileprotocol.DataIn, upload, true); err != nil {
					t.Fatal(err)
				}
				if err := fileprotocol.Write(input, fileprotocol.End, map[string]any{}, true); err != nil {
					t.Fatal(err)
				}
			}
		case fileprotocol.Meta:
			value, err := fileprotocol.Decode[contracts.FileHelperMeta](frame, "FileHelperMetaSchema")
			if err != nil {
				t.Fatal(err)
			}
			reply.Metadata = append(reply.Metadata, value)
		case fileprotocol.DataOut:
			reply.Data = append(reply.Data, frame.Data...)
		case fileprotocol.Error:
			value, err := fileprotocol.Decode[contracts.FileHelperError](frame, "FileHelperErrorSchema")
			if err != nil {
				t.Fatal(err)
			}
			reply.Errors = append(reply.Errors, value)
			if string(value.PathSegments) == "null" {
				goto complete
			}
		case fileprotocol.Result:
			value, err := fileprotocol.Decode[contracts.FileHelperResult](frame, "FileHelperResultSchema")
			if err != nil {
				t.Fatal(err)
			}
			reply.Result = value
			goto complete
		default:
			t.Fatal("unexpected helper frame", frame.Kind)
		}
	}
complete:
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("helper goroutine did not finish")
	}
	return reply
}

func assertHelperError(t *testing.T, reply helperReply, code string) {
	t.Helper()
	if len(reply.Errors) != 1 || reply.Errors[0].Code != code || reply.Result.Status != 0 {
		t.Fatalf("want %s: %+v", code, reply)
	}
}
func assertFile(t *testing.T, root, name string, data []byte) {
	t.Helper()
	actual, err := os.ReadFile(filepath.Join(root, name))
	if err != nil || !bytes.Equal(actual, data) {
		t.Fatalf("file %s: %q %v, want %q", name, actual, err, data)
	}
}
func noTemporaries(t *testing.T, root string) {
	t.Helper()
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err == nil && strings.HasPrefix(entry.Name(), ".piwork-file-") {
			t.Error("abandoned temporary", path)
		}
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestFramedPutPermissionHardLinksAndUploadFailures(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "count"), []byte("old"), 0750); err != nil {
		t.Fatal(err)
	}
	if err := os.Link(filepath.Join(root, "count"), filepath.Join(root, "alias")); err != nil {
		t.Fatal(err)
	}
	binary := []byte{0, 255, 7, '\n'}
	reply := runHelper(t, root, helperRequest("PUT", "count"), binary, func(notice contracts.FileHelperPrepared) map[string]any {
		assertFile(t, root, "count", []byte("old"))
		return nil
	})
	if reply.Result.Status != 204 || reply.Result.Bytes != 4 || len(reply.Notices) != 3 {
		t.Fatal(reply)
	}
	assertFile(t, root, "count", binary)
	assertFile(t, root, "alias", []byte("old"))
	stat, _ := os.Stat(filepath.Join(root, "count"))
	if stat.Mode().Perm() != 0750 {
		t.Fatal("lost file mode")
	}
	for _, failure := range []string{"stale-ack", "wrong-length", "exists"} {
		request := helperRequest("PUT", "count")
		var hook func(contracts.FileHelperPrepared) map[string]any
		code := "FILE_BACKEND_PROTOCOL_ERROR"
		switch failure {
		case "stale-ack":
			hook = func(notice contracts.FileHelperPrepared) map[string]any {
				if notice.Phase == "commit" {
					return map[string]any{"epoch": 2, "phase": "commit", "temporaryId": nil}
				}
				return nil
			}
		case "wrong-length":
			request["expectedLength"] = 99
			code = "FILE_REQUEST_INVALID"
		case "exists":
			request["conditions"].(map[string]any)["ifNoneMatch"] = "*"
			code = "FILE_PRECONDITION_FAILED"
		}
		assertHelperError(t, runHelper(t, root, request, []byte("bad"), hook), code)
		assertFile(t, root, "count", binary)
		noTemporaries(t, root)
	}
}

func TestFramedPutNoOverwriteRaceAndParentReplacement(t *testing.T) {
	for _, replacement := range []bool{false, true} {
		root := t.TempDir()
		if err := os.Mkdir(filepath.Join(root, "dir"), 0755); err != nil {
			t.Fatal(err)
		}
		reply := runHelper(t, root, helperRequest("PUT", "dir", "target"), []byte("upload"), func(notice contracts.FileHelperPrepared) map[string]any {
			if notice.Phase == "commit" {
				if replacement {
					if err := os.Rename(filepath.Join(root, "dir"), filepath.Join(root, "old")); err != nil {
						t.Fatal(err)
					}
					if err := os.Mkdir(filepath.Join(root, "dir"), 0755); err != nil {
						t.Fatal(err)
					}
				}
				if err := os.WriteFile(filepath.Join(root, "dir", "target"), []byte("competitor"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			return nil
		})
		assertHelperError(t, reply, "FILE_CONFLICT")
		assertFile(t, root, "dir/target", []byte("competitor"))
		noTemporaries(t, root)
	}
}

func TestFramedNamespaceOperationsAndPreflight(t *testing.T) {
	root := t.TempDir()
	if result := runHelper(t, root, helperRequest("MKCOL", "中文"), nil, nil); result.Result.Status != 201 {
		t.Fatal(result)
	}
	if result := runHelper(t, root, helperRequest("PUT", "中文", "a.txt"), []byte("hello"), nil); result.Result.Status != 201 {
		t.Fatal(result)
	}
	copy := helperRequest("COPY", "中文")
	copy["destinationSegments"] = []string{"copied"}
	if result := runHelper(t, root, copy, nil, nil); result.Result.Status != 201 {
		t.Fatal(result)
	}
	assertFile(t, root, "copied/a.txt", []byte("hello"))
	move := helperRequest("MOVE", "copied", "a.txt")
	move["destinationSegments"] = []string{"moved.txt"}
	move["overwrite"] = false
	if result := runHelper(t, root, move, nil, nil); result.Result.Status != 201 {
		t.Fatal(result)
	}
	assertFile(t, root, "moved.txt", []byte("hello"))
	move = helperRequest("MOVE", "moved.txt")
	move["destinationSegments"] = []string{"中文", "a.txt"}
	move["overwrite"] = false
	assertHelperError(t, runHelper(t, root, move, nil, nil), "FILE_PRECONDITION_FAILED")
	move["overwrite"] = true
	if result := runHelper(t, root, move, nil, nil); result.Result.Status != 204 {
		t.Fatal(result)
	}
	if err := os.Symlink("/etc/passwd", filepath.Join(root, "中文", "link")); err != nil {
		t.Fatal(err)
	}
	assertHelperError(t, runHelper(t, root, helperRequest("DELETE", "中文"), nil, nil), "FILE_TYPE_UNSUPPORTED")
	assertFile(t, root, "中文/a.txt", []byte("hello"))
	if err := os.Remove(filepath.Join(root, "中文", "link")); err != nil {
		t.Fatal(err)
	}
	if result := runHelper(t, root, helperRequest("DELETE", "中文"), nil, nil); result.Result.Status != 204 {
		t.Fatal(result)
	}
	rootRequest := helperRequest("MKCOL")
	rootRequest["pathSegments"] = []string{}
	assertHelperError(t, runHelper(t, root, rootRequest, nil, nil), "FILE_ROOT_PROTECTED")
	noTemporaries(t, root)
}

func TestFramedMoveNoOverwriteRaceAndCopyPartialFailure(t *testing.T) {
	root := t.TempDir()
	os.WriteFile(filepath.Join(root, "source"), []byte("original"), 0600)
	move := helperRequest("MOVE", "source")
	move["destinationSegments"] = []string{"destination"}
	move["overwrite"] = false
	assertHelperError(t, runHelper(t, root, move, nil, func(notice contracts.FileHelperPrepared) map[string]any {
		if notice.Phase == "commit" {
			os.WriteFile(filepath.Join(root, "destination"), []byte("racing"), 0600)
		}
		return nil
	}), "FILE_PRECONDITION_FAILED")
	assertFile(t, root, "source", []byte("original"))
	assertFile(t, root, "destination", []byte("racing"))
	os.Mkdir(filepath.Join(root, "tree"), 0755)
	os.WriteFile(filepath.Join(root, "tree", "a"), []byte("safe"), 0600)
	copy := helperRequest("COPY", "tree")
	copy["destinationSegments"] = []string{"target"}
	reply := runHelper(t, root, copy, nil, func(notice contracts.FileHelperPrepared) map[string]any {
		if notice.Phase == "commit" {
			if err := os.Symlink("/etc/passwd", filepath.Join(root, "tree", "z")); err != nil {
				t.Fatal(err)
			}
		}
		return nil
	})
	if reply.Result.Status != 207 || len(reply.Errors) != 1 || reply.Errors[0].Code != "FILE_TYPE_UNSUPPORTED" {
		t.Fatal(reply)
	}
	assertFile(t, root, "target/a", []byte("safe"))
	if _, err := os.Lstat(filepath.Join(root, "target", "z")); !os.IsNotExist(err) {
		t.Fatal("copied symlink", err)
	}
	noTemporaries(t, root)
}

func TestFramedQueriesConditionsRangesAndCleanupIdentity(t *testing.T) {
	root := t.TempDir()
	os.WriteFile(filepath.Join(root, "data"), []byte("0123456789"), 0600)
	os.WriteFile(filepath.Join(root, "empty"), nil, 0600)
	request := helperRequest("GET", "data")
	request["range"] = map[string]any{"start": 2, "end": 5}
	if reply := runHelper(t, root, request, nil, nil); reply.Result.Status != 206 || string(reply.Data) != "2345" {
		t.Fatal(reply)
	}
	request["range"] = map[string]any{"suffix": 3}
	if reply := runHelper(t, root, request, nil, nil); string(reply.Data) != "789" {
		t.Fatal(reply)
	}
	request["conditions"].(map[string]any)["ifNoneMatch"] = "*"
	if reply := runHelper(t, root, request, nil, nil); reply.Result.Status != 304 || len(reply.Data) != 0 {
		t.Fatal(reply)
	}
	if reply := runHelper(t, root, helperRequest("HEAD", "data"), nil, nil); reply.Result.Status != 200 || len(reply.Data) != 0 || len(reply.Metadata) != 1 {
		t.Fatal(reply)
	}
	request = helperRequest("GET", "empty")
	request["range"] = map[string]any{"start": 0, "end": nil}
	assertHelperError(t, runHelper(t, root, request, nil, nil), "FILE_RANGE_UNSATISFIABLE")
	request = helperRequest("PROPFIND")
	request["pathSegments"] = []string{}
	request["depth"] = 1
	if reply := runHelper(t, root, request, nil, nil); reply.Result.Status != 207 || len(reply.Metadata) != 3 {
		t.Fatal(reply)
	}
	request["depth"] = "infinity"
	assertHelperError(t, runHelper(t, root, request, nil, nil), "FILE_DEPTH_UNSUPPORTED")
	var stat unix.Stat_t
	if err := unix.Stat(filepath.Join(root, "data"), &stat); err != nil {
		t.Fatal(err)
	}
	request = helperRequest("CLEANUP")
	request["pathSegments"] = []string{}
	request["temporaries"] = []any{map[string]any{"temporaryId": "filetemp-1234567890123456", "parentSegments": []string{}, "name": "data", "device": "0", "inode": "0"}}
	assertHelperError(t, runHelper(t, root, request, nil, nil), "FILE_CLEANUP_REQUIRED")
	assertFile(t, root, "data", []byte("0123456789"))
	// Device and inode are decimal strings even when greater than JS safe integers.
	request["temporaries"].([]any)[0].(map[string]any)["device"] = string(raw(uint64(stat.Dev)))
	request["temporaries"].([]any)[0].(map[string]any)["inode"] = string(raw(stat.Ino))
	if reply := runHelper(t, root, request, nil, nil); reply.Result.Status != 204 || reply.Result.Entries != 1 {
		t.Fatal(reply)
	}
}

func raw(value any) json.RawMessage { data, _ := json.Marshal(value); return data }
