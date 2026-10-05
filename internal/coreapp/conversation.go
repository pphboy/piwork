package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"piwork/internal/agentclient"
	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/identity"
	"piwork/internal/internaltls"
	"piwork/internal/rpc/agentv1"
	"piwork/internal/workaccess"
	"piwork/internal/workruntime"
)

func conversationPath(r *http.Request) (workID, resource, item, action string, matched bool) {
	parts := strings.Split(strings.TrimPrefix(r.URL.EscapedPath(), "/"), "/")
	if len(parts) < 5 || len(parts) > 7 || parts[0] != "api" || parts[1] != "v1" || parts[2] != "works" || parts[4] != "sessions" && parts[4] != "runs" && parts[4] != "models" && parts[4] != "agent-requests" && parts[4] != "evidence" && parts[4] != "chat-capabilities" && parts[4] != "chat-models" && parts[4] != "commands" {
		return "", "", "", "", false
	}
	for i := 3; i < len(parts); i++ {
		decoded, err := url.PathUnescape(parts[i])
		if err != nil || decoded == "" || strings.ContainsAny(decoded, "/\\\x00") || decoded == "." || decoded == ".." {
			return "", "", "", "", false
		}
		parts[i] = decoded
	}
	workID, resource = parts[3], parts[4]
	if len(parts) > 5 {
		item = parts[5]
	}
	if len(parts) > 6 {
		action = parts[6]
	}
	return workID, resource, item, action, true
}

