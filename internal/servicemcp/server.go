// Package servicemcp implements the native, Work-scoped stdio adapter.
package servicemcp

import (
	"bytes"
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"github.com/google/jsonschema-go/jsonschema"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"piwork/internal/contracts"
	"piwork/internal/rpc/servicesv1"
	"time"
	"unicode/utf16"
)

// These declarations are explicit frozen schemas, never inferred from Go
// structs. Defaults match the retained adapter; unknown root fields are also
// refused as required by the native MCP contract.
//
//go:embed tools.json
var toolBytes []byte

type toolDefinition struct {
	Name, Description string
	InputSchema       json.RawMessage
}

func NewServer(client servicesv1.WorkServicesClient) (*mcp.Server, error) {
	return newServer(context.Background(), client)
}
func newServer(lifetime context.Context, client servicesv1.WorkServicesClient) (*mcp.Server, error) {
	if client == nil {
		return nil, errors.New("service client unavailable")
	}
	server := mcp.NewServer(&mcp.Implementation{Name: "piwork-work-services", Version: "0.1.0"}, nil)
	var tools []toolDefinition
	if json.Unmarshal(toolBytes, &tools) != nil || len(tools) != 12 {
		return nil, errors.New("invalid compiled tools")
	}
	for _, tool := range tools {
		var schema jsonschema.Schema
		if err := json.Unmarshal(tool.InputSchema, &schema); err != nil {
			return nil, err
		}
		var strict jsonschema.Schema
		if json.Unmarshal([]byte("false"), &strict) != nil {
			return nil, errors.New("invalid strict schema")
		}
		schema.AdditionalProperties = &strict
		validation := schema
		// The frozen draft-07 declarations use only keywords with identical
		// meaning in 2020-12; the Go validator accepts that dialect internally.
		// Keep the discovered declaration unchanged for existing clients.
		validation.Schema = ""
		resolved, err := validation.Resolve(&jsonschema.ResolveOptions{ValidateDefaults: true})
		if err != nil {
			return nil, err
		}
		var declaration map[string]any
		if json.Unmarshal(tool.InputSchema, &declaration) != nil {
			return nil, errors.New("invalid compiled declaration")
		}
		declaration["additionalProperties"] = false
		published, err := json.Marshal(declaration)
		if err != nil {
			return nil, err
		}
		server.AddTool(&mcp.Tool{Name: tool.Name, Description: tool.Description, InputSchema: json.RawMessage(published)}, func(ctx context.Context, request *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
			ctx, cancel := context.WithCancel(ctx)
			defer cancel()
			stop := context.AfterFunc(lifetime, cancel)
			defer stop()
			raw := request.Params.Arguments
			if len(raw) == 0 {
				raw = json.RawMessage("{}")
			}
			input, err := contracts.ParseJSON(bytes.NewReader(raw), 1<<20)
			if err != nil {
				return toolError("Service tool arguments are invalid."), nil
			}
			object, ok := input.(map[string]any)
			if !ok {
				return toolError("Service tool arguments are invalid."), nil
			}
			if err = zodDefaults(&schema, object); err != nil {
				return toolError("Service tool arguments are invalid."), nil
			}
			if !zodStringLengths(&schema, object) {
				return toolError("Service tool arguments are invalid."), nil
			}
			if err = resolved.Validate(object); err != nil {
				return toolError("Service tool arguments are invalid."), nil
			}
			payload, err := json.Marshal(object)
			if err != nil {
				return toolError("Service tool arguments are invalid."), nil
			}
			response, err := invoke(ctx, client, tool.Name, payload)
			if err != nil {
				return toolError(status.Code(err).String() + ": Service request could not be completed."), nil
			}
			projected, err := (protojson.MarshalOptions{EmitDefaultValues: true}).Marshal(response)
			if err != nil || len(projected) > 2<<20 {
				return toolError("Service response is unavailable."), nil
			}
			var compact bytes.Buffer
			if json.Compact(&compact, projected) != nil {
				return toolError("Service response is unavailable."), nil
			}
			// uint64 values remain decimal strings. Text and structuredContent contain
			// exactly the same normalized object, including optional-field absence.
			result := append(json.RawMessage(nil), compact.Bytes()...)
			return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: string(result)}}, StructuredContent: result}, nil
		})
	}
	return server, nil
}

