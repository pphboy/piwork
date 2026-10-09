//go:build linux

package workhistory

import (
	"context"
	"database/sql"
	_ "embed"
	"encoding/json"
	"fmt"
	"reflect"
	"strings"

	"piwork/internal/contracts"
)

//go:embed schema.sql
var currentSchemaSQL string

//go:embed schema-objects.json
var currentSchemaObjects []byte

//go:embed memory-schema.sql
var memorySchemaSQL string

//go:embed memory-schema-objects.json
var memorySchemaObjects []byte

var memoryTables = []string{"memory_meta", "memory_versions", "memory_entries", "memory_candidates", "memory_head"}

func historyVersion(ctx context.Context, db *sql.DB) int64 {
	var version int64
	if db.QueryRowContext(ctx, "SELECT version FROM main.schema_migrations").Scan(&version) != nil {
		return 0
	}
	return version
}
func historyTables(version int64) []string {
	if version == 4 {
		return tables
	}
	result := append([]string{}, tables[:len(tables)-2]...)
	return append(result, "work_memory_binding")
}

func validateMemorySchema(ctx context.Context, db *sql.DB) error {
	var expected []schemaObject
	if json.Unmarshal(memorySchemaObjects, &expected) != nil {
		return ErrUnsupported
	}
	rows, err := db.QueryContext(ctx, "SELECT type,name,tbl_name,sql FROM memory.sqlite_master ORDER BY type,name")
	if err != nil {
		return ErrInvalid
	}
	defer rows.Close()
	var actual []schemaObject
	for rows.Next() {
		var r schemaObject
		if len(actual) >= len(expected) || rows.Scan(&r.Type, &r.Name, &r.Table, &r.SQL) != nil {
			return ErrUnsupported
		}
		actual = append(actual, r)
	}
	if rows.Err() != nil {
		return ErrInvalid
	}
	normalizeSchema(actual)
	normalizeSchema(expected)
	if !reflect.DeepEqual(actual, expected) {
		return ErrUnsupported
	}
	var integrity string
	if db.QueryRowContext(ctx, "PRAGMA memory.integrity_check").Scan(&integrity) != nil || integrity != "ok" {
		return ErrInvalid
	}
	check, err := db.QueryContext(ctx, "PRAGMA memory.foreign_key_check")
	if err != nil {
		return ErrInvalid
	}
	bad := check.Next()
	rowErr := check.Err()
	check.Close()
	if bad || rowErr != nil {
		return ErrInvalid
	}
	return nil
}

func normalizeSchema(items []schemaObject) {
	for i := range items {
		if items[i].SQL != nil {
			text := strings.Join(strings.Fields(*items[i].SQL), " ")
			items[i].SQL = &text
		}
	}
}