func (a *Application) conversation(w http.ResponseWriter, r *http.Request, actor identity.Principal, token string) (bool, error) {
	workID, resource, item, action, matched := conversationPath(r)
	if !matched {
		return false, nil
	}
	valid := chatControlRoute(r.Method, resource, item, action) || feedbackRoute(r.Method, resource, item, action) || resource == "models" && item == "" && action == "" && r.Method == "GET" || resource == "sessions" && item != "" && action == "model" && r.Method == "PATCH" || action == "" && (resource == "sessions" && (r.Method == "GET" || r.Method == "POST" && item == "") || resource == "runs" && (r.Method == "POST" && item == "" || r.Method == "GET" && item != "")) || resource == "runs" && item != "" && r.Method == "POST" && action == "cancel" || resource == "runs" && item != "" && r.Method == "GET" && action == "events"
	if !valid {
		return false, nil
	}
	authorized, cancel, err := a.Identity.WatchSession(r.Context(), token)
	if err != nil {
		return true, err
	}
	defer cancel()
	r = r.WithContext(authorized)
	work, err := workaccess.Work(r.Context(), a.Store, actor, workID, workaccess.Interact)
	if err != nil {
		return true, err
	}
	if work.DesiredState != "running" || work.ObservedState != "ready" && work.ObservedState != "degraded" || work.ActiveContextID == nil {
		return true, contracts.NewError("WORK_UNAVAILABLE", "")
	}
	var generation int64
	var instanceID, generationState string
	err = a.Store.Read(r.Context(), func(tx *sql.Tx) error {
		return tx.QueryRowContext(r.Context(), `SELECT generation,instance_id,state FROM runtime_generations WHERE work_id=? ORDER BY generation DESC LIMIT 1`, workID).Scan(&generation, &instanceID, &generationState)
	})
	if err != nil || generationState != "ready" || generation < 1 || instanceID == "" {
		return true, contracts.NewError("RUNTIME_UNAVAILABLE", "")
	}
	agent, routeLifetime, err := a.agentRoutes.Admission(internaltls.Scope{InstallationID: a.Store.InstallationID(), WorkID: workID, Generation: generation, InstanceID: instanceID}, *work.ActiveContextID)
	if err != nil {
		return true, contracts.NewError("RUNTIME_UNAVAILABLE", "")
	}
	routeRequest, cancelRoute := context.WithCancel(r.Context())
	defer cancelRoute()
	stopRouteWatch := context.AfterFunc(routeLifetime, cancelRoute)
	defer stopRouteWatch()
	r = r.WithContext(routeRequest)
	if resource == "agent-requests" || resource == "evidence" {
		return a.feedbackHTTP(w, r, agent, workID, resource, item, action)
	}
	if chatControlRoute(r.Method, resource, item, action) {
		if r.URL.RawQuery != "" {
			return true, contracts.NewError("INVALID_REQUEST", "")
		}
		version, err := agent.ChatControlsVersion(r.Context(), *work.ActiveContextID)
		if err != nil {
			return true, conversationError(err)
		}
		if resource == "chat-capabilities" {
			send(w, 200, map[string]any{"contractVersion": version})
			return true, nil
		}
		if version != 1 {
			return true, contracts.NewError("CHAT_OPTIONS_UNSUPPORTED", "")
		}
		var result any
		switch {
		case resource == "chat-models":
			result, err = agent.ListChatModels(r.Context())
		case resource == "commands":
			result, err = agent.ListSlashCommands(r.Context())
		case item == "submissions":
			if contracts.Validate("ChatSubmissionKeySchema", action) != nil {
				return true, contracts.NewError("INVALID_REQUEST", "")
			}
			kind := "run"
			if resource == "sessions" {
				kind = "session"
			}
			result, err = agent.LookupChatSubmission(r.Context(), kind, action)
		case r.Method == "GET":
			result, err = agent.GetSessionChatOptions(r.Context(), item)
		default:
			input, readErr := readControlJSON[contracts.SetSessionChatOptions](r, "SetSessionChatOptionsSchema", false)
			if readErr != nil {
				return true, readErr
			}
			release, lockErr := a.Store.BeginTransientMutation(r.Context(), workID)
			if lockErr != nil {
				return true, conversationError(lockErr)
			}
			defer release()
			result, err = agent.SetSessionChatOptions(r.Context(), item, input)
		}
		if err != nil {
			return true, conversationError(err)
		}
		send(w, 200, result)
		return true, nil
	}
	if resource == "models" {
		result, err := agent.ListRunModels(r.Context())
		if err != nil {
			return true, conversationError(err)
		}
		send(w, 200, result)
		return true, nil
	}
	if resource == "sessions" {
		if action == "model" {
			input, err := readControlJSON[contracts.SetSessionModel](r, "SetSessionModelSchema", false)
			if err != nil {
				return true, err
			}
			var ref *string
			if string(input.ModelRef) != "null" {
				var value string
				if json.Unmarshal(input.ModelRef, &value) != nil {
					return true, contracts.NewError("INVALID_REQUEST", "modelRef")
				}
				ref = &value
			}
			release, err := a.Store.BeginTransientMutation(r.Context(), workID)
			if err != nil {
				return true, conversationError(err)
			}
			defer release()
			session, err := agent.SetSessionModel(r.Context(), item, ref)
			if err != nil {
				return true, conversationError(err)
			}
			send(w, 200, sessionView(session))
			return true, nil
		}

		if r.Method == "POST" {
			var input struct {
				IdempotencyKey *string `json:"idempotencyKey"`
			}
			input, err = readJSON[struct {
				IdempotencyKey *string `json:"idempotencyKey"`
			}](r)
			if err != nil {
				return true, err
			}
			if input.IdempotencyKey == nil {
				return true, contracts.NewError("INVALID_REQUEST", "")
			}
			release, err := a.Store.BeginTransientMutation(r.Context(), workID)
			if err != nil {
				return true, conversationError(err)
			}
			defer release()
			session, err := agent.CreateSession(r.Context(), *input.IdempotencyKey)
			if err != nil {
				return true, conversationError(err)
			}
			send(w, 201, sessionView(session))
			return true, nil
		}
		if item != "" {
			history, err := agent.ReadSession(r.Context(), item)
			if err != nil {
				return true, conversationError(err)
			}
			messages := make([]any, 0, len(history.GetMessages()))
			for _, message := range history.GetMessages() {
				messages = append(messages, map[string]any{"entryId": message.GetEntryId(), "role": message.GetRole(), "text": message.GetText(), "createdAt": message.GetCreatedAt(), "runId": message.GetRunId(), "blocks": sessionBlocksView(message)})
			}
			runs := make([]any, 0, len(history.GetRuns()))
			for _, run := range history.GetRuns() {
				runs = append(runs, runView(run))
			}
			send(w, 200, map[string]any{"session": sessionView(history.GetSession()), "messages": messages, "runs": runs})
			return true, nil
		}
		list, err := agent.ListSessions(r.Context(), 1000, "")
		if err != nil {
			return true, conversationError(err)
		}
		items := make([]any, 0, len(list.GetSessions()))
		for _, session := range list.GetSessions() {
			items = append(items, sessionView(session))
		}
		send(w, 200, map[string]any{"sessions": items})
		return true, nil
	}
	if r.Method == "POST" && item == "" {
		input, err := readControlJSON[contracts.SubmitRunInput](r, "SubmitRunInputSchema", false)
		if err != nil {
			return true, err
		}
		if strings.TrimSpace(input.Prompt) == "" {
			return true, contracts.NewError("INVALID_REQUEST", "prompt")
		}
		var modelRef *string
		if input.ModelRef.Present {
			value := ""
			if !input.ModelRef.Null && json.Unmarshal(input.ModelRef.Value, &value) != nil {
				return true, contracts.NewError("INVALID_REQUEST", "modelRef")
			}
			modelRef = &value
		}
		release, err := a.Store.BeginTransientMutation(r.Context(), workID)
		if err != nil {
			return true, conversationError(err)
		}
		defer release()
		var modes []string
		if input.InputMode.Present {
			version, e := agent.ChatControlsVersion(r.Context(), *work.ActiveContextID)
			if e != nil {
				return true, conversationError(e)
			}
			if version != 1 {
				return true, contracts.NewError("CHAT_OPTIONS_UNSUPPORTED", "")
			}
			modes = append(modes, string(input.InputMode.Value))
		}
		result, err := agent.SubmitRun(r.Context(), string(input.SessionId), input.SubmissionKey, input.Prompt, modelRef, modes...)
		if err != nil {
			return true, conversationError(err)
		}
		send(w, 202, map[string]any{"run": runView(result.GetRun()), "reused": result.GetReused()})
		return true, nil
	}
	if action == "cancel" {
		input, err := readJSON[struct {
			IdempotencyKey *string `json:"idempotencyKey"`
		}](r)
		if err != nil {
			return true, err
		}
		if input.IdempotencyKey == nil {
			return true, contracts.NewError("INVALID_REQUEST", "")
		}
		release, err := a.Store.BeginTransientMutation(r.Context(), workID)
		if err != nil {
			return true, conversationError(err)
		}
		defer release()
		result, err := agent.CancelRun(r.Context(), item, *input.IdempotencyKey)
		if err != nil {
			return true, conversationError(err)
		}
		send(w, 200, runView(result))
		return true, nil
	}
	if action == "events" {
		return true, serveRunEvents(w, r, agent, item)
	}
	result, err := agent.GetRun(r.Context(), item)
	if err != nil {
		return true, conversationError(err)
	}
	send(w, 200, runView(result))
	return true, nil
}

