package cli

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"time"

	"golang.org/x/term"
	"piwork/internal/buildinfo"
	"piwork/internal/client"
	"piwork/internal/contracts"
	"piwork/internal/workpackage"
)

const userUsage = `usage: piwork-cli [--core <url>] [--json] [command]
  No command starts Desktop. Use --help or help for this command list.
  Empty --json prints help without starting Desktop.
  Desktop Core: --core > PIWORK_CORE_URL > saved Desktop default > credential > loopback.
  Business Core: --core > PIWORK_CORE_URL > credential > loopback.
  A saved Desktop default applies to the next launch; --core overrides this launch only.

  status
  login --account <name> [--password-stdin]
  whoami
  logout
  skills <list|show> [name]
  packages <list|show> [name]
  work create --name <name> [--wait]
  work list
  work show <workId>
  work <start|stop|retry|delete> <workId> [--wait]
  work config <show|set|apply|skills|packages|agents> ...
  work service <list|show|start|stop|restart|retry|remove|logs> ...
  work package inspect <file>
  work export <workId> [--output <file>]
  work snapshot download <snapshotId> --output <file>
  work import <file> [--name <name>] [--wait]
  work packages <list|show|install|update|enable|disable|remove> ...
  operation show <operationId>
  session <create|list|show> <workId> [sessionId]
  run <show|watch|cancel> <workId> <runId> [--after <sequence>]
  chat <workId> [--session <sessionId>] [--message <text>]
  proxy [--port <1..65535>]
  desktop [--port <1..65535>] [--no-open]
  desktop open [--port <1..65535>] [--no-open]
  desktop logout [--port <1..65535>]
`

type userCommand struct {
	core string
	json bool
	args []string
}

type streamedOutput struct{}

func parseUser(args []string) (userCommand, error) {
	var command userCommand
	seenCore := false
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--core":
			if seenCore || i+1 >= len(args) || args[i+1] == "" || strings.HasPrefix(args[i+1], "--") {
				return command, errors.New("--core requires one URL")
			}
			i++
			seenCore = true
			command.core = args[i]
		case "--json":
			if command.json {
				return command, errors.New("--json may be specified once")
			}
			command.json = true
		default:
			command.args = args[i:]
			return command, nil
		}
	}
	return command, nil
}

func runUser(args []string, stdout, stderr io.Writer) int {
	return runUserWithDesktop(args, stdout, stderr, runUserDesktop)
}

