//go:build linux

package workhistory

import (
	"context"
	"fmt"
	"github.com/google/uuid"
	"os"
	"path/filepath"
	"reflect"
	"strings"

	"golang.org/x/sys/unix"
	"piwork/internal/contracts"
	"piwork/internal/workpackage"
)

// Rebuild remaps only managed Work/context columns. Run event payload_json,
// final_text, SDK locators/JSONL and every business file retain original bytes.
type RestoreBindings struct {
	Models     []map[string]any
	Operations map[string]string
}

func (s *Snapshot) Rebuild(ctx context.Context, targetDirectory, targetWorkID string, contexts map[string]string, bindings ...RestoreBindings) (returned error) {
	var binding RestoreBindings
	if len(bindings) > 1 {
		return ErrInvalid
	}
	if len(bindings) == 1 {
		binding = bindings[0]
	}

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
	definition := schemaSQL
	if s.SchemaVersion == 5 {
		definition = currentSchemaSQL
	}
	if _, err := target.ExecContext(ctx, definition); err != nil {
		return err
	}
	storeID := uuid.NewString()
	if s.SchemaVersion == 5 {
		if _, err := target.ExecContext(ctx, "ATTACH DATABASE ? AS memory", filepath.Join(staged, "memory.sqlite")); err != nil {
			return err
		}
		if _, err := target.ExecContext(ctx, "PRAGMA memory.journal_mode=DELETE; PRAGMA memory.synchronous=FULL;"); err != nil {
			return err
		}
		memoryDefinition := strings.ReplaceAll(strings.ReplaceAll(memorySchemaSQL, "CREATE TABLE ", "CREATE TABLE memory."), "CREATE INDEX ", "CREATE INDEX memory.")
		if _, err := target.ExecContext(ctx, memoryDefinition); err != nil {
			return err
		}
	}
	tx, err := target.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, "PRAGMA defer_foreign_keys=ON"); err != nil {
		return err
	}
	for _, table := range historyTables(s.SchemaVersion) {
		rows, err := s.database.QueryContext(ctx, "SELECT * FROM "+table)
		if err != nil {
			return err
		}
		defer rows.Close()
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
		defer statement.Close()
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
			if table == "work_memory_binding" {
				row["store_id"] = storeID
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
			if table == "service_events" || table == "agent_requests" || table == "agent_request_runs" {
				row["disposition"] = "historical"
			}
			if table == "agent_requests" {
				if row["package_submission_json"] != nil {
					v, err := historyJSON(row["package_submission_json"])
					if err != nil {
						return ErrInvalid
					}
					submission := objectValue(v)
					source := stringValue(submission["activeContextId"])
					mapped := contexts[source]
					if mapped == "" {
						return ErrInvalid
					}
					submission["activeContextId"] = mapped
					raw, err := contracts.EncodeCanonicalJSON(submission)
					if err != nil {
						return ErrInvalid
					}
					row["package_submission_json"] = string(raw)
				}
				if row["wait_ref_json"] != nil {
					v, err := historyJSON(row["wait_ref_json"])
					if err != nil {
						return ErrInvalid
					}
					wait := objectValue(v)
					if oneOf(wait["kind"], "package-operation", "apply") {
						mapped := binding.Operations[stringValue(wait["id"])]
						if mapped == "" {
							return ErrInvalid
						}
						wait["id"] = mapped
						raw, err := contracts.EncodeCanonicalJSON(wait)
						if err != nil {
							return ErrInvalid
						}
						row["wait_ref_json"] = string(raw)
					}
				}
			}
			if table == "agent_evidence" {
				if row["kind"] == "package" {
					if mapped := binding.Operations[stringValue(row["object_ref"])]; mapped != "" {
						row["object_ref"] = mapped
					}
				}
				if row["details_json"] != nil {
					v, err := historyJSON(row["details_json"])
					if err != nil {
						return ErrInvalid
					}
					details := objectValue(v)
					if details["verificationContractVersion"] == int64(1) {
						mapped := contexts[stringValue(details["contextIdentity"])]
						if mapped == "" {
							return ErrInvalid
						}
						details["contextIdentity"] = mapped
						raw, err := contracts.EncodeCanonicalJSON(details)
						if err != nil {
							return ErrInvalid
						}
						row["details_json"] = string(raw)
					}
				}
			}
			if table == "sessions" && row["model_preference_json"] != nil {
				v, err := historyJSON(row["model_preference_json"])
				if err != nil {
					return ErrInvalid
				}
				pref := objectValue(v)
				if !validHistoryModel(pref) {
					return ErrInvalid
				}
				matches := []map[string]any{}
				for _, model := range binding.Models {
					if !validHistoryModel(model) {
						return ErrInvalid
					}
					if model["provider"] == pref["provider"] && model["model"] == pref["model"] && reflect.DeepEqual(normalizedEndpoint(model["baseUrl"]), normalizedEndpoint(pref["baseUrl"])) {
						matches = append(matches, model)
					}
				}
				if pref["modelRef"] == nil {
					pref["availability"] = "available"
				} else if len(matches) == 1 {
					thinking, hasThinking := pref["thinkingLevel"]
					pref = map[string]any{}
					for key, value := range matches[0] {
						pref[key] = value
					}
					if hasThinking {
						pref["thinkingLevel"] = thinking
					}
					pref["availability"] = "available"
				} else {
					pref["availability"] = "unavailable"
				}
				raw, err := contracts.EncodeCanonicalJSON(pref)
				if err != nil {
					return ErrInvalid
				}
				row["model_preference_json"] = string(raw)
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
	if s.SchemaVersion == 5 {
		for _, table := range memoryTables {
			rows, err := s.database.QueryContext(ctx, "SELECT * FROM memory."+table)
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
			statement, err := tx.PrepareContext(ctx, "INSERT INTO memory."+table+"("+strings.Join(columns, ",")+") VALUES("+strings.Join(placeholders, ",")+")")
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
				if table == "memory_meta" {
					row["work_id"] = targetWorkID
					row["store_id"] = storeID
				}
				values := make([]any, len(columns))
				for i, key := range columns {
					values[i] = row[key]
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
		check, err := tx.QueryContext(ctx, "PRAGMA memory.foreign_key_check")
		if err != nil {
			return err
		}
		bad := check.Next()
		rowErr := check.Err()
		check.Close()
		if bad || rowErr != nil {
			return ErrInvalid
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
	if s.SchemaVersion == 5 {
		originalMemory, err := Regular(root, "memory.sqlite")
		if err != nil {
			return err
		}
		originalMemory.Close()
		memoryFile, err := Regular(stagedFD, "memory.sqlite")
		if err != nil {
			return err
		}
		memoryFD := int(memoryFile.Fd())
		if unix.Fchown(memoryFD, int(attributes.Uid), int(attributes.Gid)) != nil || unix.Fchmod(memoryFD, 0600) != nil || memoryFile.Sync() != nil {
			memoryFile.Close()
			return ErrInvalid
		}
		memoryFile.Close()
		if err := unix.Renameat(stagedFD, "memory.sqlite", root, "memory.sqlite"); err != nil {
			return err
		}
	}
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

func normalizedEndpoint(value any) any {
	if value == nil {
		return nil
	}
	text, ok := value.(string)
	if !ok {
		return value
	}
	endpoint, err := contracts.NormalizeModelEndpoint(&text)
	if err != nil {
		return value
	}
	return *endpoint
}