func conversationError(err error) error {
	if errors.Is(err, corestore.ErrSnapshotBusy) {
		return contracts.NewError("WORK_SNAPSHOT_BUSY", "")
	}
	if errors.Is(err, agentclient.ErrResponse) || errors.Is(err, workruntime.ErrRouteUnavailable) {
		return contracts.NewError("RUNTIME_UNAVAILABLE", "")
	}
	if errors.Is(err, agentclient.ErrReadiness) {
		return contracts.NewError("WORK_UNAVAILABLE", "")
	}
	if state, ok := status.FromError(err); ok {
		for _, code := range []string{"CHAT_OPTIONS_UNSUPPORTED", "THINKING_LEVEL_UNSUPPORTED", "SLASH_COMMAND_UNKNOWN", "SLASH_COMMAND_UNSUPPORTED", "SLASH_COMMAND_UNAVAILABLE", "MODEL_UNAVAILABLE", "MODEL_NOT_SUPPORTED", "MODEL_LIST_UNAVAILABLE", "RUN_MODEL_SELECTION_UNSUPPORTED", "REQUEST_RETRY_NOT_ALLOWED", "REQUEST_EXPIRED", "REQUEST_CAPACITY_EXCEEDED", "SUBMIT_CONFLICT"} {
			if strings.HasPrefix(state.Message(), code+":") {
				return contracts.NewError(code, "")
			}
		}
	}
	switch status.Code(err) {
	case codes.Unimplemented:
		return contracts.NewError("CHAT_OPTIONS_UNSUPPORTED", "")
	case codes.InvalidArgument:
		return contracts.NewError("INVALID_REQUEST", "")
	case codes.FailedPrecondition:
		return contracts.NewError("WORK_UNAVAILABLE", "")
	case codes.NotFound:
		return contracts.NewError("NOT_FOUND", "")
	case codes.PermissionDenied:
		return contracts.NewError("PERMISSION_DENIED", "")
	case codes.AlreadyExists, codes.Aborted:
		return contracts.NewError("CONFLICT", "")
	case codes.ResourceExhausted:
		return contracts.NewError("RATE_LIMITED", "")
	case codes.OutOfRange:
		return contracts.NewError("CURSOR_EXPIRED", "")
	case codes.Unavailable, codes.DeadlineExceeded:
		return contracts.NewError("RUNTIME_UNAVAILABLE", "")
	default:
		return contracts.NewError("INTERNAL_ERROR", "")
	}
}