func runUserWithDesktop(args []string, stdout, stderr io.Writer, launch func(*client.Client, client.CredentialStore, *client.Credential, []string, io.Writer, io.Writer) int) int {
	command, err := parseUser(args)
	if err != nil {
		fmt.Fprintln(stderr, client.SafeErrorMessage(err.Error()))
		return 2
	}
	if len(command.args) == 0 && !command.json {
		command.args = []string{"desktop"}
	}
	if len(command.args) == 0 || command.args[0] == "help" || command.args[0] == "--help" || command.args[0] == "-h" {
		fmt.Fprint(stdout, userUsage)
		return 0
	}
	if len(command.args) == 1 && (command.args[0] == "--version" || command.args[0] == "version") {
		if json.NewEncoder(stdout).Encode(buildinfo.Read("piwork-cli")) != nil {
			return 1
		}
		return 0
	}
	for _, arg := range command.args[1:] {
		if arg == "--help" || arg == "-h" {
			fmt.Fprint(stdout, userUsage)
			return 0
		}
	}
	if err := validateUserCommand(command.args); err != nil {
		fmt.Fprintln(stderr, err)
		return 2
	}
	if (command.args[0] == "proxy" || command.args[0] == "desktop") && command.json {
		fmt.Fprintf(stderr, "%s is an interactive command; --json is unavailable\n", command.args[0])
		return 2
	}
	if command.args[0] == "proxy" || command.args[0] == "desktop" {
		if _, err := cliContainerMode(); err != nil {
			fmt.Fprintln(stderr, err)
			return 2
		}
	}
	if command.args[0] == "desktop" && len(command.args) > 1 && (command.args[1] == "open" || command.args[1] == "logout") {
		if command.core != "" {
			fmt.Fprintln(stderr, "desktop open/logout select an existing local instance; --core is unavailable")
			return 2
		}
		return runDesktopControl(command.args[1:], stdout, stderr)
	}
	if len(command.args) == 4 && command.args[0] == "work" && command.args[1] == "package" && command.args[2] == "inspect" {
		f, err := os.Open(command.args[3])
		if err != nil {
			fmt.Fprintln(stderr, "Unable to open Work package.")
			return 1
		}
		defer f.Close()
		info, err := f.Stat()
		if err != nil || !info.Mode().IsRegular() {
			fmt.Fprintln(stderr, "Work package must be a regular file.")
			return 1
		}
		summary, err := workpackage.Inspect(context.Background(), f, info.Size())
		if err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
		if encodeUserOutput(stdout, summary, command.json) != nil {
			return 1
		}
		return 0
	}
	path, err := client.CredentialPath()
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	store := client.CredentialStore{Path: path}
	credential, err := store.Load()
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	saved := ""
	if credential != nil {
		saved = credential.CoreURL
	}
	coreURL, err := client.ResolveCoreURL(command.core, saved)
	if command.args[0] == "desktop" {
		coreURL, err = client.ResolveDesktopCoreURL(command.core, saved, client.DesktopPreferencesStore{CredentialPath: path})
	}
	if err != nil {
		fmt.Fprintln(stderr, err)
		if errors.Is(err, client.ErrDesktopPreferencesUnavailable) {
			return 1
		}
		return 2
	}
	token := ""
	if credential != nil && sameCoreOrigin(credential.CoreURL, coreURL) {
		token = credential.Token
	}
	if command.args[0] != "status" && command.args[0] != "login" && command.args[0] != "desktop" && token == "" {
		fmt.Fprintln(stderr, "No credential belongs to the selected Core; log in first.")
		return 3
	}
	api, err := client.New(coreURL, token)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 2
	}
	if command.args[0] == "proxy" {
		return runUserProxy(api, command.args[1:], command.json, stdout, stderr)
	}
	if command.args[0] == "desktop" {
		return launch(api, store, credential, command.args[1:], stdout, stderr)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	var output any
	exitCode := 0
	switch command.args[0] {
	case "status":
		api.Token = ""
		var health, ready json.RawMessage
		if err = api.Request(ctx, "GET", "/healthz", nil, &health); err == nil {
			var status int
			ready, status, err = readUserReadiness(ctx, api)
			if err == nil && status == 503 {
				exitCode = 5
			}
		}
		if err == nil {
			output = map[string]any{"coreUrl": coreURL, "health": health, "readiness": ready}
			var state struct {
				Status string `json:"status"`
				Ready  bool   `json:"ready"`
			}
			if json.Unmarshal(ready, &state) == nil && !state.Ready && state.Status != "ready" {
				exitCode = 5
			}
		}
	case "login":
		api.Token = ""
		var password string
		password, err = userPassword(command.args[1:], stderr)
		if err == nil {
			var record client.Credential
			record, err = api.Login(ctx, command.args[2], password)
			if err == nil {
				err = store.Save(record)
				output = map[string]any{"user": record.User, "expiresAt": record.ExpiresAt, "coreUrl": record.CoreURL}
			}
		}
	case "whoami":
		var identity json.RawMessage
		err = api.Request(ctx, "GET", "/api/v1/me", nil, &identity)
		output = identity
	case "logout":
		err = api.Logout(ctx)
		if err == nil || confirmedInvalidLogoutSession(err) {
			err = store.ClearSession(coreURL, token)
			if err == nil {
				output = map[string]bool{"loggedOut": true}
			}
		}
	case "work":
		output, err = runUserWork(ctx, api, command.args[1:], stderr)
	case "skills", "packages":
		path := "/api/v1/" + command.args[0]
		if command.args[1] == "show" {
			path += "/" + url.PathEscape(command.args[2])
		}
		var result json.RawMessage
		err = api.Request(ctx, "GET", path, nil, &result)
		output = result
	case "session":
		output, err = runUserSession(ctx, api, command.args[1:])
	case "run":
		output, err = runUserRun(ctx, api, command.args[1:], stdout)
	case "chat":
		output, err = runUserChat(ctx, api, command.args[1:], command.json, stdout, stderr)
	case "operation":
		var operation json.RawMessage
		err = api.Request(ctx, "GET", "/api/v1/operations/"+url.PathEscape(command.args[2]), nil, &operation)
		output = operation
	}
	if err != nil {
		if output != nil {
			if _, streamed := output.(streamedOutput); streamed {
				output = nil
			}
		}
		if output != nil {
			_ = encodeUserCommandOutput(stdout, stderr, output, command)
		}
		fmt.Fprintln(stderr, client.SafeErrorMessage(err.Error()))
		if errors.Is(err, context.Canceled) {
			return 130
		}
		var apiErr *client.APIError
		if errors.As(err, &apiErr) {
			if apiErr.Status == 401 || apiErr.Status == 403 {
				return 3
			}
			if apiErr.Code == "OPERATION_FAILED" {
				return 6
			}
			if apiErr.Code == "OPERATION_WAIT_TIMEOUT" || apiErr.Code == "OPERATION_OBSERVATION_UNAVAILABLE" {
				return 5
			}
			if apiErr.Code == "RUN_FAILED" {
				return 7
			}
			if apiErr.Code == "SERVICE_LOGS_UNAVAILABLE" {
				return 5
			}
			switch apiErr.Status {
			case 404:
				return 4
			case 409:
				return 6
			case 502, 503, 504:
				return 5
			}
			if apiErr.Code == "NETWORK_ERROR" {
				return 5
			}
		}
		return 1
	}
	if _, streamed := output.(streamedOutput); streamed {
		return exitCode
	}
	if err := encodeUserCommandOutput(stdout, stderr, output, command); err != nil {
		return 1
	}
	return exitCode
}

