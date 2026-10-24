// Package sessionhistory defines shared history transport rules; hosts retain authorization.
package sessionhistory

import (
	"encoding/json"
	"net/url"
	"piwork/internal/contracts"
	"strconv"
	"strings"
)

func ParseQuery(values url.Values) (contracts.HistoryQuery, error) {
	input := map[string]any{}
	for key, items := range values {
		if len(items) != 1 || items[0] == "" {
			return contracts.HistoryQuery{}, contracts.NewError("INVALID_REQUEST", "")
		}
		switch key {
		case "direction", "cursor", "snapshot", "runId", "content", "imageProfile":
			input[key] = items[0]
		case "limit":
			n, err := strconv.ParseInt(items[0], 10, 64)
			if err != nil {
				return contracts.HistoryQuery{}, contracts.NewError("INVALID_REQUEST", "limit")
			}
			input[key] = n
		default:
			return contracts.HistoryQuery{}, contracts.NewError("INVALID_REQUEST", "")
		}
	}
	raw, _ := json.Marshal(input)
	q, err := contracts.Decode[contracts.HistoryQuery](strings.NewReader(string(raw)), "HistoryQuerySchema", 8192)
	if err != nil {
		return q, contracts.NewError("INVALID_REQUEST", "")
	}
	if q.Content.Present && q.Content.Value == "result" && !q.RunId.Present {
		return q, contracts.NewError("INVALID_REQUEST", "runId")
	}
	return q, nil
}

func QueryValues(q contracts.HistoryQuery) url.Values {
	values := url.Values{}
	if q.Direction.Present {
		values.Set("direction", q.Direction.Value)
	}
	if q.Limit.Present {
		values.Set("limit", strconv.FormatInt(q.Limit.Value, 10))
	}
	if q.Cursor.Present {
		values.Set("cursor", q.Cursor.Value)
	}
	if q.Snapshot.Present {
		values.Set("snapshot", q.Snapshot.Value)
	}
	if q.RunId.Present {
		values.Set("runId", string(q.RunId.Value))
	}
	if q.Content.Present {
		values.Set("content", q.Content.Value)
	}
	if q.ImageProfile.Present {
		values.Set("imageProfile", q.ImageProfile.Value)
	}
	return values
}

func Next(page *contracts.HistoryPage) (string, error) {
	var next string
	if string(page.NextCursor) != "null" && json.Unmarshal(page.NextCursor, &next) != nil {
		return "", contracts.NewError("HISTORY_CORRUPT", "")
	}
	if page.HasMore != (next != "") {
		return "", contracts.NewError("HISTORY_CORRUPT", "")
	}
	return next, nil
}
