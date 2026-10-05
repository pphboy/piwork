// Package agentclient is the Core side of the retained pi-agentd AgentService.
// Runtime admission supplies a Docker-inspected address and a durable agent
// generation; this package never accepts an address from an HTTP caller.
package agentclient

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/netip"
	"piwork/internal/contracts"
	"strconv"
	"strings"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"piwork/internal/internaltls"
	"piwork/internal/rpc/agentv1"
)

var ErrAddress = errors.New("agent private address is invalid")
var ErrReadiness = errors.New("agent readiness identity or contract does not match")
var ErrContextIncompatible = fmt.Errorf("agent context contract is incompatible: %w", ErrReadiness)
var ErrResponse = errors.New("agent response belongs to another Work")

type Client struct {
	scope internaltls.Scope
	conn  *grpc.ClientConn
	rpc   agentv1.AgentServiceClient
}

// Open binds an AgentService channel to one inspected Docker IP and one
// generation-scoped mTLS identity. A DNS name or caller-chosen port is rejected.
func Open(ctx context.Context, manager *internaltls.Manager, scope internaltls.Scope, ip string) (*Client, error) {
	address, err := netip.ParseAddr(ip)
	if manager == nil || err != nil || address.IsUnspecified() || address.IsLoopback() || address.IsMulticast() || scope.WorkID == "" || scope.Generation <= 0 || scope.InstanceID == "" {
		return nil, ErrAddress
	}
	config, err := manager.AgentClientConfig(ctx, scope)
	if err != nil {
		return nil, err
	}
	conn, err := grpc.NewClient(net.JoinHostPort(ip, strconv.Itoa(7443)), grpc.WithTransportCredentials(credentials.NewTLS(config)))
	if err != nil {
		return nil, err
	}
	return &Client{scope: scope, conn: conn, rpc: agentv1.NewAgentServiceClient(conn)}, nil
}

func (c *Client) Close() error { return c.conn.Close() }

func (c *Client) Readiness(ctx context.Context, contextID string, initializationOnly bool) (*agentv1.ReadinessResponse, error) {
	response, err := c.ObserveReadiness(ctx, contextID)
	if err != nil {
		return nil, err
	}
	if err := VerifyReadiness(c.scope, contextID, initializationOnly, response); err != nil {
		return nil, err
	}
	return response, nil
}

// ObserveReadiness permits inspection of a failed initialization while still
// requiring the exact admitted Work, generation, instance and context.
func (c *Client) ObserveReadiness(ctx context.Context, contextID string) (*agentv1.ReadinessResponse, error) {
	deadline, cancel := context.WithTimeout(ctx, time.Second)
	defer cancel()
	response, err := c.rpc.Readiness(deadline, &agentv1.ReadinessRequest{WorkId: c.scope.WorkID, Generation: uint64(c.scope.Generation), InstanceId: c.scope.InstanceID})
	if err != nil {
		return nil, err
	}
	if err := VerifyObservation(c.scope, contextID, response); err != nil {
		return nil, err
	}
	return response, nil
}

func VerifyReadiness(scope internaltls.Scope, contextID string, initializationOnly bool, response *agentv1.ReadinessResponse) error {
	if err := VerifyObservation(scope, contextID, response); err != nil {
		return err
	}
	if !response.GetInitializationComplete() || response.GetDraining() || (response.GetAcceptingRuns() == initializationOnly) {
		return ErrReadiness
	}
	return nil
}

func VerifyObservation(scope internaltls.Scope, contextID string, response *agentv1.ReadinessResponse) error {
	if response != nil && (response.GetProtocolVersion() != "v2" || response.GetContextContractVersion() != 1 || response.GetPackageContractVersion() != 1 || response.GetRunModelContractVersion() != 1 || response.GetWorkFeedbackContractVersion() != 1 || response.GetWorkHistorySchemaVersion() != 4) {
		return ErrContextIncompatible
	}
	if contextID == "" || response == nil || response.GetWorkId() != scope.WorkID || response.GetGeneration() != uint64(scope.Generation) || response.GetInstanceId() != scope.InstanceID || response.GetProtocolVersion() != "v2" || response.GetContextContractVersion() != 1 || response.GetPackageContractVersion() != 1 || response.GetRunModelContractVersion() != 1 || response.GetWorkFeedbackContractVersion() != 1 || response.GetWorkHistorySchemaVersion() != 4 || response.GetContextIdentity() != contextID {
		return ErrReadiness
	}
	return nil
}

