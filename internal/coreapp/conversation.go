package coreapp

import (
	"context"
	"database/sql"
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
	if len(parts) < 5 || len(parts) > 7 || parts[0] != "api" || parts[1] != "v1" || parts[2] != "works" || parts[4] != "sessions" && parts[4] != "runs" {
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
	valid := action == "" && (resource == "sessions" && (r.Method == "GET" || r.Method == "POST" && item == "") || resource == "runs" && (r.Method == "POST" && item == "" || r.Method == "GET" && item != "")) || resource == "runs" && item != "" && r.Method == "POST" && action == "cancel" || resource == "runs" && item != "" && r.Method == "GET" && action == "events"
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
	if resource == "sessions" {
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
				messages = append(messages, map[string]any{"entryId": message.GetEntryId(), "role": message.GetRole(), "text": message.GetText(), "createdAt": message.GetCreatedAt()})
			}
			send(w, 200, map[string]any{"session": sessionView(history.GetSession()), "messages": messages})
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
		input, err := readJSON[struct {
			SessionID     *string `json:"sessionId"`
			SubmissionKey *string `json:"submissionKey"`
			Prompt        *string `json:"prompt"`
		}](r)
		if err != nil {
			return true, err
		}
		if input.SessionID == nil || input.SubmissionKey == nil || input.Prompt == nil {
			return true, contracts.NewError("INVALID_REQUEST", "")
		}
		release, err := a.Store.BeginTransientMutation(r.Context(), workID)
		if err != nil {
			return true, conversationError(err)
		}
		defer release()
		result, err := agent.SubmitRun(r.Context(), *input.SessionID, *input.SubmissionKey, *input.Prompt)
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
	switch status.Code(err) {
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
	return map[string]any{"workId": session.GetWorkId(), "sessionId": session.GetSessionId(), "sdkHistoryPath": session.GetSdkHistoryPath(), "createdAt": session.GetCreatedAt(), "updatedAt": session.GetUpdatedAt()}
}

func runView(run *agentv1.Run) any {
	if run == nil {
		return nil
	}
	view := map[string]any{"workId": run.GetWorkId(), "sessionId": run.GetSessionId(), "runId": run.GetRunId(), "submissionKey": run.GetSubmissionKey(), "state": int32(run.GetState()), "promptDigest": run.GetPromptDigest(), "finalText": run.GetFinalText(), "acceptedAt": run.GetAcceptedAt(), "startedAt": run.GetStartedAt(), "finishedAt": run.GetFinishedAt(), "earliestAvailableSequence": strconv.FormatUint(run.GetEarliestAvailableSequence(), 10), "latestSequence": strconv.FormatUint(run.GetLatestSequence(), 10)}
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
		view["kind"] = map[string]any{"$case": "tool", "tool": map[string]any{"serverId": value.GetServerId(), "toolName": value.GetToolName(), "toolCallId": value.GetToolCallId(), "phase": value.GetPhase(), "isError": value.GetIsError()}}
	} else if value := event.GetState(); value != nil {
		state := map[string]any{"state": int32(value.GetState()), "finalText": value.GetFinalText()}
		if failure := value.GetError(); failure != nil {
			state["error"] = map[string]any{"code": failure.GetCode(), "message": failure.GetMessage(), "retryable": failure.GetRetryable()}
		}
		view["kind"] = map[string]any{"$case": "state", "state": state}
	}
	return view
}
