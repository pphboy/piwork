package filehelper

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/sys/unix"
	"piwork/internal/fileprotocol"
)

func workspaceFixture(t *testing.T) (*Workspace, string) {
	t.Helper()
	directory := t.TempDir()
	workspace, err := OpenWorkspace(directory)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { workspace.Close() })
	return workspace, directory
}
func TestWorkspaceQueriesDoNotFollowLinksOrSpecialFiles(t *testing.T) {
	work, root := workspaceFixture(t)
	outside := t.TempDir()
	os.WriteFile(filepath.Join(outside, "secret"), []byte("outside"), 0600)
	os.WriteFile(filepath.Join(root, "中文.txt"), []byte("durable"), 0644)
	os.Mkdir(filepath.Join(root, "empty"), 0755)
	if err := os.Symlink(outside, filepath.Join(root, "parent-link")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(outside, "secret"), filepath.Join(root, "leaf-link")); err != nil {
		t.Fatal(err)
	}
	if err := unix.Mkfifo(filepath.Join(root, "fifo"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, parts := range [][]string{{"parent-link", "secret"}, {"leaf-link"}, {"fifo"}} {
		var body bytes.Buffer
		_, err := work.Read(parts, 0, nil, func(data []byte) error { _, err := body.Write(data); return err })
		if fileprotocol.Code(err) != "FILE_TYPE_UNSUPPORTED" || body.Len() != 0 {
			t.Fatal("unsafe object read", parts, err, body.String())
		}
	}
	entries, err := work.List(nil)
	if err != nil || len(entries) != 5 {
		t.Fatal(entries, err)
	}
	again, err := work.List(nil)
	if err != nil || len(again) != len(entries) {
		t.Fatal("directory offset leaked between requests", again, err)
	}
	kinds := map[string]string{}
	for _, entry := range entries {
		kinds[entry.PathSegments[0]] = entry.Kind
	}
	if kinds["leaf-link"] != "symlink" || kinds["fifo"] != "unsupported" || kinds["empty"] != "directory" || kinds["中文.txt"] != "file" {
		t.Fatal(kinds)
	}
	if _, err := work.openParent(nil, true); fileprotocol.Code(err) != "FILE_ROOT_PROTECTED" {
		t.Fatal("root mutation permitted", err)
	}
}
func TestWorkspacePinnedParentDetectsReplacement(t *testing.T) {
	work, root := workspaceFixture(t)
	os.Mkdir(filepath.Join(root, "parent"), 0755)
	parent, err := work.openDirectory([]string{"parent"})
	if err != nil {
		t.Fatal(err)
	}
	defer unix.Close(parent)
	if err := os.Rename(filepath.Join(root, "parent"), filepath.Join(root, "old-parent")); err != nil {
		t.Fatal(err)
	}
	os.Mkdir(filepath.Join(root, "parent"), 0755)
	if err := work.verifyParent(parent, []string{"parent"}); fileprotocol.Code(err) != "FILE_CONFLICT" {
		t.Fatal("changed parent accepted", err)
	}
}
func TestWorkspaceBoundedReadAndConcurrentFileChange(t *testing.T) {
	work, root := workspaceFixture(t)
	path := filepath.Join(root, "data")
	os.WriteFile(path, []byte("0123456789"), 0644)
	var body bytes.Buffer
	end := int64(5)
	count, err := work.Read([]string{"data"}, 2, &end, func(data []byte) error { _, err := body.Write(data); return err })
	if err != nil || count != 4 || body.String() != "2345" {
		t.Fatal("bounded span", count, body.String(), err)
	}
	_, err = work.Read([]string{"data"}, 0, nil, func([]byte) error { return os.WriteFile(path, []byte("changed"), 0644) })
	if fileprotocol.Code(err) != "FILE_CONFLICT" {
		t.Fatal("changing file reported success", err)
	}
	os.WriteFile(filepath.Join(root, "zero"), nil, 0644)
	count, err = work.Read([]string{"zero"}, 0, nil, func([]byte) error { t.Fatal("zero file emitted data"); return nil })
	if count != 0 || err != nil {
		t.Fatal(count, err)
	}
}
func TestWorkspacePathLimitsAndBoundedDirectory(t *testing.T) {
	for _, parts := range [][]string{{".."}, {""}, {"x/y"}, {"x\\y"}, {"nul\x00"}, {"\uffff"}, {string([]byte{255})}, strings.Split(strings.Repeat("a/", 129)+"a", "/")} {
		if err := ValidateSegments(parts); err == nil {
			t.Fatal("unsafe path accepted", parts)
		}
	}
	if err := ValidateSegments([]string{strings.Repeat("中", 86)}); fileprotocol.Code(err) != "FILE_PATH_TOO_LONG" {
		t.Fatal("UTF8 byte limit lost", err)
	}
	if err := ValidateSegments([]string{"中文", "%2e%2e", "a\tb\nc"}); err != nil {
		t.Fatal("valid filename changed", err)
	}
	work, root := workspaceFixture(t)
	for i := 0; i <= MaxEntries; i++ {
		file, err := os.CreateTemp(root, "entry-")
		if err != nil {
			t.Fatal(err)
		}
		file.Close()
	}
	if _, err := work.List(nil); fileprotocol.Code(err) != "FILE_LIMIT_EXCEEDED" {
		t.Fatal("directory limit bypassed", err)
	}
}