// Chat controls are negotiated after the unchanged mandatory runtime handshake.
func (c *Client) ChatControlsVersion(ctx context.Context, contextID string) (uint32, error) {
	response, err := c.Readiness(ctx, contextID, false)
	if err != nil {
		return 0, err
	}
	if response.GetChatControlsContractVersion() == 1 {
		return 1, nil
	}
	return 0, nil
}

func (c *Client) PrepareConfigurationChange(ctx context.Context) (*agentv1.PrepareConfigurationChangeResponse, error) {
	return c.rpc.PrepareConfigurationChange(ctx, &agentv1.PrepareConfigurationChangeRequest{WorkId: c.scope.WorkID, Generation: uint64(c.scope.Generation), InstanceId: c.scope.InstanceID})
}

func (c *Client) Drain(ctx context.Context, timeout time.Duration) (bool, error) {
	if timeout <= 0 || timeout > 60*time.Second {
		return false, ErrReadiness
	}
	response, err := c.rpc.Drain(ctx, &agentv1.DrainRequest{WorkId: c.scope.WorkID, Generation: uint64(c.scope.Generation), InstanceId: c.scope.InstanceID, TimeoutMs: uint32(timeout.Milliseconds())})
	if err != nil {
		return false, err
	}
	return response.GetDrained(), nil
}

func (c *Client) CreateSession(ctx context.Context, key string) (*agentv1.Session, error) {
	response, err := c.rpc.CreateSession(ctx, &agentv1.CreateSessionRequest{WorkId: c.scope.WorkID, IdempotencyKey: key})
	if err != nil {
		return nil, err
	}
	if response.GetWorkId() != c.scope.WorkID || !validSessionMetadata(response) {
		return nil, ErrResponse
	}
	return response, nil
}

func (c *Client) ListSessions(ctx context.Context, size uint32, token string) (*agentv1.ListSessionsResponse, error) {
	response, err := c.rpc.ListSessions(ctx, &agentv1.ListSessionsRequest{WorkId: c.scope.WorkID, PageSize: size, PageToken: token})
	if err != nil {
		return nil, err
	}
	for _, session := range response.GetSessions() {
		if session.GetWorkId() != c.scope.WorkID || !validSessionMetadata(session) {
			return nil, ErrResponse
		}
	}
	return response, nil
}

func (c *Client) ReadSession(ctx context.Context, sessionID string) (*agentv1.SessionHistory, error) {
	response, err := c.rpc.ReadSession(ctx, &agentv1.ReadSessionRequest{WorkId: c.scope.WorkID, SessionId: sessionID})
	if err != nil {
		return nil, err
	}
	if response.GetSession().GetWorkId() != c.scope.WorkID || response.GetSession().GetSessionId() != sessionID || !validSessionMetadata(response.GetSession()) {
		return nil, ErrResponse
	}
	for _, run := range response.Runs {
		if run.WorkId != c.scope.WorkID || run.SessionId != sessionID || !validRunMetadata(run) {
			return nil, ErrResponse
		}
	}
	for _, message := range response.Messages {
		if message.GetRunId() != "" {
			found := false
			for _, run := range response.Runs {
				if run.RunId == message.RunId {
					found = true
				}
			}
			if !found {
				return nil, ErrResponse
			}
		}
		for _, block := range message.Blocks {
			value := map[string]any{"blockId": block.BlockId, "type": block.Type}
			if block.Type == "text" {
				value["text"] = block.Text
			} else {
				value["toolCallId"] = block.ToolCallId
				value["toolName"] = block.ToolName
				if block.Type == "tool-result" {
					result, e := contracts.ParseJSON(strings.NewReader(block.ResultPreviewJson), 1<<20)
					if e != nil {
						return nil, ErrResponse
					}
					value["result"] = result
				}
			}
			if contracts.Validate("SessionContentBlockSchema", value) != nil {
				return nil, ErrResponse
			}
		}
	}
	return response, nil
}

func (c *Client) SubmitRun(ctx context.Context, sessionID, key, prompt string, modelRef *string, modes ...string) (*agentv1.SubmitRunResponse, error) {
	var mode *string
	if len(modes) > 0 {
		mode = &modes[0]
	}
	response, err := c.rpc.SubmitRun(ctx, &agentv1.SubmitRunRequest{WorkId: c.scope.WorkID, SessionId: sessionID, SubmissionKey: key, Prompt: prompt, ModelRef: modelRef, InputMode: mode})
	if err != nil {
		return nil, err
	}
	if response.GetRun().GetWorkId() != c.scope.WorkID || response.GetRun().GetSessionId() != sessionID || response.GetRun().GetSubmissionKey() != key || !validRunMetadata(response.GetRun()) {
		return nil, ErrResponse
	}
	return response, nil
}

