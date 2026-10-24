package client

import (
	"context"
	"encoding/json"
	"fmt"
	"piwork/internal/contracts"
	"piwork/internal/sessionhistory"
	"strings"
)

func (c *Client) HistoryResult(ctx context.Context, ref contracts.HistoryResultRef) (string, error) {
	q := contracts.HistoryQuery{Direction: contracts.Supplied("newer"), Content: contracts.Supplied("result"), RunId: contracts.Supplied(ref.RunId), Snapshot: ref.Snapshot}
	var out strings.Builder
	var block string
	var offset int64
	var complete bool
	for {
		page, err := c.HistoryPage(ctx, string(ref.WorkId), string(ref.SessionId), q)
		if err != nil {
			return "", err
		}
		if !q.Snapshot.Present {
			q.Snapshot = contracts.Supplied(page.SnapshotId)
		}
		for _, part := range page.Segments {
			if block != string(part.BlockId) {
				if block != "" && !complete {
					return "", &APIError{Code: "RESPONSE_INCOMPLETE", Text: "Saved result has a missing range"}
				}
				block = string(part.BlockId)
				offset = 0
			}
			if int64(part.ByteOffset) != offset {
				return "", &APIError{Code: "RESPONSE_INCOMPLETE", Text: "Saved result has a missing range"}
			}
			out.WriteString(part.Text)
			offset += int64(len(part.Text))
			complete = part.Complete
		}
		next, err := sessionhistory.Next(page)
		if err != nil {
			return "", err
		}
		if next == "" {
			if block != "" && !complete {
				return "", &APIError{Code: "RESPONSE_INCOMPLETE", Text: "Saved result is incomplete"}
			}
			return out.String(), nil
		}
		if q.Cursor.Present && q.Cursor.Value == next {
			return "", &APIError{Code: "MALFORMED_RESPONSE", Text: "History cursor did not advance"}
		}
		q.Cursor = contracts.Supplied(next)
	}
}

// CompleteHistoryRun reconstructs the legacy complete Run view locally. Large
// final text crosses the network only through bounded, validated history pages.
func (c *Client) CompleteHistoryRun(ctx context.Context, raw json.RawMessage) (json.RawMessage, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return nil, err
	}
	result, exists := fields["resultRef"]
	if !exists {
		return raw, nil
	}
	text := ""
	if string(result) != "null" {
		var ref contracts.HistoryResultRef
		if err := json.Unmarshal(result, &ref); err != nil {
			return nil, err
		}
		var work, session, run string
		if json.Unmarshal(fields["workId"], &work) != nil || json.Unmarshal(fields["sessionId"], &session) != nil || json.Unmarshal(fields["runId"], &run) != nil || string(ref.WorkId) != work || string(ref.SessionId) != session || string(ref.RunId) != run {
			return nil, &APIError{Code: "MALFORMED_RESPONSE", Text: "Result reference belongs to another Run"}
		}
		var err error
		text, err = c.HistoryResult(ctx, ref)
		if err != nil {
			return nil, err
		}
	}
	delete(fields, "resultRef")
	fields["finalText"], _ = json.Marshal(text)
	return json.Marshal(fields)
}

// StreamHistory reconstructs one original event at a time. Only a complete
// original event reaches consume, so its sequence remains a resumable cursor.
func (c *Client) StreamHistory(ctx context.Context, path string, consume func(json.RawMessage) error) error {
	var active string
	var offset, total int64
	var text strings.Builder
	err := c.StreamNDJSON(ctx, HistoryResponsePath(path), func(raw json.RawMessage) error {
		var event map[string]json.RawMessage
		if json.Unmarshal(raw, &event) != nil {
			return &APIError{Code: "MALFORMED_RESPONSE", Text: "Invalid Run event"}
		}
		var kind map[string]json.RawMessage
		if json.Unmarshal(event["kind"], &kind) != nil {
			return &APIError{Code: "MALFORMED_RESPONSE", Text: "Invalid Run event kind"}
		}
		var category string
		_ = json.Unmarshal(kind["$case"], &category)
		if category == "text" {
			var fragment struct {
				Delta                  string
				ByteOffset, TotalBytes json.Number
				Complete               *bool
			}
			if json.Unmarshal(kind["text"], &fragment) != nil || fragment.Complete == nil {
				return &APIError{Code: "MALFORMED_RESPONSE", Text: "Invalid Run event fragment"}
			}
			start, e1 := fragment.ByteOffset.Int64()
			length, e2 := fragment.TotalBytes.Int64()
			sequence := string(event["sequence"])
			if e1 != nil || e2 != nil || start != offset || start+int64(len(fragment.Delta)) > length || *fragment.Complete != (start+int64(len(fragment.Delta)) == length) || active != "" && (active != sequence || total != length) {
				return &APIError{Code: "RESPONSE_INCOMPLETE", Text: "Run event has a missing range"}
			}
			active = sequence
			total = length
			text.WriteString(fragment.Delta)
			offset += int64(len(fragment.Delta))
			if !*fragment.Complete {
				return nil
			}
			kind["text"], _ = json.Marshal(map[string]string{"delta": text.String()})
			active = ""
			offset = 0
			text.Reset()
		} else if active != "" {
			return &APIError{Code: "RESPONSE_INCOMPLETE", Text: "Run event was interrupted"}
		}
		if category == "state" {
			var state map[string]json.RawMessage
			if json.Unmarshal(kind["state"], &state) != nil {
				return &APIError{Code: "MALFORMED_RESPONSE", Text: "Invalid terminal event"}
			}
			if result, ok := state["resultRef"]; ok {
				final := ""
				if string(result) != "null" {
					var ref contracts.HistoryResultRef
					if json.Unmarshal(result, &ref) != nil {
						return &APIError{Code: "MALFORMED_RESPONSE", Text: "Invalid result reference"}
					}
					var work, session, run string
					_ = json.Unmarshal(event["workId"], &work)
					_ = json.Unmarshal(event["sessionId"], &session)
					_ = json.Unmarshal(event["runId"], &run)
					if string(ref.WorkId) != work || string(ref.SessionId) != session || string(ref.RunId) != run {
						return &APIError{Code: "MALFORMED_RESPONSE", Text: "Result reference belongs to another event"}
					}
					var err error
					final, err = c.HistoryResult(ctx, ref)
					if err != nil {
						return err
					}
				}
				delete(state, "resultRef")
				state["finalText"], _ = json.Marshal(final)
				kind["state"], _ = json.Marshal(state)
			}
		}
		event["kind"], _ = json.Marshal(kind)
		value, err := json.Marshal(event)
		if err != nil {
			return err
		}
		return consume(value)
	})
	if err != nil {
		return err
	}
	if active != "" {
		return &APIError{Code: "RESPONSE_INCOMPLETE", Text: fmt.Sprintf("Run event %s was incomplete; resume the original Run", active)}
	}
	return nil
}
