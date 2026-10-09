package cli

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"golang.org/x/term"
	"piwork/internal/client"
	"piwork/internal/contracts"
)

func validCLIId(value string) bool {
	return strings.TrimSpace(value) != "" && !strings.HasPrefix(value, "-") && !strings.ContainsRune(value, 0)
}

func validateUserSession(args []string) error {
	if len(args) >= 2 && validCLIId(args[1]) {
		if (args[0] == "create" || args[0] == "list") && len(args) == 2 {
			return nil
		}
		if args[0] == "show" && len(args) == 3 && validCLIId(args[2]) {
			return nil
		}
	}
	return errors.New("invalid session command; run piwork-cli --help")
}

func runUserSession(ctx context.Context, api *client.Client, args []string) (any, error) {
	base := "/api/v1/works/" + url.PathEscape(args[1]) + "/sessions"
	method, path := "GET", base
	var input any
	if args[0] == "create" {
		method = "POST"
		key, err := randomKey()
		if err != nil {
			return nil, err
		}
		input = map[string]string{"idempotencyKey": key}
	} else if args[0] == "show" {
		path += "/" + url.PathEscape(args[2])
	}
	var result json.RawMessage
	err := api.Request(ctx, method, path, input, &result)
	return result, err
}

func validateUserRun(args []string) error {
	if len(args) < 3 || !validCLIId(args[1]) || !validCLIId(args[2]) {
		return errors.New("run requires <workId> <runId>")
	}
	switch args[0] {
	case "show", "cancel":
		if len(args) == 3 {
			return nil
		}
	case "watch":
		if len(args) == 3 {
			return nil
		}
		if len(args) == 5 && args[3] == "--after" {
			value, err := strconv.ParseUint(args[4], 10, 53)
			if err == nil && value <= (1<<53)-1 {
				return nil
			}
		}
	}
	return errors.New("invalid run command; run piwork-cli --help")
}

func runUserRun(ctx context.Context, api *client.Client, args []string, stdout io.Writer) (any, error) {
	base := "/api/v1/works/" + url.PathEscape(args[1]) + "/runs/" + url.PathEscape(args[2])
	switch args[0] {
	case "show":
		var result json.RawMessage
		err := api.Request(ctx, "GET", base, nil, &result)
		return result, err
	case "cancel":
		key, err := randomKey()
		if err != nil {
			return nil, err
		}
		var result json.RawMessage
		err = api.Request(ctx, "POST", base+"/cancel", map[string]string{"idempotencyKey": key}, &result)
		return result, err
	case "watch":
		after := "0"
		if len(args) == 5 {
			after = args[4]
		}
		err := api.StreamNDJSON(ctx, base+"/events?after="+after, func(event json.RawMessage) error {
			_, err := stdout.Write(append(event, '\n'))
			return err
		})
		return streamedOutput{}, err
	}
	return nil, errors.New("unsupported Run action")
}

type chatOptions struct {
	workID, session, message string
	one                      bool
}

func parseChat(args []string) (chatOptions, error) {
	if len(args) == 0 || !validCLIId(args[0]) {
		return chatOptions{}, errors.New("chat requires <workId>")
	}
	options := chatOptions{workID: args[0]}
	seen := map[string]bool{}
	for i := 1; i < len(args); i++ {
		key := args[i]
		if key != "--session" && key != "--message" || seen[key] || i+1 >= len(args) || args[i+1] == "" || strings.HasPrefix(args[i+1], "--") {
			return chatOptions{}, errors.New("invalid chat option")
		}
		seen[key] = true
		i++
		if key == "--session" {
			options.session = args[i]
		} else {
			options.message = args[i]
			options.one = true
		}
	}
	return options, nil
}

func validateUserChat(args []string) error { _, err := parseChat(args); return err }