func (c *Client) GetRun(ctx context.Context, runID string) (*agentv1.Run, error) {
	response, err := c.rpc.GetRun(ctx, &agentv1.GetRunRequest{WorkId: c.scope.WorkID, RunId: runID})
	if err != nil {
		return nil, err
	}
	if response.GetWorkId() != c.scope.WorkID || response.GetRunId() != runID || !validRunMetadata(response) {
		return nil, ErrResponse
	}
	return response, nil
}

func (c *Client) CancelRun(ctx context.Context, runID, key string) (*agentv1.Run, error) {
	response, err := c.rpc.CancelRun(ctx, &agentv1.CancelRunRequest{WorkId: c.scope.WorkID, RunId: runID, IdempotencyKey: key})
	if err != nil {
		return nil, err
	}
	if response.GetWorkId() != c.scope.WorkID || response.GetRunId() != runID || !validRunMetadata(response) {
		return nil, ErrResponse
	}
	return response, nil
}

// WatchRun owns only this observer's stream. Cancelling ctx never sends a
// CancelRun RPC, so a disconnected browser cannot cancel accepted work.
func (c *Client) WatchRun(ctx context.Context, runID string, after *uint64, onEvent func(*agentv1.RunEvent) error) error {
	observer, cancel := context.WithCancel(ctx)
	defer cancel()
	stream, err := c.rpc.WatchRun(observer, &agentv1.WatchRunRequest{WorkId: c.scope.WorkID, RunId: runID, AfterSequence: after})
	if err != nil {
		return err
	}
	cursor := uint64(0)
	if after != nil {
		cursor = *after
	}
	for {
		event, err := stream.Recv()
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return err
		}
		if event.GetWorkId() != c.scope.WorkID || event.GetRunId() != runID || event.GetSequence() <= cursor {
			return ErrResponse
		}
		cursor = event.GetSequence()
		if tool := event.GetTool(); tool != nil && !publicJSON(tool.GetResultPreviewJson(), "ToolResultPreviewSchema") {
			return ErrResponse
		}
		if err := onEvent(event); err != nil {
			return err
		}
	}
}

func (c *Client) ListRunModels(ctx context.Context) (*contracts.RunModelList, error) {
	response, err := c.rpc.ListRunModels(ctx, &agentv1.AgentContentRequest{WorkId: c.scope.WorkID})
	if err != nil {
		return nil, err
	}
	value, err := contracts.Decode[contracts.RunModelList](strings.NewReader(response.GetValueJson()), "RunModelListSchema", 1<<20)
	if err != nil {
		return nil, ErrResponse
	}
	return &value, nil
}
func (c *Client) SetSessionModel(ctx context.Context, sessionID string, modelRef *string) (*agentv1.Session, error) {
	raw, _ := json.Marshal(map[string]any{"modelRef": modelRef})
	response, err := c.rpc.SetSessionModel(ctx, &agentv1.AgentContentRequest{WorkId: c.scope.WorkID, ObjectId: sessionID, InputJson: string(raw)})
	if err != nil {
		return nil, err
	}
	if response.GetWorkId() != c.scope.WorkID || response.GetSessionId() != sessionID || !validSessionMetadata(response) {
		return nil, ErrResponse
	}
	return response, nil
}
func publicJSON(raw, schema string) bool {
	if raw == "" {
		return true
	}
	value, err := contracts.ParseJSON(strings.NewReader(raw), 1<<20)
	return err == nil && contracts.Validate(schema, value) == nil
}
func validSessionMetadata(session *agentv1.Session) bool {
	if session != nil && session.ThinkingLevel != "" && contracts.Validate("ThinkingLevelSchema", session.ThinkingLevel) != nil {
		return false
	}
	if session == nil || !publicJSON(session.GetSourceJson(), "AgentRunSourceSchema") {
		return false
	}
	if session.GetModelPreferenceJson() == "" {
		return true
	}
	v, err := contracts.ParseJSON(strings.NewReader(session.GetModelPreferenceJson()), 1<<20)
	if err != nil {
		return false
	}
	pref, ok := v.(map[string]any)
	if !ok {
		return false
	}
	availability, exists := pref["availability"]
	if !exists || availability != "available" && availability != "unavailable" {
		return false
	}
	delete(pref, "availability")
	return contracts.Validate("RunModelDescriptionSchema", pref) == nil
}
func validRunMetadata(run *agentv1.Run) bool {
	if run != nil && run.ThinkingLevel != "" && contracts.Validate("ThinkingLevelSchema", run.ThinkingLevel) != nil {
		return false
	}
	return run != nil && publicJSON(run.GetActualModelJson(), "RunModelDescriptionSchema") && publicJSON(run.GetSourceJson(), "AgentRunSourceSchema")
}
