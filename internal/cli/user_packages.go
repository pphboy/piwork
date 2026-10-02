package cli

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"regexp"
	"time"

	"piwork/internal/client"
	"piwork/internal/pipackage"
)

type packageCommand struct {
	action, workID, name, source, fromCore string
	wait, verbose                          bool
}

func validateUserPackages(args []string) error { _, err := parseUserPackages(args); return err }

func parseUserPackages(args []string) (packageCommand, error) {
	invalid := errors.New("invalid work packages command; run piwork-cli --help")
	if len(args) < 2 || !validCLIId(args[1]) {
		return packageCommand{}, invalid
	}
	cmd := packageCommand{action: args[0], workID: args[1]}
	switch cmd.action {
	case "list":
		if len(args) == 2 {
			return cmd, nil
		}
		return cmd, invalid
	case "show", "enable", "disable", "remove":
		if len(args) != 3 || !validCLIId(args[2]) {
			return cmd, invalid
		}
		cmd.name = args[2]
		return cmd, nil
	case "install":
		if len(args) < 3 {
			return cmd, invalid
		}
		if args[2] == "--from-core" {
			if len(args) < 4 || !packageNamePattern.MatchString(args[3]) {
				return cmd, invalid
			}
			cmd.fromCore = args[3]
			args = args[4:]
		} else {
			if _, err := pipackage.ParseSource(args[2]); err != nil {
				return cmd, invalid
			}
			cmd.source = args[2]
			args = args[3:]
		}
	case "update":
		if len(args) < 4 || !validCLIId(args[2]) {
			return cmd, invalid
		}
		cmd.name = args[2]
		if args[3] == "--from-core" {
			if !packageNamePattern.MatchString(cmd.name) {
				return cmd, invalid
			}
			cmd.fromCore = cmd.name
			args = args[4:]
		} else if args[3] == "--source" {
			if len(args) < 5 {
				return cmd, invalid
			}
			if _, err := pipackage.ParseSource(args[4]); err != nil {
				return cmd, invalid
			}
			cmd.source = args[4]
			args = args[5:]
		} else {
			return cmd, invalid
		}
	default:
		return cmd, invalid
	}
	seen := map[string]bool{}
	for _, flag := range args {
		if flag != "--wait" && flag != "--verbose" || seen[flag] {
			return cmd, invalid
		}
		seen[flag] = true
	}
	cmd.wait = seen["--wait"]
	cmd.verbose = seen["--verbose"]
	if cmd.verbose && !cmd.wait {
		return cmd, invalid
	}
	return cmd, nil
}

func runUserPackages(ctx context.Context, api *client.Client, args []string, stderr io.Writer) (any, error) {
	command, err := parseUserPackages(args)
	if err != nil {
		return nil, err
	}
	path := "/api/v1/works/" + url.PathEscape(command.workID) + "/packages"
	switch command.action {
	case "list", "show":
		if command.action == "show" {
			path += "/" + url.PathEscape(command.name)
		}
		var result json.RawMessage
		err := api.Request(ctx, "GET", path, nil, &result)
		return result, err
	case "enable", "disable", "remove":
		path += "/" + url.PathEscape(command.name)
		method := "POST"
		if command.action == "remove" {
			method = "DELETE"
		} else {
			path += "/" + command.action
		}
		var result json.RawMessage
		err := api.Request(ctx, method, path, nil, &result)
		return result, err
	}
	var source map[string]any
	if command.fromCore != "" {
		source = map[string]any{"kind": "core", "name": command.fromCore}
	} else {
		source, err = resolveUserPackageSource(ctx, api, command.workID, command.source)
		if err != nil {
			return nil, err
		}
	}
	key, err := randomKey()
	if err != nil {
		return nil, err
	}
	if command.action == "update" {
		path += "/" + url.PathEscape(command.name) + "/update"
	}
	var accepted map[string]any
	if err := api.Request(ctx, "POST", path, map[string]any{"source": source, "idempotencyKey": key}, &accepted); err != nil {
		return nil, err
	}
	if !command.wait {
		return accepted, nil
	}
	return observeUserPackageOperation(ctx, api, accepted, command.verbose, stderr)
}

