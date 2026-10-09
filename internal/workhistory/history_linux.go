//go:build linux

// Package workhistory validates the exact managed schema-4/5 history and Memory databases in
// isolated snapshot helpers. SDK JSONL and business databases remain opaque.
package workhistory

import (
	"context"
	"database/sql"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"time"

	"golang.org/x/sys/unix"
	_ "modernc.org/sqlite"
	"piwork/internal/contracts"
	"piwork/internal/workpackage"
)

//go:embed schema-v4.sql
var schemaSQL string

//go:embed schema-v4-objects.json
var schemaObjects []byte
var tables = []string{"schema_migrations", "sessions", "runs", "run_events", "submit_idempotency", "session_idempotency", "work_activity", "service_events", "agent_requests", "agent_request_runs", "agent_evidence", "brain_experience_revisions", "brain_experience_heads"}
var files = []string{"work.sqlite", "work.sqlite-wal", "work.sqlite-shm"}

type Error struct{ Code string }

func (e *Error) Error() string { return e.Code }

var ErrInvalid = &Error{"SNAPSHOT_HISTORY_INVALID"}
var ErrBusy = &Error{"SNAPSHOT_HISTORY_BUSY"}
var ErrUnsupported = &Error{"SNAPSHOT_HISTORY_UNSUPPORTED"}
var ErrLimit = &Error{"SNAPSHOT_HISTORY_LIMIT"}

type Scope struct {
	SourceWorkID     string
	ContextIDs       map[string]bool
	ScratchDirectory string
	SDKPathIsRegular func(string) bool
}
type Summary struct {
	Sessions int64 `json:"sessions"`
	Runs     int64 `json:"runs"`
	Events   int64 `json:"events"`
}
type Snapshot struct {
	database      *sql.DB
	scratch       string
	spoolFD       int
	scope         Scope
	Summary       Summary
	SchemaVersion int64
}
type schemaObject struct {
	Type, Name string
	Table      string  `json:"tbl_name"`
	SQL        *string `json:"sql"`
}

func same(a, b unix.Stat_t) bool {
	return a.Dev == b.Dev && a.Ino == b.Ino && a.Mode == b.Mode && a.Uid == b.Uid && a.Gid == b.Gid && a.Size == b.Size && a.Nlink == b.Nlink && a.Mtim == b.Mtim && a.Ctim == b.Ctim
}
func Regular(root int, relative string) (*os.File, error) {
	parts := strings.Split(relative, "/")
	for _, part := range parts {
		if part == "" || part == "." || part == ".." || strings.ContainsRune(part, 0) {
			return nil, ErrInvalid
		}
	}
	parent, err := unix.Openat(root, ".", unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		return nil, err
	}
	for _, part := range parts[:len(parts)-1] {
		next, err := unix.Openat(parent, part, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
		unix.Close(parent)
		if err != nil {
			return nil, err
		}
		parent = next
	}
	fd, err := unix.Openat(parent, parts[len(parts)-1], unix.O_RDONLY|unix.O_NOFOLLOW|unix.O_NONBLOCK|unix.O_CLOEXEC, 0)
	unix.Close(parent)
	if err != nil {
		return nil, err
	}
	var info unix.Stat_t
	if unix.Fstat(fd, &info) != nil || info.Mode&unix.S_IFMT != unix.S_IFREG {
		unix.Close(fd)
		return nil, ErrInvalid
	}
	return os.NewFile(uintptr(fd), relative), nil
}
func copyFile(ctx context.Context, source *os.File, target string) error {
	var before unix.Stat_t
	if unix.Fstat(int(source.Fd()), &before) != nil || before.Size < 0 || before.Size > workpackage.DefaultLimits.PackageBytes {
		return ErrInvalid
	}
	file, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL|unix.O_NOFOLLOW, 0600)
	if err != nil {
		return ErrInvalid
	}
	defer file.Close()
	n, err := io.CopyBuffer(file, io.LimitReader(reader{ctx, source}, before.Size+1), make([]byte, 1<<20))
	if err != nil {
		return err
	}
	if n != before.Size || file.Sync() != nil {
		return ErrInvalid
	}
	var after unix.Stat_t
	if unix.Fstat(int(source.Fd()), &after) != nil || !same(before, after) {
		return ErrInvalid
	}
	return nil
}