// The pinned Go schema library applies only top-level defaults. Zod also
// applies defaults in supplied nested objects, while preserving explicit null.
func zodDefaults(schema *jsonschema.Schema, value any) error {
	if schema == nil {
		return nil
	}
	switch item := value.(type) {
	case map[string]any:
		for name, property := range schema.Properties {
			if _, present := item[name]; !present && len(property.Default) > 0 {
				defaultValue, err := contracts.ParseJSON(bytes.NewReader(property.Default), 1<<20)
				if err != nil {
					return err
				}
				item[name] = defaultValue
			}
		}
		for name, child := range item {
			property := schema.Properties[name]
			if property == nil {
				property = schema.AdditionalProperties
			}
			if err := zodDefaults(property, child); err != nil {
				return err
			}
		}
	case []any:
		for _, child := range item {
			if err := zodDefaults(schema.Items, child); err != nil {
				return err
			}
		}
	}
	return nil
}

// Zod's runtime uses UTF-16 lengths, including surrogate pairs. JSON-schema
// validators count Unicode code points, so retain the original runtime bound.
func zodStringLengths(schema *jsonschema.Schema, value any) bool {
	if schema == nil {
		return true
	}
	switch item := value.(type) {
	case string:
		length := len(utf16.Encode([]rune(item)))
		if schema.MaxLength != nil && length > *schema.MaxLength {
			return false
		}
		if schema.MinLength != nil && length < *schema.MinLength {
			return false
		}
	case map[string]any:
		for key, child := range item {
			property := schema.Properties[key]
			if property == nil {
				property = schema.AdditionalProperties
			}
			if !zodStringLengths(property, child) {
				return false
			}
		}
	case []any:
		for _, child := range item {
			if !zodStringLengths(schema.Items, child) {
				return false
			}
		}
	}
	return true
}
func toolError(message string) *mcp.CallToolResult {
	return &mcp.CallToolResult{IsError: true, Content: []mcp.Content{&mcp.TextContent{Text: message}}}
}

func invoke(ctx context.Context, client servicesv1.WorkServicesClient, name string, raw []byte) (proto.Message, error) {
	timeout := 5 * time.Second
	switch name {
	case "service_create", "service_update", "service_start", "service_stop", "service_restart", "service_remove", "service_retry":
		timeout = 10 * time.Second
	case "service_logs":
		timeout = 2 * time.Second
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	var fields struct {
		ServiceID        string          `json:"serviceId"`
		IdempotencyKey   string          `json:"idempotencyKey"`
		OperationID      string          `json:"operationId"`
		ExpectedRevision uint64          `json:"expectedRevision"`
		TailLines        uint32          `json:"tailLines"`
		Definition       json.RawMessage `json:"definition"`
	}
	if err := json.Unmarshal(raw, &fields); err != nil {
		return nil, err
	}
	var definition *servicesv1.ServiceDefinition
	if len(fields.Definition) > 0 {
		definition = &servicesv1.ServiceDefinition{}
		if err := protojson.Unmarshal(fields.Definition, definition); err != nil {
			return nil, err
		}
	}
	switch name {
	case "deployment_context":
		return client.GetDeploymentContext(ctx, &servicesv1.Empty{})
	case "service_create":
		return client.CreateService(ctx, &servicesv1.CreateServiceRequest{Definition: definition, IdempotencyKey: fields.IdempotencyKey})
	case "service_list":
		return client.ListServices(ctx, &servicesv1.Empty{})
	case "service_get":
		return client.GetService(ctx, &servicesv1.ServiceIdRequest{ServiceId: fields.ServiceID})
	case "service_update":
		return client.UpdateService(ctx, &servicesv1.UpdateServiceRequest{ServiceId: fields.ServiceID, ExpectedRevision: uint32(fields.ExpectedRevision), Definition: definition, IdempotencyKey: fields.IdempotencyKey})
	case "service_start":
		return client.StartService(ctx, &servicesv1.MutateServiceRequest{ServiceId: fields.ServiceID, IdempotencyKey: fields.IdempotencyKey})
	case "service_stop":
		return client.StopService(ctx, &servicesv1.MutateServiceRequest{ServiceId: fields.ServiceID, IdempotencyKey: fields.IdempotencyKey})
	case "service_restart":
		return client.RestartService(ctx, &servicesv1.MutateServiceRequest{ServiceId: fields.ServiceID, IdempotencyKey: fields.IdempotencyKey})
	case "service_remove":
		return client.RemoveService(ctx, &servicesv1.MutateServiceRequest{ServiceId: fields.ServiceID, IdempotencyKey: fields.IdempotencyKey})
	case "service_retry":
		return client.RetryService(ctx, &servicesv1.MutateServiceRequest{ServiceId: fields.ServiceID, IdempotencyKey: fields.IdempotencyKey})
	case "operation_get":
		return client.GetOperation(ctx, &servicesv1.OperationIdRequest{OperationId: fields.OperationID})
	case "service_logs":
		return client.ReadServiceLogs(ctx, &servicesv1.ReadServiceLogsRequest{ServiceId: fields.ServiceID, TailLines: fields.TailLines})
	default:
		return nil, errors.New("unknown service tool")
	}
}