func validateMemoryHistory(ctx context.Context, db *sql.DB, scope Scope) error {
	if err := validateMemorySchema(ctx, db); err != nil {
		return err
	}
	graph := map[string][]historyRow{}
	total := 0
	for _, table := range memoryTables {
		rows, err := db.QueryContext(ctx, "SELECT * FROM memory."+table)
		if err != nil {
			return ErrInvalid
		}
		columns, err := rows.Columns()
		if err != nil {
			rows.Close()
			return ErrInvalid
		}
		for rows.Next() {
			total++
			if total > 1000000 {
				rows.Close()
				return ErrLimit
			}
			row, err := rowValues(rows, columns)
			if err != nil {
				rows.Close()
				return err
			}
			bytes := 0
			for key, v := range row {
				if text, ok := v.(string); ok {
					bytes += len(text)
				} else if v != nil && !integer(v, -contracts.MaxSafeInteger) {
					rows.Close()
					return ErrInvalid
				}
				if (key == "created_at" || key == "updated_at") && !timestamp(v) {
					rows.Close()
					return ErrInvalid
				}
			}
			if bytes > 64<<20 {
				rows.Close()
				return ErrLimit
			}
			graph[table] = append(graph[table], row)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return ErrInvalid
		}
	}
	if len(graph["memory_meta"]) != 1 || len(graph["memory_head"]) != 1 {
		return ErrInvalid
	}
	meta := graph["memory_meta"][0]
	var store string
	var count int
	if meta["work_id"] != scope.SourceWorkID || meta["schema_version"] != int64(1) || !nonempty(meta["store_id"]) ||
		db.QueryRowContext(ctx, "SELECT COUNT(*) FROM main.work_memory_binding").Scan(&count) != nil || count != 1 ||
		db.QueryRowContext(ctx, "SELECT store_id FROM main.work_memory_binding WHERE work_id=? AND memory_schema_version=1", scope.SourceWorkID).Scan(&store) != nil || store != meta["store_id"] {
		return ErrInvalid
	}
	versions := map[int64]bool{}
	published := map[int64]bool{}
	latestPublished := int64(-1)
	for _, r := range graph["memory_versions"] {
		if !integer(r["version"], 0) || r["published_at"] == nil && r["legacy"] != int64(1) || r["published_at"] != nil && !timestamp(r["published_at"]) {
			return ErrInvalid
		}
		versions[r["version"].(int64)] = true
		if r["published_at"] != nil {
			v := r["version"].(int64)
			published[v] = true
			if v > latestPublished {
				latestPublished = v
			}
		}
	}
	if !versions[0] || graph["memory_head"][0]["version"] != latestPublished || latestPublished < 0 {
		return ErrInvalid
	}
	entries := map[int64]map[string]historyRow{}
	for _, r := range graph["memory_entries"] {
		v, ok := r["version"].(int64)
		if !ok || v == 0 || !versions[v] || !oneOf(r["kind"], "preference", "experience", "knowledge") {
			return ErrInvalid
		}
		if entries[v] == nil {
			entries[v] = map[string]historyRow{}
		}
		entries[v][stringValue(r["entry_id"])] = r
		if r["kind"] == "preference" {
			parsed, err := historyJSON(r["evidence_ids_json"])
			if err != nil {
				return ErrInvalid
			}
			if !memoryPreferenceProof(ctx, db, scope.SourceWorkID, stringValue(r["source_request_id"]), arrayValue(parsed)) {
				return ErrInvalid
			}
		}
		if len(entries[v]) > 100 {
			return ErrInvalid
		}
	}
	for _, r := range graph["memory_candidates"] {
		if !integer(r["base_version"], 0) || !versions[r["base_version"].(int64)] || !integer(r["candidate_version"], 1) ||
			!experienceEntry.MatchString(stringValue(r["entry_id"])) || !experienceScope.MatchString(stringValue(r["scope"])) || !nonempty(r["rule"]) || len(stringValue(r["rule"])) > 4<<10 {
			return ErrInvalid
		}
		refs, err := historyJSON(r["evidence_ids_json"])
		ids, ok := refs.([]any)
		if err != nil || !ok || len(ids) > 100 {
			return ErrInvalid
		}
		var state, kind string
		if db.QueryRowContext(ctx, "SELECT state,source_kind FROM main.agent_requests WHERE work_id=? AND request_id=?", scope.SourceWorkID, r["source_request_id"]).Scan(&state, &kind) != nil || len(ids) == 0 && kind != "chat" {
			return ErrInvalid
		}
		for _, id := range ids {
			var verified int
			var proofKind string
			if !nonempty(id) || db.QueryRowContext(ctx, "SELECT verified,kind FROM main.agent_evidence WHERE work_id=? AND request_id=? AND evidence_id=?", scope.SourceWorkID, r["source_request_id"], id).Scan(&verified, &proofKind) != nil || proofKind == "event" || r["status"] == "effective" && verified != 1 {
				return ErrInvalid
			}
		}
		if r["operation"] == "invalidate" && (!nonempty(r["reason"]) || len(stringValue(r["reason"])) > 4<<10) {
			return ErrInvalid
		}
		if r["status"] == "effective" {
			if state != "completed" || !integer(r["published_version"], 1) || r["published_version"].(int64) <= r["base_version"].(int64) || !published[r["published_version"].(int64)] {
				return ErrInvalid
			}
			if r["kind"] == "preference" && !memoryPreferenceProof(ctx, db, scope.SourceWorkID, stringValue(r["source_request_id"]), ids) {
				return ErrInvalid
			}
			entry := entries[r["published_version"].(int64)][stringValue(r["entry_id"])]
			if r["operation"] == "invalidate" {
				if entry != nil {
					return ErrInvalid
				}
			} else if entry == nil || entry["rule"] != r["rule"] || entry["scope"] != r["scope"] || entry["source_request_id"] != r["source_request_id"] || entry["kind"] != r["kind"] || entry["created_at"] != r["created_at"] {
				return ErrInvalid
			}
			if entry != nil {
				actual, err := historyJSON(entry["evidence_ids_json"])
				if err != nil || !reflect.DeepEqual(actual, refs) {
					return ErrInvalid
				}
			}
		} else if r["published_version"] != nil {
			return ErrInvalid
		}
	}
	// A later publication copies unchanged entries. Validate each copy against
	// the upsert that applies to its snapshot, not only the original publication.
	// Migrated Experience may legitimately have no Memory candidate.
	for version, snapshot := range entries {
		for _, entry := range snapshot {
			var kind, scope, rule, evidence, source, created string
			err := db.QueryRowContext(ctx, `SELECT kind,scope,rule,evidence_ids_json,source_request_id,created_at
			 FROM memory.memory_candidates WHERE entry_id=? AND source_request_id=?
			 AND status='effective' AND operation='upsert' AND published_version<=?
			 ORDER BY published_version DESC LIMIT 1`, entry["entry_id"], entry["source_request_id"], version).
				Scan(&kind, &scope, &rule, &evidence, &source, &created)
			if err == sql.ErrNoRows {
				continue
			}
			if err != nil || entry["kind"] != kind || entry["scope"] != scope || entry["rule"] != rule || entry["source_request_id"] != source || entry["created_at"] != created {
				return ErrInvalid
			}
			actual, actualErr := historyJSON(entry["evidence_ids_json"])
			cited, citedErr := historyJSON(evidence)
			if actualErr != nil || citedErr != nil || !reflect.DeepEqual(actual, cited) {
				return ErrInvalid
			}
		}
	}
	rows, err := db.QueryContext(ctx, "SELECT adopted_experience_version,adopted_memory_selection_json,source_json FROM main.runs")
	if err != nil {
		return ErrInvalid
	}
	defer rows.Close()
	for rows.Next() {
		var version int64
		var raw, source sql.NullString
		if rows.Scan(&version, &raw, &source) != nil || !versions[version] {
			return ErrInvalid
		}
		if !raw.Valid {
			continue
		}
		value, err := historyJSON(raw.String)
		selection := objectValue(value)
		if err != nil || len(selection) != 3 {
			return ErrInvalid
		}
		ids, ok := selection["entryIds"].([]any)
		matched, matchOK := selection["matchedCount"].(int64)
		truncated, truncateOK := selection["truncated"].(bool)
		if !ok || len(ids) > 10 || !matchOK || matched < int64(len(ids)) || matched > 100 || !truncateOK || truncated != (matched > int64(len(ids))) {
			return ErrInvalid
		}
		seen := map[string]bool{}
		provided := []map[string]any{}
		var origin map[string]any
		if source.Valid {
			parsed, err := historyJSON(source.String)
			if err != nil {
				return ErrInvalid
			}
			origin = objectValue(parsed)
		}
		for _, id := range ids {
			name := stringValue(id)
			entry := entries[version][name]
			if name == "" || seen[name] || entry == nil || origin["kind"] == "service" && entry["scope"] != "work" && entry["scope"] != "service:"+stringValue(origin["serviceName"]) {
				return ErrInvalid
			}
			seen[name] = true
			refs, err := historyJSON(entry["evidence_ids_json"])
			if err != nil {
				return ErrInvalid
			}
			provided = append(provided, map[string]any{"entryId": name, "scope": entry["scope"], "rule": entry["rule"], "kind": entry["kind"], "evidenceIds": refs, "sourceRequestId": entry["source_request_id"], "createdAt": entry["created_at"]})
		}
		encoded, err := contracts.EncodeCanonicalJSON(provided)
		if err != nil || len(encoded) > 16<<10 {
			return ErrInvalid
		}
	}
	if rows.Err() != nil {
		return fmt.Errorf("%w", ErrInvalid)
	}
	return nil
}

func memoryPreferenceProof(ctx context.Context, db *sql.DB, workID, requestID string, evidenceIDs []any) bool {
	for _, id := range evidenceIDs {
		if !nonempty(id) {
			continue
		}
		var one int
		err := db.QueryRowContext(ctx, `SELECT 1 FROM main.agent_evidence e JOIN main.agent_requests q ON q.request_id=e.request_id
		 JOIN main.runs r ON r.run_id=e.run_id WHERE e.evidence_id=? AND e.work_id=? AND q.work_id=? AND r.work_id=?
		 AND q.request_id=? AND q.source_kind='chat' AND e.kind='sdk' AND e.verified=1 AND e.run_id=q.source_run_id
		 AND json_extract(e.details_json,'$.userPreferenceVerified')=1 AND json_extract(e.details_json,'$.promptDigest')=r.prompt_digest LIMIT 1`, id, workID, workID, workID, requestID).Scan(&one)
		if err == nil && one == 1 {
			return true
		}
	}
	return false
}