func observeUserPackageOperation(ctx context.Context, api *client.Client, accepted map[string]any, verbose bool, stderr io.Writer) (any, error) {
	id, _ := accepted["operationId"].(string)
	if !safePackageOperationID.MatchString(id) {
		return nil, errors.New("Core did not return a package Operation ID")
	}
	returnWaiting := func(code string, err error) (any, error) {
		fmt.Fprintf(stderr, "Resume: piwork-cli operation show %s\n", id)
		return waitingOperation(accepted, code), err
	}
	fmt.Fprintf(stderr, "Package Operation %s accepted; waiting.\n", id)
	started, lastHeartbeat := time.Now(), time.Now()
	retry := 250 * time.Millisecond
	previousPhase := ""
	for {
		var operation map[string]any
		err := api.Request(ctx, "GET", "/api/v1/operations/"+url.PathEscape(id), nil, &operation)
		if err != nil {
			if ctx.Err() != nil {
				return returnWaiting("OPERATION_WAIT_INTERRUPTED", ctx.Err())
			}
			var apiErr *client.APIError
			if errors.As(err, &apiErr) && (apiErr.Status == 0 || apiErr.Status == 502 || apiErr.Status == 503 || apiErr.Status == 504) {
				if verbose {
					fmt.Fprintf(stderr, "Package Operation %s: observation unavailable; retry in %s (%ds elapsed)\n", id, retry, int(time.Since(started).Seconds()))
				}
				select {
				case <-ctx.Done():
					return returnWaiting("OPERATION_WAIT_INTERRUPTED", ctx.Err())
				case <-time.After(retry):
				}
				retry = min(retry*2, 5*time.Second)
				continue
			}
			return returnWaiting("OPERATION_OBSERVATION_UNAVAILABLE", &client.APIError{Code: "OPERATION_OBSERVATION_UNAVAILABLE", Text: "The accepted package Operation cannot be observed"})
		}
		retry = 250 * time.Millisecond
		phase, _ := operation["packagePhase"].(string)
		if !safePackageStage.MatchString(phase) {
			phase = "unknown"
		}
		operation["packagePhase"] = phase
		if verbose && phase != previousPhase {
			fmt.Fprintf(stderr, "Package Operation %s: phase=%s (%ds elapsed)\n", id, phase, int(time.Since(started).Seconds()))
			previousPhase = phase
			lastHeartbeat = time.Now()
		}
		if verbose && time.Since(lastHeartbeat) >= 30*time.Second {
			fmt.Fprintf(stderr, "Package Operation %s: waiting phase=%s (%ds elapsed)\n", id, phase, int(time.Since(started).Seconds()))
			lastHeartbeat = time.Now()
		}
		switch operation["state"] {
		case "succeeded":
			if verbose {
				fmt.Fprintf(stderr, "Package Operation %s: succeeded (%ds elapsed)\n", id, int(time.Since(started).Seconds()))
			}
			return operation, nil
		case "failed", "superseded":
			failure, _ := operation["error"].(map[string]any)
			stage, _ := failure["stage"].(string)
			code, _ := failure["code"].(string)
			if !safePackageStage.MatchString(stage) {
				stage = "prepare"
			}
			if !safePackageCode.MatchString(code) {
				code = "PI_PACKAGE_PREPARATION_FAILED"
			}
			if operation["state"] == "failed" || operation["error"] != nil {
				operation["error"] = map[string]string{"stage": stage, "code": code}
			}
			if verbose {
				fmt.Fprintf(stderr, "Package Operation %s: %s stage=%s code=%s (%ds elapsed)\n", id, operation["state"], stage, code, int(time.Since(started).Seconds()))
			}
			return operation, &client.APIError{Code: "OPERATION_FAILED", Text: "Package Operation " + id + " failed"}
		}
		select {
		case <-ctx.Done():
			return returnWaiting("OPERATION_WAIT_INTERRUPTED", ctx.Err())
		case <-time.After(250 * time.Millisecond):
		}
	}
}

var safePackageStage = regexp.MustCompile(`^[a-z][a-z0-9-]{0,63}$`)
var safePackageCode = regexp.MustCompile(`^[A-Z][A-Z0-9_]{0,63}$`)
var safePackageOperationID = regexp.MustCompile(`^[A-Za-z0-9-]{1,128}$`)