func sessionView(session *agentv1.Session) any {
	if session == nil {
		return nil
	}
	view := map[string]any{"thinkingLevel": thinkingView(session.GetThinkingLevel()), "workId": session.GetWorkId(), "sessionId": session.GetSessionId(), "sdkHistoryPath": session.GetSdkHistoryPath(), "createdAt": session.GetCreatedAt(), "updatedAt": session.GetUpdatedAt()}
	if session.GetModelPreferenceJson() != "" {
		view["modelPreference"] = decodePublicProjection(session.GetModelPreferenceJson())
	} else {
		view["modelPreference"] = nil
	}
	if session.GetSourceJson() != "" {
		view["source"] = decodePublicProjection(session.GetSourceJson())
	} else {
		view["source"] = map[string]any{"kind": "chat"}
	}
	return view
}

func runView(run *agentv1.Run) any {
	if run == nil {
		return nil
	}
	view := map[string]any{"thinkingLevel": thinkingView(run.GetThinkingLevel()), "workId": run.GetWorkId(), "sessionId": run.GetSessionId(), "runId": run.GetRunId(), "submissionKey": run.GetSubmissionKey(), "state": int32(run.GetState()), "promptDigest": run.GetPromptDigest(), "finalText": run.GetFinalText(), "acceptedAt": run.GetAcceptedAt(), "startedAt": run.GetStartedAt(), "finishedAt": run.GetFinishedAt(), "earliestAvailableSequence": strconv.FormatUint(run.GetEarliestAvailableSequence(), 10), "latestSequence": strconv.FormatUint(run.GetLatestSequence(), 10)}
	if run.GetActualModelJson() != "" {
		view["actualModel"] = decodePublicProjection(run.GetActualModelJson())
	} else {
		view["actualModel"] = nil
	}
	if run.GetSourceJson() != "" {
		view["source"] = decodePublicProjection(run.GetSourceJson())
	} else {
		view["source"] = map[string]any{"kind": "chat"}
	}
	view["adoptedExperienceVersion"] = run.GetAdoptedExperienceVersion()
	if failure := run.GetError(); failure != nil {
		view["error"] = map[string]any{"code": failure.GetCode(), "message": failure.GetMessage(), "retryable": failure.GetRetryable()}
	}
	return view
}

func runEventView(event *agentv1.RunEvent) any {
	view := map[string]any{"workId": event.GetWorkId(), "sessionId": event.GetSessionId(), "runId": event.GetRunId(), "sequence": strconv.FormatUint(event.GetSequence(), 10), "createdAt": event.GetCreatedAt()}
	if value := event.GetText(); value != nil {
		view["kind"] = map[string]any{"$case": "text", "text": map[string]any{"delta": value.GetDelta()}}
	} else if value := event.GetTool(); value != nil {
		view["kind"] = map[string]any{"$case": "tool", "tool": map[string]any{"serverId": value.GetServerId(), "toolName": value.GetToolName(), "toolCallId": value.GetToolCallId(), "phase": value.GetPhase(), "isError": value.GetIsError(), "result": decodePublicProjection(value.GetResultPreviewJson())}}
	} else if value := event.GetState(); value != nil {
		state := map[string]any{"state": int32(value.GetState()), "finalText": value.GetFinalText()}
		if failure := value.GetError(); failure != nil {
			state["error"] = map[string]any{"code": failure.GetCode(), "message": failure.GetMessage(), "retryable": failure.GetRetryable()}
		}
		view["kind"] = map[string]any{"$case": "state", "state": state}
	}
	return view
}

func decodePublicProjection(raw string) any {
	value, err := contracts.ParseJSON(strings.NewReader(raw), 1<<20)
	if err != nil {
		return nil
	}
	return value
}

func chatControlRoute(method, resource, item, action string) bool {
	return method == "GET" && item == "" && action == "" && (resource == "chat-capabilities" || resource == "chat-models" || resource == "commands") || (resource == "sessions" || resource == "runs") && item == "submissions" && action != "" && method == "GET" || resource == "sessions" && item != "" && action == "chat-options" && (method == "GET" || method == "PATCH")
}
func thinkingView(level string) string {
	if level == "" {
		return "off"
	}
	return level
}
func sessionBlocksView(message *agentv1.SessionMessage) []any {
	blocks := make([]any, 0, len(message.GetBlocks()))
	for _, block := range message.GetBlocks() {
		value := map[string]any{"blockId": block.GetBlockId(), "type": block.GetType()}
		if block.GetType() == "text" {
			value["text"] = block.GetText()
		} else {
			value["toolCallId"] = block.GetToolCallId()
			value["toolName"] = block.GetToolName()
			if block.GetType() == "tool-result" {
				value["result"] = decodePublicProjection(block.GetResultPreviewJson())
			}
		}
		blocks = append(blocks, value)
	}
	return blocks
}
