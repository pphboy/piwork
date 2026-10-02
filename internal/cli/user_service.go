package cli

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"piwork/internal/client"
)

type serviceCommand struct {
	action, workID, serviceID, key string
	tail                           int
	wait                           bool
}

func validateUserService(args []string) error { _, err := parseUserService(args); return err }

func parseUserService(args []string) (serviceCommand, error) {
	invalid := errors.New("invalid work service command; run piwork-cli --help")
	if len(args) < 2 || !validCLIId(args[1]) {
		return serviceCommand{}, invalid
	}
	cmd := serviceCommand{action: args[0], workID: args[1], tail: 100}
	if cmd.action == "list" {
		if len(args) != 2 {
			return serviceCommand{}, invalid
		}
		return cmd, nil
	}
	if len(args) < 3 || !validCLIId(args[2]) {
		return serviceCommand{}, invalid
	}
	cmd.serviceID = args[2]
	if cmd.action == "show" {
		if len(args) != 3 {
			return serviceCommand{}, invalid
		}
		return cmd, nil
	}
	if cmd.action == "logs" {
		if len(args) == 3 {
			return cmd, nil
		}
		if len(args) != 5 || args[3] != "--tail" {
			return serviceCommand{}, invalid
		}
		value, err := strconv.Atoi(args[4])
		if err != nil || value < 1 || value > 200 || strings.HasPrefix(args[4], "+") {
			return serviceCommand{}, invalid
		}
		cmd.tail = value
		return cmd, nil
	}
	switch cmd.action {
	case "start", "stop", "restart", "retry", "remove":
	default:
		return serviceCommand{}, invalid
	}
	options, err := parseWorkMutationOptions(args[3:], false)
	if err != nil {
		return serviceCommand{}, invalid
	}
	cmd.wait = options["--wait"] == "true"
	cmd.key = options["--idempotency-key"]
	return cmd, nil
}

func runUserService(ctx context.Context, api *client.Client, args []string, stderr io.Writer) (any, error) {
	command, err := parseUserService(args)
	if err != nil {
		return nil, err
	}
	path := "/api/v1/works/" + url.PathEscape(command.workID) + "/services"
	if command.action != "list" {
		path += "/" + url.PathEscape(command.serviceID)
	}
	switch command.action {
	case "list":
		var result struct {
			Services []map[string]any `json:"services"`
		}
		if err := api.Request(ctx, "GET", path, nil, &result); err != nil {
			return nil, err
		}
		services := make([]map[string]any, 0, len(result.Services))
		for _, service := range result.Services {
			services = append(services, projectCLIService(service, command.workID))
		}
		sort.Slice(services, func(i, j int) bool {
			if fmt.Sprint(services[i]["name"]) != fmt.Sprint(services[j]["name"]) {
				return fmt.Sprint(services[i]["name"]) < fmt.Sprint(services[j]["name"])
			}
			return fmt.Sprint(services[i]["serviceId"]) < fmt.Sprint(services[j]["serviceId"])
		})
		return map[string]any{"services": services}, nil
	case "show":
		var result map[string]any
		if err := api.Request(ctx, "GET", path, nil, &result); err != nil {
			return nil, err
		}
		return projectCLIService(result, command.workID), nil
	case "logs":
		var result struct {
			ServiceID, Status, Text, CollectedAt, Reason string
			Truncated                                    bool
		}
		err := api.Request(ctx, "GET", path+"/logs?tailLines="+strconv.Itoa(command.tail), nil, &result)
		if err != nil {
			return nil, err
		}
		view := map[string]any{"workId": command.workID, "serviceId": result.ServiceID, "status": result.Status, "text": result.Text, "truncated": result.Truncated, "collectedAt": result.CollectedAt}
		if result.Reason != "" {
			view["reason"] = result.Reason
		}
		if result.Status == "unavailable" {
			reason := "Service logs are unavailable"
			if result.Reason != "" {
				reason = client.SafeErrorMessage(result.Reason)
			}
			return view, &client.APIError{Code: "SERVICE_LOGS_UNAVAILABLE", Text: reason}
		}
		return view, nil
	}
	action := map[string]string{"start": "enable", "stop": "disable", "restart": "restart", "retry": "retry", "remove": "remove"}[command.action]
	key := command.key
	if key == "" {
		key, err = randomKey()
		if err != nil {
			return nil, err
		}
	}
	var accepted map[string]any
	if err := api.Request(ctx, "POST", path+"/"+action, map[string]string{"idempotencyKey": key}, &accepted); err != nil {
		return nil, err
	}
	accepted = projectCLIFields(accepted, "workId", "serviceId", "operationId", "correlationId", "reused")
	if !command.wait {
		return accepted, nil
	}
	id, _ := accepted["operationId"].(string)
	if id == "" || accepted["workId"] != command.workID || accepted["serviceId"] != command.serviceID {
		return nil, errors.New("Core returned an invalid Service Operation")
	}
	fmt.Fprintf(stderr, "Work %s · Service %s · Operation %s accepted; waiting. Recover with piwork-cli operation show %s.\n", command.workID, command.serviceID, id, id)
	return observeCLIService(ctx, api, command, accepted, 120*time.Second)
}

