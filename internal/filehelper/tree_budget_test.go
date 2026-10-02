package filehelper

import (
	"os"
	"path/filepath"
	"testing"
)

func TestRecursiveExecutionBudgetBoundsGrowthAfterPreflight(t *testing.T) {
	for _, action := range []string{"COPY", "DELETE"} {
		t.Run(action, func(t *testing.T) {
			root := t.TempDir()
			if err := os.Mkdir(filepath.Join(root, "source"), 0700); err != nil {
				t.Fatal(err)
			}
			work, err := OpenWorkspace(root)
			if err != nil {
				t.Fatal(err)
			}
			defer work.Close()
			if count, _, err := work.preflight([]string{"source"}); err != nil || count != 1 {
				t.Fatal(count, err)
			}
			// Another writer adds an entry after the original preflight. Start at
			// the budget boundary to exercise actual traversal without 10k files.
			if err := os.WriteFile(filepath.Join(root, "source", "late"), []byte("retained"), 0600); err != nil {
				t.Fatal(err)
			}
			budget := &treeBudget{entries: MaxEntries - 1}
			var failures []TreeFailure
			if action == "COPY" {
				var size int64
				work.copyRecursive([]string{"source"}, []string{"target"}, nil, false, &failures, &size, budget)
			} else {
				work.deleteRecursive([]string{"source"}, &failures, budget)
			}
			if budget.entries != MaxEntries || !budget.exhausted || len(failures) != 1 || failures[0].Code != "FILE_LIMIT_EXCEEDED" {
				t.Fatal(budget, failures)
			}
			if contents, err := os.ReadFile(filepath.Join(root, "source", "late")); err != nil || string(contents) != "retained" {
				t.Fatal("late entry modified beyond budget", err)
			}
			if _, err := os.Stat(filepath.Join(root, "target", "late")); !os.IsNotExist(err) {
				t.Fatal("late entry copied beyond budget", err)
			}
		})
	}
}
