//go:build linux

package workhistory

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/sys/unix"
	"piwork/internal/workpackage"
)

// Rebuild remaps only managed Work/context columns. Run event payload_json,
// final_text, SDK locators/JSONL and every business file retain original bytes.
func (s *Snapshot) Rebuild(ctx context.Context, targetDirectory, targetWorkID string, contexts map[string]string) (returned error) {
	defer func() {
		if returned != nil && ctx.Err() == nil {
			if _, ok := returned.(*Error); !ok {
				returned = ErrInvalid
			}
		}
	}()
	if s.database == nil || !nonempty(targetWorkID) || targetWorkID == s.scope.SourceWorkID || len(contexts) != len(s.scope.ContextIDs) {
		return ErrInvalid
	}
	seen := map[string]bool{}
	for source := range s.scope.ContextIDs {
		target := contexts[source]
		if !nonempty(target) || seen[target] {
			return ErrInvalid
		}
		seen[target] = true
	}
	root, err := workpackage.OpenDirectoryFD(targetDirectory)
	if err != nil {
		return err
	}
	defer unix.Close(root)
	main, err := Regular(root, files[0])
	if err != nil {
		return err
	}
	var attributes unix.Stat_t
	err = unix.Fstat(int(main.Fd()), &attributes)
	main.Close()
	if err != nil {
		return err
	}
	for _, name := range files[1:] {
		file, err := Regular(root, name)
		if err == nil {
			file.Close()
		} else if err != unix.ENOENT {
			return err
		}
	}
	staged, err := os.MkdirTemp(fmt.Sprintf("/proc/self/fd/%d", root), ".work-history-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(staged)
	path := filepath.Join(staged, files[0])
	target, err := database(path, false)
	if err != nil {
		return err
	}
	defer target.Close()
	if _, err := target.ExecContext(ctx, schemaSQL); err != nil {
		return err
	}
	tx, err := target.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, table := range tables {
		rows, err := s.database.QueryContext(ctx, "SELECT * FROM "+table)
		if err != nil {
			return err
		}
		columns, err := rows.Columns()
		if err != nil {
			rows.Close()
			return err
		}
		placeholders := make([]string, len(columns))
		for i := range placeholders {
			placeholders[i] = "?"
		}
		statement, err := tx.PrepareContext(ctx, "INSERT INTO "+table+"("+strings.Join(columns, ",")+") VALUES("+strings.Join(placeholders, ",")+")")
		if err != nil {
			rows.Close()
			return err
		}
		for rows.Next() {
			row, err := rowValues(rows, columns)
			if err != nil {
				statement.Close()
				rows.Close()
				return err
			}
			if _, exists := row["work_id"]; exists {
				row["work_id"] = targetWorkID
			}
			for _, column := range []string{"active_context_identity", "context_identity"} {
				if source, ok := row[column].(string); ok {
					mapped, exists := contexts[source]
					if !exists {
						statement.Close()
						rows.Close()
						return ErrInvalid
					}
					row[column] = mapped
				}
			}
			values := make([]any, len(columns))
			for i, column := range columns {
				values[i] = row[column]
			}
			if _, err := statement.ExecContext(ctx, values...); err != nil {
				statement.Close()
				rows.Close()
				return err
			}
		}
		rowErr := rows.Err()
		statement.Close()
		rows.Close()
		if rowErr != nil {
			return rowErr
		}
	}
	foreign, err := tx.QueryContext(ctx, "PRAGMA foreign_key_check")
	if err != nil {
		return err
	}
	hasForeign := foreign.Next()
	foreignErr := foreign.Err()
	foreign.Close()
	if hasForeign || foreignErr != nil {
		return ErrInvalid
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	if err := target.Close(); err != nil {
		return err
	}
	file, err := os.OpenFile(path, os.O_RDONLY|unix.O_NOFOLLOW|unix.O_NONBLOCK, 0)
	if err != nil {
		return err
	}
	fd := int(file.Fd())
	if unix.Fchown(fd, int(attributes.Uid), int(attributes.Gid)) != nil || unix.Fchmod(fd, attributes.Mode&07777) != nil || file.Sync() != nil {
		file.Close()
		return ErrInvalid
	}
	if err := file.Close(); err != nil {
		return err
	}
	stagedFD, err := workpackage.OpenDirectoryFD(filepath.Join(targetDirectory, filepath.Base(staged)))
	if err != nil {
		return err
	}
	defer unix.Close(stagedFD)
	if err := unix.Renameat(stagedFD, files[0], root, files[0]); err != nil {
		return err
	}
	for _, name := range files[1:] {
		if err := unix.Unlinkat(root, name, 0); err != nil && err != unix.ENOENT {
			return err
		}
	}
	if err := unix.Fsync(stagedFD); err != nil {
		return err
	}
	return unix.Fsync(root)
}