// Only the selected Core's recognizable authentication error confirms that
// there is no valid remote session left. Arbitrary or malformed 401 bodies
// cannot discard a saved credential.
func confirmedInvalidLogoutSession(err error) bool {
	var failure *client.APIError
	if !errors.As(err, &failure) || failure.Status != http.StatusUnauthorized || failure.Code != "AUTHENTICATION_FAILED" {
		return false
	}
	value, parseErr := contracts.ParseJSON(bytes.NewReader(failure.Details), 1<<20)
	if parseErr != nil {
		return false
	}
	object, ok := value.(map[string]any)
	if !ok || object["code"] != "AUTHENTICATION_FAILED" {
		return false
	}
	message, ok := object["message"].(string)
	return ok && strings.TrimSpace(message) != ""
}

func encodeUserCommandOutput(stdout, stderr io.Writer, value any, command userCommand) error {
	if !command.json && len(command.args) >= 3 && command.args[0] == "work" && command.args[1] == "service" && command.args[2] == "logs" {
		if logs, ok := value.(map[string]any); ok {
			if logs["status"] == "unavailable" {
				return nil
			}
			text, _ := logs["text"].(string)
			if text != "" && !strings.HasSuffix(text, "\n") {
				text += "\n"
			}
			if logs["truncated"] == true || logs["status"] == "truncated" {
				fmt.Fprintln(stderr, "Service logs are truncated.")
			}
			_, err := io.WriteString(stdout, text)
			return err
		}
	}
	if !command.json && len(command.args) >= 3 && command.args[0] == "work" && command.args[1] == "service" {
		if operation, ok := value.(map[string]any); ok && operation["state"] != nil && operation["operationId"] != nil {
			message := fmt.Sprintf("Work ID: %v\nService ID: %v\nOperation ID: %v\nState: %v\n", operation["workId"], operation["serviceId"], operation["operationId"], operation["state"])
			if failure, ok := operation["error"].(map[string]any); ok {
				for _, field := range []struct{ key, label, fallback string }{{"stage", "Stage", "unknown"}, {"code", "Code", "unknown"}, {"message", "Reason", "unknown"}, {"remediation", "Remediation", "Inspect the Operation"}} {
					text, ok := failure[field.key].(string)
					if !ok || text == "" {
						text = field.fallback
					}
					message += field.label + ": " + text + "\n"
				}
			}
			message += fmt.Sprintf("Inspect: piwork-cli operation show %v\n", operation["operationId"])
			_, err := io.WriteString(stdout, client.SafeErrorMessage(message))
			return err
		}
	}
	return encodeUserOutput(stdout, value, command.json)
}