type reader struct {
	ctx    context.Context
	source io.Reader
}

func (r reader) Read(raw []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.source.Read(raw)
}
func database(path string, readonly bool) (*sql.DB, error) {
	q := url.Values{"_pragma": []string{"foreign_keys(1)", "trusted_schema(0)", "busy_timeout(1000)"}, "mode": []string{"rwc"}}
	if readonly {
		q.Set("mode", "ro")
		q.Add("_pragma", "query_only(1)")
	} else {
		q.Add("_pragma", "journal_mode(DELETE)")
		q.Add("_pragma", "synchronous(FULL)")
	}
	db, err := sql.Open("sqlite", (&url.URL{Scheme: "file", Path: path, RawQuery: q.Encode()}).String())
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	return db, nil
}

func Open(ctx context.Context, privateDirectory string, scope Scope) (returned *Snapshot, returnedErr error) {
	defer func() {
		if returnedErr != nil {
			var own *Error
			if !errors.As(returnedErr, &own) && ctx.Err() == nil {
				returnedErr = ErrInvalid
			}
		}
	}()
	if !nonempty(scope.SourceWorkID) {
		return nil, ErrInvalid
	}
	root, err := workpackage.OpenDirectoryFD(privateDirectory)
	if err != nil {
		return nil, err
	}
	defer unix.Close(root)
	main, err := Regular(root, files[0])
	if errors.Is(err, unix.ENOENT) {
		for _, name := range append(append([]string{}, files[1:]...), "memory.sqlite", "memory.sqlite-journal", "work.sqlite-journal") {
			sidecar, err := Regular(root, name)
			if err == nil {
				sidecar.Close()
				return nil, ErrInvalid
			}
			if !errors.Is(err, unix.ENOENT) {
				return nil, ErrInvalid
			}
		}
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	defer main.Close()
	spool, err := workpackage.OpenDirectoryFD(scope.ScratchDirectory)
	if err != nil {
		return nil, err
	}
	scratch, err := os.MkdirTemp(fmt.Sprintf("/proc/self/fd/%d", spool), "work-history-")
	if err != nil {
		unix.Close(spool)
		return nil, err
	}
	snapshot := &Snapshot{scratch: scratch, spoolFD: spool, scope: scope}
	keep := false
	defer func() {
		if !keep {
			snapshot.Close()
		}
	}()
	var owner unix.Stat_t
	if unix.Fstat(spool, &owner) != nil || os.Chown(scratch, int(owner.Uid), int(owner.Gid)) != nil {
		return nil, ErrInvalid
	}
	if err := copyFile(ctx, main, filepath.Join(scratch, files[0])); err != nil {
		return nil, err
	}
	for _, name := range files[1:] {
		file, err := Regular(root, name)
		if errors.Is(err, unix.ENOENT) {
			continue
		}
		if err != nil {
			return nil, err
		}
		err = copyFile(ctx, file, filepath.Join(scratch, name))
		file.Close()
		if err != nil {
			return nil, err
		}
	}
	snapshot.database, err = database(filepath.Join(scratch, files[0]), true)
	if err != nil {
		return nil, err
	}
	if err := validateSchema(ctx, snapshot.database); err != nil {
		return nil, err
	}
	snapshot.SchemaVersion = historyVersion(ctx, snapshot.database)
	if snapshot.SchemaVersion == 5 {
		for _, name := range []string{"work.sqlite-journal", "memory.sqlite-journal"} {
			file, err := Regular(root, name)
			if err == nil {
				file.Close()
				return nil, ErrBusy
			}
			if !errors.Is(err, unix.ENOENT) {
				return nil, ErrInvalid
			}
		}
		file, err := Regular(root, "memory.sqlite")
		if err != nil {
			return nil, ErrInvalid
		}
		err = copyFile(ctx, file, filepath.Join(scratch, "memory.sqlite"))
		file.Close()
		if err != nil {
			return nil, err
		}
		uri := (&url.URL{Scheme: "file", Path: filepath.Join(scratch, "memory.sqlite"), RawQuery: "mode=ro"}).String()
		if _, err := snapshot.database.ExecContext(ctx, "ATTACH DATABASE ? AS memory", uri); err != nil {
			return nil, ErrInvalid
		}
		if err := validateMemorySchema(ctx, snapshot.database); err != nil {
			return nil, err
		}
	}
	var integrity string
	if err := snapshot.database.QueryRowContext(ctx, "PRAGMA integrity_check").Scan(&integrity); err != nil || integrity != "ok" {
		return nil, ErrInvalid
	}
	rows, err := snapshot.database.QueryContext(ctx, "PRAGMA foreign_key_check")
	if err != nil {
		return nil, err
	}
	foreign := rows.Next()
	rowErr := rows.Err()
	rows.Close()
	if foreign || rowErr != nil {
		return nil, ErrInvalid
	}
	snapshot.Summary, err = validateRows(ctx, snapshot.database, root, scope)
	if err != nil {
		return nil, err
	}
	keep = true
	return snapshot, nil
}
func (s *Snapshot) Close() error {
	var failures []error
	if s.database != nil {
		failures = append(failures, s.database.Close())
		s.database = nil
	}
	if s.scratch != "" {
		failures = append(failures, os.RemoveAll(s.scratch))
		s.scratch = ""
	}
	if s.spoolFD >= 0 {
		failures = append(failures, unix.Close(s.spoolFD))
		s.spoolFD = -1
	}
	return errors.Join(failures...)
}
func validateSchema(ctx context.Context, db *sql.DB) error {
	rows, err := db.QueryContext(ctx, "SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name")
	if err != nil {
		return ErrInvalid
	}
	defer rows.Close()
	var actual []schemaObject
	for rows.Next() {
		var r schemaObject
		if rows.Scan(&r.Type, &r.Name, &r.Table, &r.SQL) != nil {
			return ErrInvalid
		}
		actual = append(actual, r)
		if len(actual) > 100 {
			return ErrUnsupported
		}
	}
	if rows.Err() != nil {
		return ErrInvalid
	}
	normalizeSchema(actual)
	for index, raw := range [][]byte{schemaObjects, currentSchemaObjects} {
		var expected []schemaObject
		if json.Unmarshal(raw, &expected) != nil {
			return ErrUnsupported
		}
		normalizeSchema(expected)
		if reflect.DeepEqual(actual, expected) {
			if historyVersion(ctx, db) != int64(4+index) {
				return ErrUnsupported
			}
			return nil
		}
	}
	return ErrUnsupported
}
func nonempty(value any) bool {
	text, ok := value.(string)
	return ok && text != "" && !strings.ContainsRune(text, 0)
}
func timestamp(value any) bool {
	text, ok := value.(string)
	if !ok {
		return false
	}
	_, err := time.Parse(time.RFC3339Nano, text)
	return err == nil
}
func integer(value any, minimum int64) bool {
	n, ok := value.(int64)
	return ok && n >= minimum && n <= contracts.MaxSafeInteger
}
func rowValues(rows *sql.Rows, columns []string) (map[string]any, error) {
	values := make([]any, len(columns))
	targets := make([]any, len(columns))
	for i := range values {
		targets[i] = &values[i]
	}
	if rows.Scan(targets...) != nil {
		return nil, ErrInvalid
	}
	row := map[string]any{}
	for i, column := range columns {
		row[column] = values[i]
	}
	return row, nil
}
func validateRows(ctx context.Context, db *sql.DB, root int, scope Scope) (Summary, error) {
	counts := map[string]int64{}
	var count int64
	for _, table := range historyTables(historyVersion(ctx, db)) {
		rows, err := db.QueryContext(ctx, "SELECT * FROM "+table)
		if err != nil {
			return Summary{}, ErrInvalid
		}
		columns, err := rows.Columns()
		if err != nil {
			rows.Close()
			return Summary{}, ErrInvalid
		}
		for rows.Next() {
			count++
			counts[table]++
			if count > 1000000 {
				rows.Close()
				return Summary{}, ErrLimit
			}
			row, err := rowValues(rows, columns)
			if err != nil {
				rows.Close()
				return Summary{}, err
			}
			var bytes int64
			for _, value := range row {
				if text, ok := value.(string); ok {
					bytes += int64(len(text))
				} else if value != nil && !integer(value, -contracts.MaxSafeInteger) {
					rows.Close()
					return Summary{}, ErrInvalid
				}
			}
			if bytes > 64<<20 {
				rows.Close()
				return Summary{}, ErrLimit
			}
			if value, exists := row["work_id"]; exists && value != scope.SourceWorkID {
				rows.Close()
				return Summary{}, ErrInvalid
			}
			for _, field := range []string{"active_context_identity", "context_identity"} {
				if value, exists := row[field]; exists && value != nil {
					text, ok := value.(string)
					if !ok || !scope.ContextIDs[text] {
						rows.Close()
						return Summary{}, ErrInvalid
					}
				}
			}
			for _, field := range []string{"created_at", "updated_at", "accepted_at", "applied_at"} {
				if value, exists := row[field]; exists && !timestamp(value) {
					rows.Close()
					return Summary{}, ErrInvalid
				}
			}
			if err := validateRow(table, row, root, scope); err != nil {
				rows.Close()
				return Summary{}, err
			}
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return Summary{}, ErrInvalid
		}
	}
	if counts["schema_migrations"] != 1 {
		return Summary{}, ErrUnsupported
	}
	for _, query := range []string{`SELECT 1 FROM submit_idempotency i JOIN runs r ON r.run_id=i.run_id WHERE i.work_id!=r.work_id OR i.submission_key!=r.submission_key LIMIT 1`, `SELECT 1 FROM runs r LEFT JOIN run_events e ON e.run_id=r.run_id GROUP BY r.run_id HAVING COUNT(e.sequence)!=r.latest_sequence-r.earliest_available_sequence+1 OR (COUNT(e.sequence)>0 AND (MIN(e.sequence)!=r.earliest_available_sequence OR MAX(e.sequence)!=r.latest_sequence)) LIMIT 1`} {
		var value int
		err := db.QueryRowContext(ctx, query).Scan(&value)
		if !errors.Is(err, sql.ErrNoRows) {
			return Summary{}, ErrInvalid
		}
	}
	if historyVersion(ctx, db) == 5 {
		if err := validateMemoryHistory(ctx, db, scope); err != nil {
			return Summary{}, err
		}
	}
	if err := validateBrainHistory(ctx, db, scope); err != nil {
		return Summary{}, err
	}
	return Summary{counts["sessions"], counts["runs"], counts["run_events"]}, nil
}
func validateRow(table string, row map[string]any, root int, scope Scope) error {
	switch table {
	case "schema_migrations":
		if row["version"] != int64(4) && row["version"] != int64(5) {
			return ErrUnsupported
		}
	case "sessions":
		path, ok := row["sdk_history_path"].(string)
		if !nonempty(row["session_id"]) || !ok || !strings.HasPrefix(path, "/var/data/sessions/") {
			return ErrInvalid
		}
		if scope.SDKPathIsRegular != nil {
			if !scope.SDKPathIsRegular(path) {
				return ErrInvalid
			}
		} else {
			file, err := Regular(root, strings.TrimPrefix(path, "/var/data/"))
			if err != nil {
				return ErrInvalid
			}
			file.Close()
		}
	case "runs":
		switch row["state"] {
		case "succeeded", "failed", "cancelled", "interrupted":
		default:
			return ErrBusy
		}
		if !nonempty(row["run_id"]) || !nonempty(row["session_id"]) || !nonempty(row["submission_key"]) || !nonempty(row["prompt_digest"]) || !timestamp(row["finished_at"]) || (row["started_at"] != nil && !timestamp(row["started_at"])) || !integer(row["earliest_available_sequence"], 1) || !integer(row["latest_sequence"], 0) {
			return ErrInvalid
		}
		if row["latest_sequence"].(int64) < row["earliest_available_sequence"].(int64)-1 {
			return ErrInvalid
		}
	case "run_events":
		if !integer(row["sequence"], 1) || !nonempty(row["event_type"]) {
			return ErrInvalid
		}
		if _, ok := row["payload_json"].(string); !ok {
			return ErrInvalid
		}
	case "submit_idempotency":
		if !nonempty(row["submission_key"]) || !nonempty(row["request_digest"]) {
			return ErrInvalid
		}
	case "session_idempotency":
		if !nonempty(row["idempotency_key"]) {
			return ErrInvalid
		}
	case "work_activity":
		return ErrBusy
	}
	return nil
}