func observeCLIService(ctx context.Context, api *client.Client, command serviceCommand, accepted map[string]any, timeout time.Duration) (any, error) {
	id, _ := accepted["operationId"].(string)
	waitCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	waiting := func(code string) map[string]any {
		return map[string]any{"workId": command.workID, "serviceId": command.serviceID, "operationId": id,
			"correlationId": accepted["correlationId"], "state": "waiting", "result": nil, "diagnostics": nil,
			"error": map[string]any{"code": code}}
	}
	for {
		var observed map[string]any
		if err := api.Request(waitCtx, "GET", "/api/v1/operations/"+url.PathEscape(id), nil, &observed); err != nil {
			if ctx.Err() != nil {
				return waiting("OPERATION_WAIT_INTERRUPTED"), ctx.Err()
			}
			if waitCtx.Err() != nil {
				return waiting("OPERATION_WAIT_TIMEOUT"), &client.APIError{Code: "OPERATION_WAIT_TIMEOUT", Text: "Service Operation " + id + " remains queryable"}
			}
			return waiting("OPERATION_OBSERVATION_UNAVAILABLE"), &client.APIError{Code: "OPERATION_OBSERVATION_UNAVAILABLE", Text: "Service Operation " + id + " remains queryable"}
		}
		if observed["operationId"] != id || observed["workId"] != command.workID {
			return waiting("OPERATION_OBSERVATION_UNAVAILABLE"), &client.APIError{Code: "OPERATION_OBSERVATION_UNAVAILABLE", Text: "Core returned an unrelated Operation"}
		}
		switch observed["state"] {
		case "pending", "running", "succeeded", "failed", "superseded":
		default:
			return waiting("OPERATION_OBSERVATION_UNAVAILABLE"), &client.APIError{Code: "OPERATION_OBSERVATION_UNAVAILABLE", Text: "Core returned an invalid Operation state"}
		}
		observed["serviceId"] = command.serviceID
		for _, field := range []string{"correlationId", "result", "error", "diagnostics"} {
			if _, exists := observed[field]; !exists {
				observed[field] = nil
			}
		}
		if observed["correlationId"] == nil {
			observed["correlationId"] = accepted["correlationId"]
		}
		switch observed["state"] {
		case "succeeded":
			return observed, nil
		case "failed", "superseded":
			return observed, &client.APIError{Code: "OPERATION_FAILED", Text: "Service Operation " + id + " failed"}
		}
		select {
		case <-ctx.Done():
			return waiting("OPERATION_WAIT_INTERRUPTED"), ctx.Err()
		case <-waitCtx.Done():
			return waiting("OPERATION_WAIT_TIMEOUT"), &client.APIError{Code: "OPERATION_WAIT_TIMEOUT", Text: "Service Operation " + id + " remains queryable"}
		case <-time.After(250 * time.Millisecond):
		}
	}
}

func projectCLIFields(source map[string]any, fields ...string) map[string]any {
	result := make(map[string]any, len(fields))
	for _, field := range fields {
		result[field] = source[field]
	}
	return result
}

func projectCLIService(source map[string]any, workID string) map[string]any {
	result := projectCLIFields(source, "workId", "serviceId", "name", "enabled", "observedState", "desiredRevision", "appliedRevision", "lastError", "createdAt")
	result["workId"] = workID
	if failure, ok := source["lastError"].(map[string]any); ok {
		result["lastError"] = projectCLIFields(failure, "code", "message", "retryable")
		for _, field := range []string{"code", "message"} {
			if text, ok := failure[field].(string); ok {
				result["lastError"].(map[string]any)[field] = client.SafeErrorMessage(text)
			}
		}
	}
	endpoints := make([]map[string]any, 0)
	if items, ok := source["endpoints"].([]any); ok {
		for _, item := range items {
			if endpoint, ok := item.(map[string]any); ok {
				value := projectCLIFields(endpoint, "name", "protocol", "host", "port")
				if address, exists := endpoint["url"]; exists {
					value["url"] = address
				}
				endpoints = append(endpoints, value)
			}
		}
	}
	result["endpoints"] = endpoints
	result["access"] = nil
	if access, ok := source["access"].(map[string]any); ok {
		value := projectCLIFields(access, "hostname", "defaultUrl", "defaultPortName", "status")
		ports := make([]map[string]any, 0)
		if items, ok := access["ports"].([]any); ok {
			for _, item := range items {
				if port, ok := item.(map[string]any); ok {
					ports = append(ports, projectCLIFields(port, "name", "port", "url"))
				}
			}
		}
		value["ports"] = ports
		result["access"] = value
	}
	return result
}