func runUserChat(ctx context.Context, api *client.Client, args []string, jsonOutput bool, stdout, stderr io.Writer) (any, error) {
	options, err := parseChat(args)
	if err != nil {
		return nil, err
	}
	if options.session == "" {
		key, err := randomKey()
		if err != nil {
			return nil, err
		}
		var accepted map[string]any
		path := "/api/v1/works/" + url.PathEscape(options.workID) + "/sessions"
		if err := api.Request(ctx, "POST", path, map[string]string{"idempotencyKey": key}, &accepted); err != nil {
			return nil, err
		}
		options.session, _ = accepted["sessionId"].(string)
		if options.session == "" {
			return nil, errors.New("Core did not return a Session ID")
		}
		if err := emitChatMarker(stdout, jsonOutput, map[string]any{"type": "session", "workId": options.workID, "sessionId": options.session}); err != nil {
			return streamedOutput{}, err
		}
	}
	if options.one {
		return chatOnce(ctx, api, options, jsonOutput, stdout, stderr)
	}
	if !term.IsTerminal(int(os.Stdin.Fd())) {
		return streamedOutput{}, errors.New("interactive chat requires a terminal or --message")
	}
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 32<<10), 1<<20)
	for {
		fmt.Fprint(stdout, "> ")
		if !scanner.Scan() {
			break
		}
		message := scanner.Text()
		if message == "" {
			break
		}
		options.message = message
		if _, err := chatOnce(ctx, api, options, jsonOutput, stdout, stderr); err != nil {
			return streamedOutput{}, err
		}
	}
	return streamedOutput{}, scanner.Err()
}

func chatOnce(ctx context.Context, api *client.Client, options chatOptions, jsonOutput bool, stdout, stderr io.Writer) (any, error) {
	key, err := randomKey()
	if err != nil {
		return streamedOutput{}, err
	}
	base := "/api/v1/works/" + url.PathEscape(options.workID) + "/runs"
	var accepted struct {
		Run struct {
			RunID                    string                         `json:"runId"`
			ActualModel              *contracts.RunModelDescription `json:"actualModel"`
			Source                   *contracts.AgentRunSource      `json:"source"`
			AdoptedExperienceVersion int64                          `json:"adoptedExperienceVersion"`
		} `json:"run"`
	}
	err = api.Request(ctx, "POST", base, map[string]string{"sessionId": options.session, "submissionKey": key, "prompt": options.message}, &accepted)
	if err != nil {
		return streamedOutput{}, err
	}
	if accepted.Run.RunID == "" {
		return streamedOutput{}, errors.New("Core did not return a Run ID")
	}
	runID := accepted.Run.RunID
	if err := emitChatMarker(stdout, jsonOutput, map[string]any{"type": "run", "workId": options.workID, "sessionId": options.session, "runId": runID, "actualModel": accepted.Run.ActualModel, "source": accepted.Run.Source, "adoptedExperienceVersion": accepted.Run.AdoptedExperienceVersion}); err != nil {
		return streamedOutput{}, err
	}
	streamPath := base + "/" + url.PathEscape(runID) + "/events?after=0"
	var cursor uint64
	err = api.StreamNDJSON(ctx, streamPath, func(event json.RawMessage) error {
		var envelope struct {
			Sequence uint64 `json:"sequence"`
			Kind     struct {
				Case string `json:"$case"`
				Text struct {
					Delta string `json:"delta"`
				} `json:"text"`
				Tool struct {
					ToolName string `json:"toolName"`
					Phase    string `json:"phase"`
					IsError  bool   `json:"isError"`
					Result   struct {
						Kind string `json:"kind"`
						Text string `json:"text"`
					} `json:"result"`
				} `json:"tool"`
			} `json:"kind"`
		}
		_ = json.Unmarshal(event, &envelope)
		if envelope.Sequence > cursor {
			cursor = envelope.Sequence
		}
		if jsonOutput {
			_, err := stdout.Write(append(event, '\n'))
			return err
		}
		if envelope.Kind.Case == "text" {
			_, err := io.WriteString(stdout, envelope.Kind.Text.Delta)
			return err
		}
		if envelope.Kind.Case == "tool" && envelope.Kind.Tool.Phase == "tool-end" {
			tool := envelope.Kind.Tool
			if summary := memoryToolSummary(tool.ToolName, tool.IsError, tool.Result.Kind, tool.Result.Text); summary != "" {
				_, err := fmt.Fprintln(stderr, summary)
				return err
			}
		}
		return nil
	})
	if err != nil {
		if ctx.Err() != nil {
			cancelContext, stop := context.WithTimeout(context.Background(), 5*time.Second)
			cancelKey := "cancel-" + key
			var cancelled json.RawMessage
			cancelErr := api.Request(cancelContext, "POST", base+"/"+url.PathEscape(runID)+"/cancel", map[string]string{"idempotencyKey": cancelKey}, &cancelled)
			stop()
			if cancelErr == nil {
				terminalContext, terminalStop := context.WithTimeout(context.Background(), 30*time.Second)
				defer terminalStop()
				for {
					var terminal struct {
						State any `json:"state"`
					}
					if pollErr := api.Request(terminalContext, "GET", base+"/"+url.PathEscape(runID), nil, &terminal); pollErr != nil {
						break
					}
					state := fmt.Sprint(terminal.State)
					if state == "RUN_STATE_SUCCEEDED" || state == "RUN_STATE_FAILED" || state == "RUN_STATE_CANCELLED" || state == "RUN_STATE_INTERRUPTED" ||
						state == "4" || state == "5" || state == "6" || state == "7" {
						if state == "RUN_STATE_SUCCEEDED" || state == "4" {
							return streamedOutput{}, nil
						}
						return streamedOutput{}, &client.APIError{Code: "RUN_FAILED", Text: "Run " + runID + " ended in " + state}
					}
					select {
					case <-terminalContext.Done():
						return streamedOutput{}, ctx.Err()
					case <-time.After(100 * time.Millisecond):
					}
				}
			}
		} else {
			fmt.Fprintf(stderr, "Run stream disconnected. Resume with: piwork-cli run watch %s %s --after %d\n", options.workID, runID, cursor)
		}
		return streamedOutput{}, err
	}
	if !jsonOutput {
		fmt.Fprintln(stdout)
	}
	viewContext, stop := context.WithTimeout(context.Background(), 30*time.Second)
	defer stop()
	var result struct {
		State any `json:"state"`
		Error any `json:"error"`
	}
	if err := api.Request(viewContext, "GET", base+"/"+url.PathEscape(runID), nil, &result); err != nil {
		return streamedOutput{}, err
	}
	state := fmt.Sprint(result.State)
	if state == "RUN_STATE_FAILED" || state == "RUN_STATE_CANCELLED" || state == "RUN_STATE_INTERRUPTED" || state == "5" || state == "6" || state == "7" {
		if jsonOutput {
			_ = json.NewEncoder(stdout).Encode(map[string]any{"type": "run-terminal", "runId": runID, "state": result.State, "error": result.Error})
		}
		return streamedOutput{}, &client.APIError{Code: "RUN_FAILED", Text: "Run " + runID + " ended in " + state}
	}
	return streamedOutput{}, nil
}