func encodeUserOutput(writer io.Writer, value any, compact bool) error {
	encoder := json.NewEncoder(writer)
	if !compact {
		encoder.SetIndent("", "  ")
	}
	return encoder.Encode(value)
}

func readUserReadiness(ctx context.Context, api *client.Client) (json.RawMessage, int, error) {
	response, err := api.Binary(ctx, "GET", "/readyz", nil, nil, 0)
	if err != nil {
		return nil, 0, err
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, 1<<20+1))
	if err != nil || len(raw) > 1<<20 || !json.Valid(raw) {
		return nil, response.StatusCode, &client.APIError{Code: "MALFORMED_RESPONSE", Text: "Core returned malformed readiness"}
	}
	if response.StatusCode != 200 && response.StatusCode != 503 {
		return nil, response.StatusCode, &client.APIError{Status: response.StatusCode, Code: "HTTP_ERROR", Text: "Core readiness request failed"}
	}
	return raw, response.StatusCode, nil
}

func sameCoreOrigin(left, right string) bool {
	return client.SameCoreOrigin(left, right)
}

func validateUserCommand(args []string) error {
	if len(args) == 0 {
		return errors.New("command required")
	}
	switch args[0] {
	case "status", "whoami", "logout":
		if len(args) == 1 {
			return nil
		}
	case "login":
		if len(args) >= 3 && args[1] == "--account" && args[2] != "" && !strings.HasPrefix(args[2], "--") &&
			(len(args) == 3 || len(args) == 4 && args[3] == "--password-stdin") {
			return nil
		}
	case "operation":
		if len(args) == 3 && args[1] == "show" && args[2] != "" && !strings.HasPrefix(args[2], "--") {
			return nil
		}
	case "work":
		if len(args) >= 2 {
			switch args[1] {
			case "export", "snapshot", "import":
				return validateUserSnapshot(args[1:])
			case "packages":
				return validateUserPackages(args[2:])
			case "package":
				if len(args) == 4 && args[2] == "inspect" && args[3] != "" && !strings.HasPrefix(args[3], "--") {
					return nil
				}
			case "config":
				return validateUserConfig(args[2:])
			case "service":
				return validateUserService(args[2:])
			case "list":
				if len(args) == 2 {
					return nil
				}
			case "show":
				if len(args) == 3 && args[2] != "" && !strings.HasPrefix(args[2], "--") {
					return nil
				}
			case "create":
				if _, err := parseWorkCreateOptions(args[2:]); err == nil {
					return nil
				}
			case "start", "stop", "retry", "delete":
				if len(args) >= 3 && args[2] != "" && !strings.HasPrefix(args[2], "--") {
					if _, err := parseWorkMutationOptions(args[3:], false); err == nil {
						return nil
					}
				}
			}
		}
	case "skills", "packages":
		if len(args) == 2 && args[1] == "list" {
			return nil
		}
		if len(args) == 3 && args[1] == "show" && args[2] != "" && !strings.HasPrefix(args[2], "--") {
			return nil
		}
	case "session":
		return validateUserSession(args[1:])
	case "run":
		return validateUserRun(args[1:])
	case "chat":
		return validateUserChat(args[1:])
	case "proxy":
		_, err := parseUserProxyPort(args[1:])
		return err
	case "desktop":
		if len(args) > 1 && (args[1] == "open" || args[1] == "logout") {
			_, err := parseDesktopControlOptions(args[1:])
			return err
		}
		_, err := parseUserDesktopOptions(args[1:])
		return err
	}
	return errors.New("invalid or unsupported command arguments; run piwork-cli --help")
}

