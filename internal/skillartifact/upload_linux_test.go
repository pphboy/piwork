//go:build linux

package skillartifact

import (
	"bytes"
	"errors"
	"fmt"
	"testing"
)

func TestContentSnapshotExactByteLimits(t *testing.T) {
	data := bytes.Repeat([]byte{'x'}, maxFileBytes)
	files := []File{{Path: "SKILL.md", Data: data}}
	for i := 1; i < 4; i++ {
		files = append(files, File{Path: fmt.Sprintf("part-%d", i), Data: data})
	}
	snapshot, err := FromFiles("boundary-skill", files)
	if err != nil || snapshot.TotalBytes != maxTotalBytes || len(snapshot.Files) != 4 {
		t.Fatal("exact total and individual file byte limits were rejected", err)
	}
	files = append(files, File{Path: "over-total", Data: []byte{'x'}})
	if _, err := FromFiles("boundary-skill", files); !errors.Is(err, ErrUnsafeTree) {
		t.Fatal("one byte beyond total content limit was accepted", err)
	}
	if _, err := FromFiles("boundary-skill", []File{{Path: "SKILL.md", Data: append(data, 'x')}}); !errors.Is(err, ErrUnsafeTree) {
		t.Fatal("one byte beyond individual file limit was accepted", err)
	}
}