func emitChatMarker(stdout io.Writer, jsonOutput bool, marker map[string]any) error {
	if jsonOutput {
		return json.NewEncoder(stdout).Encode(marker)
	}
	_, err := fmt.Fprintf(stdout, "%s: %s\n", marker["type"], marker[fmt.Sprint(marker["type"])+"Id"])
	return err
}

func memoryToolSummary(name string, isError bool, kind, text string) string {
	if name != "brain_experience" && name != "brain_feedback" && name != "package:piwork-brain:brain_experience" && name != "package:piwork-brain:brain_feedback" || kind != "text" {
		return ""
	}
	if isError {
		return "Memory: operation failed; no effective update confirmed."
	}
	var value struct {
		MemoryCommit *struct {
			Version int64  `json:"version"`
			Status  string `json:"status"`
		} `json:"memoryCommit"`
		Version   *int64 `json:"version"`
		Status    string `json:"status"`
		Adopted   *int64 `json:"adoptedExperienceVersion"`
		Effective *int64 `json:"effectiveVersion"`
	}
	if json.Unmarshal([]byte(text), &value) != nil {
		return ""
	}
	valid := func(n int64) bool { return n >= 0 && n <= contracts.MaxSafeInteger }
	if value.MemoryCommit != nil && value.MemoryCommit.Status == "effective" && valid(value.MemoryCommit.Version) {
		return fmt.Sprintf("Memory: effective v%d.", value.MemoryCommit.Version)
	}
	if value.Version != nil && valid(*value.Version) {
		if value.Status == "staged" {
			return fmt.Sprintf("Memory: candidate v%d proposed; not effective.", *value.Version)
		}
		if value.Status == "invalidated" {
			return fmt.Sprintf("Memory: entry invalidated at v%d.", *value.Version)
		}
	}
	if value.Adopted != nil && value.Effective != nil && valid(*value.Adopted) && valid(*value.Effective) {
		return fmt.Sprintf("Memory: this Run uses v%d; current effective v%d.", *value.Adopted, *value.Effective)
	}
	return ""
}