func userPassword(args []string, stderr io.Writer) (string, error) {
	if len(args) == 3 && args[2] == "--password-stdin" {
		line, err := bufio.NewReader(io.LimitReader(os.Stdin, 16<<10)).ReadString('\n')
		if err != nil && !errors.Is(err, io.EOF) {
			return "", err
		}
		return strings.TrimRight(line, "\r\n"), nil
	}
	if !term.IsTerminal(int(os.Stdin.Fd())) {
		return "", errors.New("use --password-stdin when stdin is not a terminal")
	}
	fmt.Fprint(stderr, "Password: ")
	raw, err := term.ReadPassword(int(os.Stdin.Fd()))
	fmt.Fprintln(stderr)
	return string(raw), err
}

func runUserWork(ctx context.Context, api *client.Client, args []string, stderr io.Writer) (any, error) {
	switch args[0] {
	case "export", "snapshot", "import":
		snapshotWarning(stderr)
		return runUserSnapshot(ctx, api, args, stderr)
	case "packages":
		return runUserPackages(ctx, api, args[1:], stderr)
	case "config":
		return runUserConfig(ctx, api, args[1:], stderr)
	case "service":
		return runUserService(ctx, api, args[1:], stderr)
	case "list":
		var result json.RawMessage
		err := api.Request(ctx, "GET", "/api/v1/works", nil, &result)
		return result, err
	case "show":
		var result json.RawMessage
		err := api.Request(ctx, "GET", "/api/v1/works/"+url.PathEscape(args[1]), nil, &result)
		return result, err
	case "create", "start", "stop", "retry", "delete":
		var key string
		var wait bool
		var input map[string]any
		if args[0] == "create" {
			created, err := parseWorkCreateOptions(args[1:])
			if err != nil {
				return nil, err
			}
			key, wait = created.key, created.wait
			input = map[string]any{"name": created.name}
			if created.baseImage != "" {
				input["baseImage"] = created.baseImage
			}
			if created.skillsPresent {
				input["skills"] = created.skills
			}
			if created.packagesPresent {
				input["packages"] = packageEntries(created.packages)
			}
			if created.agentsPath != "" {
				raw, err := readConfigFile(created.agentsPath)
				if err != nil {
					return nil, err
				}
				input["agentsMd"] = string(raw)
			}
			if created.configPath != "" {
				raw, err := readConfigFile(created.configPath)
				if err != nil {
					return nil, err
				}
				var config map[string]any
				if json.Unmarshal(raw, &config) != nil || config == nil {
					return nil, errors.New("config file must contain a JSON object")
				}
				input["configuration"] = config
			}
		} else {
			options, err := parseWorkMutationOptions(args[2:], false)
			if err != nil {
				return nil, err
			}
			key, wait = options["--idempotency-key"], options["--wait"] == "true"
			input = map[string]any{}
		}
		if key == "" {
			var err error
			key, err = randomKey()
			if err != nil {
				return nil, err
			}
		}
		path := "/api/v1/works"
		input["idempotencyKey"] = key
		if args[0] != "create" {
			path += "/" + url.PathEscape(args[1]) + "/" + args[0]
		}
		var accepted map[string]any
		if err := api.Request(ctx, "POST", path, input, &accepted); err != nil {
			return nil, err
		}
		if !wait {
			return accepted, nil
		}
		return observeUserOperation(ctx, api, accepted, stderr)
	}
	return nil, errors.New("unsupported Work action")
}

