//go:build linux

package workhistory

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"net/url"
	"reflect"
	"regexp"
	"strings"

	"piwork/internal/contracts"
)

type historyRow map[string]any

var digestPattern = regexp.MustCompile(`^sha256:[a-f0-9]{64}$`)
var experienceEntry = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$`)
var experienceScope = regexp.MustCompile(`^(?:work|service:[a-zA-Z][a-zA-Z0-9_-]{0,63})$`)

// Read only fixed tables. All relationships are checked in memory, never by
// interpreting SQL or code stored in an imported database.
func validateBrainHistory(ctx context.Context, db *sql.DB, scope Scope) error {
	graph := map[string][]historyRow{}
	objects := map[string]map[string]historyRow{}
	for table, key := range map[string]string{"sessions": "session_id", "runs": "run_id", "service_events": "event_pk", "agent_requests": "request_id", "agent_request_runs": "run_id", "agent_evidence": "evidence_id", "brain_experience_revisions": "", "brain_experience_heads": "work_id", "run_events": ""} {
		rows, err := db.QueryContext(ctx, "SELECT * FROM "+table+" ORDER BY rowid")
		if err != nil {
			return ErrInvalid
		}
		columns, err := rows.Columns()
		if err != nil {
			rows.Close()
			return ErrInvalid
		}
		objects[table] = map[string]historyRow{}
		for rows.Next() {
			r, err := rowValues(rows, columns)
			if err != nil {
				rows.Close()
				return ErrInvalid
			}
			graph[table] = append(graph[table], r)
			if key != "" {
				objects[table][stringValue(r[key])] = r
			}
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return ErrInvalid
		}
	}
	parsed := map[string]map[string]any{}
	for table, rows := range graph {
		for _, r := range rows {
			fields := map[string]any{}
			for key, value := range r {
				if table != "run_events" && strings.HasSuffix(key, "_json") && value != nil {
					v, err := historyJSON(value)
					if err != nil {
						return ErrInvalid
					}
					fields[key] = v
				}
			}
			parsed[rowKey(table, r)] = fields
		}
	}
	field := func(table string, r historyRow, key string) any { return parsed[rowKey(table, r)][key] }
	candidateFor := func(request historyRow) map[string]any {
		return objectValue(field("agent_requests", request, "package_submission_json"))
	}
	proofsFor := func(requestID string) []historyRow {
		var found []historyRow
		for _, r := range graph["agent_evidence"] {
			if r["request_id"] == requestID {
				found = append(found, r)
			}
		}
		return found
	}
	latestRun := func(id string) string {
		last := ""
		for _, r := range graph["agent_request_runs"] {
			if r["request_id"] == id {
				last = stringValue(r["run_id"])
			}
		}
		return last
	}
	var adoption func(historyRow) bool
	adoption = func(proof historyRow) bool {
		if proof["kind"] != "sdk" || proof["verified"] != int64(1) || !nonempty(proof["request_id"]) || !nonempty(proof["run_id"]) || !nonempty(proof["code_version"]) {
			return false
		}
		req := objects["agent_requests"][stringValue(proof["request_id"])]
		candidate := candidateFor(req)
		target := objectValue(candidate["verificationTarget"])
		details := objectValue(field("agent_evidence", proof, "details_json"))
		run := objects["runs"][stringValue(proof["run_id"])]
		contextID := stringValue(run["context_identity"])
		if contracts.Validate("BrainVerificationTargetSchema", target) != nil || details == nil || run == nil || !scope.ContextIDs[contextID] || proof["object_ref"] != target["toolName"] {
			return false
		}
		receiptDigest := ""
		for _, r := range proofsFor(stringValue(proof["request_id"])) {
			d := objectValue(field("agent_evidence", r, "details_json"))
			if r["kind"] == "package" && d["candidateArtifactDigest"] != nil {
				v := stringValue(d["candidateArtifactDigest"])
				if !digestPattern.MatchString(v) || d["sourceDigest"] != candidate["expectedSourceDigest"] || d["requestId"] != proof["request_id"] || receiptDigest != "" && receiptDigest != v {
					return false
				}
				receiptDigest = v
			}
		}
		if receiptDigest == "" || details["verificationContractVersion"] != int64(1) || details["adoptionVerified"] != true || details["requestId"] != proof["request_id"] || details["runId"] != proof["run_id"] || details["toolName"] != target["toolName"] || details["artifactDigest"] != receiptDigest || details["contextIdentity"] != contextID || !nonempty(details["toolCallId"]) || !reflect.DeepEqual(details["verificationTarget"], target) || !reflect.DeepEqual(details["input"], target["input"]) {
			return false
		}
		checks := arrayValue(details["checks"])
		if contracts.Validate("BrainBehaviorChecksSchema", checks) != nil {
			return false
		}
		seen := map[string]bool{}
		for _, v := range checks {
			c := objectValue(v)
			name := stringValue(c["name"])
			if seen[name] || c["passed"] != true {
				return false
			}
			seen[name] = true
		}
		for _, name := range arrayValue(target["checkNames"]) {
			if !seen[stringValue(name)] {
				return false
			}
		}
		tool := stringValue(target["toolName"])
		tool = tool[strings.LastIndex(tool, ":")+1:]
		started, ended, count := false, false, 0
		for _, event := range graph["run_events"] {
			if event["run_id"] != proof["run_id"] || event["event_type"] != "tool-start" && event["event_type"] != "tool-end" {
				continue
			}
			v, err := historyJSON(event["payload_json"])
			if err != nil {
				return false
			}
			call := objectValue(v)
			if call["toolCallId"] != details["toolCallId"] {
				continue
			}
			count++
			if call["toolName"] == tool {
				if event["event_type"] == "tool-start" {
					started = reflect.DeepEqual(call["args"], target["input"])
				} else if call["isError"] == false {
					ended = true
				}
			}
		}
		return count == 2 && started && ended
	}
	for _, r := range graph["sessions"] {
		if v := field("sessions", r, "model_preference_json"); v != nil && !validHistoryModel(v) {
			return ErrInvalid
		}
		if v := field("sessions", r, "source_json"); v != nil && contracts.Validate("AgentRunSourceSchema", v) != nil {
			return ErrInvalid
		}
	}
	for _, r := range graph["runs"] {
		for key, schema := range map[string]string{"model_selector_json": "RunSubmissionSelectorSchema", "source_json": "AgentRunSourceSchema"} {
			if v := field("runs", r, key); v != nil && contracts.Validate(schema, v) != nil {
				return ErrInvalid
			}
		}
		if v := field("runs", r, "actual_model_json"); v != nil && !validHistoryModel(v) {
			return ErrInvalid
		}
		if !integer(r["adopted_experience_version"], 0) {
			return ErrInvalid
		}
	}
	for _, r := range graph["service_events"] {
		event := objectValue(field("service_events", r, "event_json"))
		origin := objectValue(event["origin"])
		raw, err := contracts.EncodeCanonicalJSON(event)
		if err != nil || contracts.Validate("ServiceEventSchema", event) != nil || len(raw) > 64<<10 {
			return ErrInvalid
		}
		digest := sha256.Sum256(raw)
		if event["eventId"] != r["event_id"] || origin["serviceId"] != r["source_service_id"] || r["disposition"] == "live" && origin["workId"] != scope.SourceWorkID || hex.EncodeToString(digest[:]) != r["event_digest"] {
			return ErrInvalid
		}
		if r["request_id"] != nil {
			req := objects["agent_requests"][stringValue(r["request_id"])]
			if req == nil || req["work_id"] != scope.SourceWorkID || req["source_event_pk"] != r["event_pk"] || req["source_service_id"] != r["source_service_id"] || event["type"] != "agent.requested" || req["goal"] != objectValue(event["payload"])["goal"] {
				return ErrInvalid
			}
		}
	}
	for _, r := range graph["agent_request_runs"] {
		run := objects["runs"][stringValue(r["run_id"])]
		req := objects["agent_requests"][stringValue(r["request_id"])]
		if run == nil || req == nil || run["work_id"] != scope.SourceWorkID || req["disposition"] == "historical" && r["disposition"] != "historical" {
			return ErrInvalid
		}
		source := objectValue(field("runs", run, "source_json"))
		if source == nil || source["requestId"] != r["request_id"] || source["phase"] != r["phase"] || source["kind"] != req["source_kind"] {
			return ErrInvalid
		}
	}
	for _, r := range graph["agent_evidence"] {
		details := objectValue(field("agent_evidence", r, "details_json"))
		if !nonempty(r["evidence_id"]) || !nonempty(r["object_ref"]) || !timestamp(r["observed_at"]) || r["kind"] == "event" && r["verified"] != int64(0) || r["details_json"] != nil && details == nil {
			return ErrInvalid
		}
		req := objects["agent_requests"][stringValue(r["request_id"])]
		run := objects["runs"][stringValue(r["run_id"])]
		if r["request_id"] != nil && req == nil || r["run_id"] != nil && (run == nil || run["work_id"] != scope.SourceWorkID || r["request_id"] != nil && objects["agent_request_runs"][stringValue(r["run_id"])]["request_id"] != r["request_id"]) {
			return ErrInvalid
		}
		if details["verificationContractVersion"] != nil && !adoption(r) || details["adoptionVerified"] == true && !adoption(r) {
			return ErrInvalid
		}
		if details["candidateArtifactDigest"] != nil {
			candidate := candidateFor(req)
			if r["kind"] != "package" || candidate == nil || details["requestId"] != r["request_id"] || details["sourceDigest"] != candidate["expectedSourceDigest"] || !digestPattern.MatchString(stringValue(details["candidateArtifactDigest"])) {
				return ErrInvalid
			}
		}
	}
	for _, r := range graph["agent_requests"] {
		if !nonempty(r["request_id"]) || !nonempty(r["submission_key"]) || !nonempty(r["request_digest"]) || !nonempty(r["goal"]) || len(stringValue(r["goal"])) > 8<<10 || !timestamp(r["expires_at"]) {
			return ErrInvalid
		}
		wait := field("agent_requests", r, "wait_ref_json")
		if wait != nil && contracts.Validate("AgentWaitRefSchema", wait) != nil {
			return ErrInvalid
		}
		candidate := candidateFor(r)
		if r["package_submission_json"] != nil && (candidate == nil || contracts.Validate("BrainCandidateSubmissionSchema", candidate) != nil || !scope.ContextIDs[stringValue(candidate["activeContextId"])]) {
			return ErrInvalid
		}
		if candidate != nil {
			owner := r
			seen := map[string]bool{}
			for candidate["requestId"] != owner["request_id"] {
				id := stringValue(owner["request_id"])
				if !nonempty(owner["retry_of"]) || seen[id] {
					return ErrInvalid
				}
				seen[id] = true
				owner = objects["agent_requests"][stringValue(owner["retry_of"])]
				if owner == nil || !reflect.DeepEqual(candidateFor(owner), candidate) {
					return ErrInvalid
				}
			}
		}
		if r["source_kind"] == "service" && (!nonempty(r["service_name"]) || !nonempty(r["source_service_id"])) {
			return ErrInvalid
		}
		if r["source_event_pk"] != nil && objects["service_events"][stringValue(r["source_event_pk"])]["request_id"] != r["request_id"] {
			return ErrInvalid
		}
		if r["source_run_id"] != nil && objects["runs"][stringValue(r["source_run_id"])]["work_id"] != scope.SourceWorkID {
			return ErrInvalid
		}
		if r["retry_of"] != nil {
			prior := objects["agent_requests"][stringValue(r["retry_of"])]
			if prior == nil || prior["request_id"] == r["request_id"] || prior["goal"] != r["goal"] || prior["source_kind"] != r["source_kind"] {
				return ErrInvalid
			}
		}
		refs, ok := field("agent_requests", r, "action_refs_json").([]any)
		if !ok || len(refs) > 100 {
			return ErrInvalid
		}
		seen := map[string]bool{}
		for _, v := range refs {
			ref := objectValue(v)
			key := stringValue(ref["serviceName"]) + ":" + stringValue(ref["actionId"])
			if ref == nil || seen[key] || !nonempty(ref["serviceName"]) || !nonempty(ref["actionId"]) || !nonempty(ref["actionName"]) || !nonempty(ref["verificationQuery"]) || !oneOf(ref["status"], "calling", "known", "unknown") || ref["expectedStateVersion"] != nil && !nonempty(ref["expectedStateVersion"]) || ref["jobId"] != nil && !nonempty(ref["jobId"]) {
				return ErrInvalid
			}
			seen[key] = true
		}
		if oneOf(r["state"], "waiting_result", "waiting_apply") && wait == nil || r["state"] == "waiting_apply" && objectValue(wait)["kind"] != "apply" {
			return ErrInvalid
		}
		if r["state"] == "completed" {
			proofs := proofsFor(stringValue(r["request_id"]))
			verified, adopted := false, false
			for _, p := range proofs {
				if p["verified"] != int64(1) {
					continue
				}
				details := objectValue(field("agent_evidence", p, "details_json"))
				query := p["kind"] == "query" && passedChecks(details["checks"])
				adopt := p["run_id"] == latestRun(stringValue(r["request_id"])) && adoption(p)
				pref := r["source_kind"] == "chat" && p["kind"] == "sdk" && p["run_id"] == r["source_run_id"] && details["userPreferenceVerified"] == true && objects["runs"][stringValue(p["run_id"])]["prompt_digest"] == details["promptDigest"]
				verified = verified || query || adopt || pref
				adopted = adopted || adopt
			}
			if !verified || candidate != nil && !adopted {
				return ErrInvalid
			}
			for _, v := range refs {
				ref := objectValue(v)
				known, checked := false, false
				for _, p := range proofs {
					if p["verified"] != int64(1) || p["service_name"] != ref["serviceName"] {
						continue
					}
					details := objectValue(field("agent_evidence", p, "details_json"))
					job := p["kind"] == "job" && nonempty(ref["jobId"]) && p["object_ref"] == ref["jobId"] && details["jobId"] == ref["jobId"] && details["actionId"] == ref["actionId"]
					known = known || (p["kind"] == "action" && p["object_ref"] == ref["actionId"] || job) && oneOf(details["state"], "succeeded", "failed", "cancelled")
					checked = checked || p["kind"] == "query" && p["object_ref"] == ref["verificationQuery"] && passedChecks(details["checks"])
				}
				if ref["status"] != "known" || !known || !checked {
					return ErrInvalid
				}
			}
		}
	}
	versions := map[int64][]historyRow{}
	for _, r := range graph["brain_experience_revisions"] {
		req := objects["agent_requests"][stringValue(r["source_request_id"])]
		refs, ok := field("brain_experience_revisions", r, "evidence_ids_json").([]any)
		if req == nil || !experienceEntry.MatchString(stringValue(r["entry_id"])) || !experienceScope.MatchString(stringValue(r["scope"])) || !nonempty(r["rule"]) || len(stringValue(r["rule"])) > 4<<10 || !ok || len(refs) > 100 || r["status"] == "effective" && req["state"] != "completed" || len(refs) == 0 && req["source_kind"] != "chat" {
			return ErrInvalid
		}
		for _, id := range refs {
			proof := objects["agent_evidence"][stringValue(id)]
			if !nonempty(id) || proof == nil || proof["request_id"] != req["request_id"] || proof["kind"] == "event" || r["status"] == "effective" && proof["verified"] != int64(1) {
				return ErrInvalid
			}
		}
		version, ok := r["version"].(int64)
		if !ok {
			return ErrInvalid
		}
		versions[version] = append(versions[version], r)
	}
	checkVersion := func(version int64) bool {
		if version == 0 {
			return true
		}
		rows := versions[version]
		if len(rows) == 0 || len(rows) > 100 {
			return false
		}
		for _, r := range rows {
			if r["status"] != "effective" {
				return false
			}
		}
		return true
	}
	for _, r := range graph["brain_experience_heads"] {
		v, ok := r["version"].(int64)
		if !ok || !checkVersion(v) {
			return ErrInvalid
		}
	}
	for _, r := range graph["runs"] {
		if !checkVersion(r["adopted_experience_version"].(int64)) {
			return ErrInvalid
		}
	}
	return nil
}

func rowKey(table string, r historyRow) string {
	switch table {
	case "sessions":
		return table + ":" + stringValue(r["session_id"])
	case "runs", "agent_request_runs":
		return table + ":" + stringValue(r["run_id"])
	case "run_events":
		return table + ":" + stringValue(r["run_id"]) + ":" + fmt.Sprint(r["sequence"])
	case "agent_requests":
		return table + ":" + stringValue(r["request_id"])
	case "service_events":
		return table + ":" + stringValue(r["event_pk"])
	case "agent_evidence":
		return table + ":" + stringValue(r["evidence_id"])
	case "brain_experience_revisions":
		return table + ":" + fmt.Sprint(r["version"]) + ":" + stringValue(r["entry_id"])
	default:
		return table + ":" + stringValue(r["work_id"])
	}
}
func historyJSON(value any) (any, error) {
	text, ok := value.(string)
	if !ok {
		return nil, ErrInvalid
	}
	return contracts.ParseJSON(strings.NewReader(text), 64<<20)
}
func objectValue(v any) map[string]any { r, _ := v.(map[string]any); return r }
func arrayValue(v any) []any           { r, _ := v.([]any); return r }
func stringValue(v any) string         { r, _ := v.(string); return r }
func oneOf(v any, allowed ...string) bool {
	for _, s := range allowed {
		if v == s {
			return true
		}
	}
	return false
}
func passedChecks(v any) bool {
	checks, ok := v.([]any)
	if !ok || len(checks) == 0 {
		return false
	}
	for _, v := range checks {
		if objectValue(v)["passed"] != true {
			return false
		}
	}
	return true
}
func validHistoryModel(value any) bool {
	model := objectValue(value)
	if model == nil {
		return false
	}
	description := map[string]any{}
	for key, v := range model {
		if key != "baseUrl" && key != "availability" && key != "thinkingLevel" {
			description[key] = v
		}
	}
	if contracts.Validate("RunModelDescriptionSchema", description) != nil {
		return false
	}
	if level, exists := model["thinkingLevel"]; exists && contracts.Validate("ThinkingLevelSchema", level) != nil {
		return false
	}
	if v, exists := model["availability"]; exists && !oneOf(v, "available", "unavailable") {
		return false
	}
	if v, exists := model["baseUrl"]; exists {
		s, ok := v.(string)
		if !ok {
			return false
		}
		u, err := url.Parse(s)
		if err != nil || !oneOf(u.Scheme, "http", "https") || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
			return false
		}
	}
	return true
}
