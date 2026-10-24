package agentclient

import (
	"context"
	"encoding/json"
	"strings"
	"unicode/utf8"

	"google.golang.org/grpc"
	"piwork/internal/contracts"
	"piwork/internal/rpc/agentv1"
)

// WithHistoryProfile changes only the response representation of this borrowed
// channel. Admission and connection ownership remain with the original Client.
func (c *Client) WithHistoryProfile() *Client {
	value := *c
	value.responseProfile = contracts.HistoryResponseProfile
	return &value
}
func (c *Client) profile() *string {
	if c.responseProfile == "" {
		return nil
	}
	value := c.responseProfile
	return &value
}
func (c *Client) HistoryCapabilities(ctx context.Context) (*contracts.HistoryCapabilities, error) {
	return contentValue[contracts.HistoryCapabilities](ctx, c, c.rpc.GetSessionHistoryCapabilities, "", struct{}{}, "HistoryCapabilitiesSchema")
}
func (c *Client) ReadSessionPage(ctx context.Context, session string, query contracts.HistoryQuery) (*contracts.HistoryPage, error) {
	input, err := json.Marshal(query)
	if err != nil {
		return nil, err
	}
	response, err := c.rpc.ReadSessionPage(ctx, &agentv1.ReadSessionPageRequest{WorkId: c.scope.WorkID, SessionId: session, QueryJson: string(input)}, grpc.MaxCallRecvMsgSize(contracts.HistoryRpcBytes))
	if err != nil {
		return nil, err
	}
	value, err := contracts.Decode[contracts.HistoryPage](strings.NewReader(response.GetPageJson()), "HistoryPageSchema", contracts.HistoryPageBytes)
	if err != nil {
		return nil, ErrResponse
	}
	if string(value.Session.WorkId) != c.scope.WorkID || string(value.Session.SessionId) != session {
		return nil, ErrResponse
	}
	for _, run := range value.Runs {
		if string(run.WorkId) != c.scope.WorkID || string(run.SessionId) != session || query.RunId.Present && run.RunId != query.RunId.Value {
			return nil, ErrResponse
		}
		if string(run.ResultRef) != "null" {
			var ref contracts.HistoryResultRef
			if json.Unmarshal(run.ResultRef, &ref) != nil || ref.WorkId != run.WorkId || ref.SessionId != run.SessionId || ref.RunId != run.RunId {
				return nil, ErrResponse
			}
		}
	}
	for _, segment := range value.Segments {
		if !utf8.ValidString(segment.Text) || len(segment.Text) > contracts.HistoryFragmentBytes || segment.ByteOffset < 0 || segment.ByteOffset+contracts.WorkByteSize(len(segment.Text)) > segment.TotalBytes || segment.Complete != (segment.ByteOffset+contracts.WorkByteSize(len(segment.Text)) == segment.TotalBytes) || segment.BlockCount < 1 || segment.BlockIndex >= segment.BlockCount {
			return nil, ErrResponse
		}
		if segment.Type == "image" && !query.ImageProfile.Present {
			return nil, ErrResponse
		}
		if query.RunId.Present && segment.RunId != string(query.RunId.Value) {
			return nil, ErrResponse
		}
		if segment.RunId != "" {
			found := false
			for _, run := range value.Runs {
				if string(run.RunId) == segment.RunId {
					found = true
					break
				}
			}
			if !found {
				return nil, ErrResponse
			}
		}
	}
	var next string
	if string(value.NextCursor) != "null" && json.Unmarshal(value.NextCursor, &next) != nil {
		return nil, ErrResponse
	}
	if value.HasMore != (next != "") || value.HasMore && query.Cursor.Present && next == query.Cursor.Value {
		return nil, ErrResponse
	}
	raw, err := json.Marshal(value)
	if err != nil || len(raw)+1 > contracts.HistoryPageBytes {
		return nil, ErrResponse
	}
	return &value, nil
}

func (c *Client) validRun(run *agentv1.Run) bool {
	if !validRunMetadata(run) {
		return false
	}
	if c.responseProfile != "" && (run.ResultRefJson == nil || run.FinalText != "") {
		return false
	}
	if run.ResultRefJson != nil && run.GetResultRefJson() != "null" {
		ref, err := contracts.Decode[contracts.HistoryResultRef](strings.NewReader(run.GetResultRefJson()), "HistoryResultRefSchema", 8192)
		if err != nil || string(ref.WorkId) != run.WorkId || string(ref.SessionId) != run.SessionId || string(ref.RunId) != run.RunId {
			return false
		}
	}
	return true
}
