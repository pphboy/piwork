package client

import (
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"piwork/internal/contracts"
	"piwork/internal/sessionhistory"
	"strings"
	"unicode/utf8"
)

func (c *Client) HasHistory(ctx context.Context, work string) (bool, error) {
	var raw json.RawMessage
	err := c.Request(ctx, "GET", "/api/v1/works/"+url.PathEscape(work)+"/history-capabilities", nil, &raw)
	if err != nil {
		var failure *APIError
		if errors.As(err, &failure) && (failure.Status == 404 || failure.Status == 501) {
			return false, nil
		}
		return false, err
	}
	_, err = contracts.Decode[contracts.HistoryCapabilities](strings.NewReader(string(raw)), "HistoryCapabilitiesSchema", 8192)
	if err != nil {
		return false, &APIError{Code: "MALFORMED_RESPONSE", Text: "Core returned invalid history capabilities"}
	}
	return true, nil
}
func HistoryResponsePath(path string) string {
	if strings.Contains(path, "?") {
		return path + "&responseProfile=" + contracts.HistoryResponseProfile
	}
	return path + "?responseProfile=" + contracts.HistoryResponseProfile
}
func (c *Client) HistoryPage(ctx context.Context, work, session string, query contracts.HistoryQuery) (*contracts.HistoryPage, error) {
	path := "/api/v1/works/" + url.PathEscape(work) + "/sessions/" + url.PathEscape(session) + "/history"
	if values := sessionhistory.QueryValues(query); len(values) > 0 {
		path += "?" + values.Encode()
	}
	var raw json.RawMessage
	if err := c.Request(ctx, "GET", path, nil, &raw); err != nil {
		return nil, err
	}
	page, err := contracts.Decode[contracts.HistoryPage](strings.NewReader(string(raw)), "HistoryPageSchema", contracts.HistoryPageBytes)
	invalid := func() (*contracts.HistoryPage, error) {
		return nil, &APIError{Code: "MALFORMED_RESPONSE", Text: "Core returned inconsistent history ranges"}
	}
	if err != nil || string(page.Session.WorkId) != work || string(page.Session.SessionId) != session {
		return invalid()
	}
	if query.Snapshot.Present && page.SnapshotId != query.Snapshot.Value {
		return invalid()
	}
	if next, err := sessionhistory.Next(&page); err != nil || query.Cursor.Present && next == query.Cursor.Value {
		return invalid()
	}
	for _, run := range page.Runs {
		if string(run.WorkId) != work || string(run.SessionId) != session || query.RunId.Present && run.RunId != query.RunId.Value {
			return invalid()
		}
		if string(run.ResultRef) != "null" {
			var ref contracts.HistoryResultRef
			if json.Unmarshal(run.ResultRef, &ref) != nil || ref.WorkId != run.WorkId || ref.SessionId != run.SessionId || ref.RunId != run.RunId {
				return invalid()
			}
		}
	}
	for _, part := range page.Segments {
		if !utf8.ValidString(part.Text) || len(part.Text) > contracts.HistoryFragmentBytes || int64(part.ByteOffset)+int64(len(part.Text)) > int64(part.TotalBytes) || part.Complete != (int64(part.ByteOffset)+int64(len(part.Text)) == int64(part.TotalBytes)) || part.BlockCount < 1 || part.BlockIndex >= part.BlockCount {
			return invalid()
		}
		if query.RunId.Present && part.RunId != string(query.RunId.Value) {
			return invalid()
		}
	}
	return &page, nil
}