func observeUserOperation(ctx context.Context, api *client.Client, accepted map[string]any, stderr io.Writer) (any, error) {
	return observeUserOperationWithin(ctx, api, accepted, stderr, 120*time.Second)
}

func observeUserOperationWithin(ctx context.Context, api *client.Client, accepted map[string]any, stderr io.Writer, timeout time.Duration) (any, error) {
	id, _ := accepted["operationId"].(string)
	if id == "" {
		return nil, errors.New("Core did not return an Operation ID")
	}
	fmt.Fprintf(stderr, "Operation %s accepted; waiting.\n", id)
	waitCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	for {
		var operation map[string]any
		if err := api.Request(waitCtx, "GET", "/api/v1/operations/"+url.PathEscape(id), nil, &operation); err != nil {
			if ctx.Err() != nil {
				return waitingOperation(accepted, "OPERATION_WAIT_INTERRUPTED"), ctx.Err()
			}
			if waitCtx.Err() != nil {
				return waitingOperation(accepted, "OPERATION_WAIT_TIMEOUT"), &client.APIError{Code: "OPERATION_WAIT_TIMEOUT", Text: "Operation " + id + " remains queryable; use operation show"}
			}
			return waitingOperation(accepted, "OPERATION_OBSERVATION_UNAVAILABLE"), &client.APIError{Code: "OPERATION_OBSERVATION_UNAVAILABLE", Text: "Operation " + id + " remains queryable; use operation show"}
		}
		switch operation["state"] {
		case "succeeded":
			return operation, nil
		case "failed", "superseded":
			return operation, &client.APIError{Code: "OPERATION_FAILED", Text: "Operation " + id + " failed; use operation show"}
		}
		select {
		case <-ctx.Done():
			return waitingOperation(accepted, "OPERATION_WAIT_INTERRUPTED"), ctx.Err()
		case <-waitCtx.Done():
			return waitingOperation(accepted, "OPERATION_WAIT_TIMEOUT"), &client.APIError{Code: "OPERATION_WAIT_TIMEOUT", Text: "Operation " + id + " remains queryable; use operation show"}
		case <-time.After(250 * time.Millisecond):
		}
	}
}

func parseWorkMutationOptions(args []string, create bool) (map[string]string, error) {
	options := make(map[string]string)
	for i := 0; i < len(args); i++ {
		name := args[i]
		if _, duplicate := options[name]; duplicate {
			return nil, errors.New("duplicate Work option")
		}
		if name == "--wait" {
			options[name] = "true"
			continue
		}
		if name != "--idempotency-key" && !(create && name == "--name") {
			return nil, errors.New("unknown Work option")
		}
		if i+1 >= len(args) || strings.TrimSpace(args[i+1]) == "" || strings.ContainsRune(args[i+1], 0) || strings.HasPrefix(args[i+1], "--") {
			return nil, errors.New("Work option requires a value")
		}
		i++
		options[name] = args[i]
	}
	if create && options["--name"] == "" {
		return nil, errors.New("work create requires --name")
	}
	return options, nil
}

func waitingOperation(accepted map[string]any, code string) map[string]any {
	return map[string]any{"workId": accepted["workId"], "operationId": accepted["operationId"],
		"correlationId": accepted["correlationId"], "result": nil, "diagnostics": nil,
		"state": "waiting", "error": map[string]string{"code": code}}
}

func randomKey() (string, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", err
	}
	value[6] = value[6]&0x0f | 0x40
	value[8] = value[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", value[:4], value[4:6], value[6:8], value[8:10], value[10:]), nil
}
