package coreapp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"

	"piwork/internal/corestore"
	"piwork/internal/dockerengine"
	"piwork/internal/safefs"
)

func InitializationFromEnvironment(values map[string]string) (Initialization, error) {
	var initialization Initialization
	account, hasAccount := values["PIWORK_ADMIN_ACCOUNT"]
	password, hasPassword := values["PIWORK_ADMIN_PASSWORD"]
	if hasAccount != hasPassword {
		return initialization, errors.New("PIWORK_ADMIN_ACCOUNT and PIWORK_ADMIN_PASSWORD must be provided together")
	}
	if hasAccount {
		initialization.Administrator = &struct{ Account, Password string }{account, password}
	}
	image, hasImage := values["PIWORK_AGENT_IMAGE"]
	provider, hasProvider := values["PIWORK_MODEL_PROVIDER"]
	model, hasModel := values["PIWORK_MODEL"]
	if !hasModel {
		model, hasModel = values["PIWORK_MODEL_ID"]
	}
	credential, hasCredential := values["PIWORK_API_KEY"]
	if !hasCredential {
		credential, hasCredential = values["PIWORK_MODEL_API_KEY"]
	}
	_, hasBaseURL := values["PIWORK_MODEL_BASE_URL"]
	any := hasImage || hasProvider || hasModel || hasCredential || hasBaseURL
	all := hasImage && hasProvider && hasModel && hasCredential
	if any && !all {
		return initialization, errors.New("PIWORK_AGENT_IMAGE, PIWORK_MODEL_PROVIDER, PIWORK_MODEL, and PIWORK_API_KEY must be provided together")
	}
	if all {
		input := RuntimeInput{AgentImage: image, Provider: provider, Model: model, Credential: credential}
		if base, ok := values["PIWORK_MODEL_BASE_URL"]; ok {
			input.BaseURL = &base
		}
		initialization.Runtime = &input
	}
	return initialization, nil
}

// RunServe implements only the serve command. Operator business subcommands are
// implemented in their separate task, without falling back to the old TS CLI.
func RunServe(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	if len(args) == 1 && (args[0] == "--help" || args[0] == "-h") {
		fmt.Fprintln(stdout, "Usage: piwork-serve serve --data-dir DIR [--listen HOST:PORT] [--agent-grpc-listen HOST:PORT] [--agent-grpc-advertise HOST:PORT] [--env-file FILE] [--allow-insecure-remote]")
		return 0
	}
	options := map[string]string{}
	remote := false
	for i := 0; i < len(args); i++ {
		name := args[i]
		if name == "--allow-insecure-remote" {
			if remote {
				return serveUsage(stderr)
			}
			remote = true
			continue
		}
		if name != "--data-dir" && name != "--listen" && name != "--env-file" && name != "--agent-grpc-listen" && name != "--agent-grpc-advertise" {
			return serveUsage(stderr)
		}
		if _, ok := options[name]; ok {
			return serveUsage(stderr)
		}
		if i+1 >= len(args) || strings.HasPrefix(args[i+1], "--") {
			return serveUsage(stderr)
		}
		i++
		options[name] = args[i]
	}
	file := map[string]string{}
	if name, exists := options["--env-file"]; exists {
		var err error
		file, err = ReadEnvironmentFile(name)
		if err != nil {
			fmt.Fprintln(stderr, "piwork-serve:", err)
			return 1
		}
	}
	explicit := map[string]string{}
	if value, ok := options["--data-dir"]; ok {
		explicit["PIWORK_DATA_DIR"] = value
	}
	if value, ok := options["--listen"]; ok {
		explicit["PIWORK_LISTEN"] = value
	}
	if value, ok := options["--agent-grpc-listen"]; ok {
		explicit["PIWORK_AGENT_GRPC_LISTEN"] = value
	}
	if value, ok := options["--agent-grpc-advertise"]; ok {
		explicit["PIWORK_AGENT_GRPC_ADVERTISE"] = value
	}
	values, err := ApplyDockerReleaseDefaults(MergeEnvironment(file, os.Environ(), explicit))
	if err != nil {
		fmt.Fprintln(stderr, "piwork-serve:", err)
		return 2
	}
	grpcListen := values["PIWORK_AGENT_GRPC_LISTEN"]
	if grpcListen == "" {
		grpcListen = "0.0.0.0:7172"
	}
	grpcAdvertise := values["PIWORK_AGENT_GRPC_ADVERTISE"]
	if grpcAdvertise == "" && grpcListen == "0.0.0.0:7172" {
		grpcAdvertise = "piwork-core:7172"
	}
	if err := validateServiceRPCOptions(Options{AgentGRPCListen: grpcListen, AgentGRPCAdvertise: grpcAdvertise}); err != nil {
		fmt.Fprintln(stderr, "piwork-serve:", err)
		return 2
	}
	address, err := ParseListen(values["PIWORK_LISTEN"], remote)
	if err != nil {
		fmt.Fprintln(stderr, "piwork-serve:", err)
		return 2
	}
	directory := values["PIWORK_DATA_DIR"]
	if directory == "" {
		fmt.Fprintln(stderr, "piwork-serve: --data-dir or PIWORK_DATA_DIR is required")
		return 2
	}
	initialization, err := InitializationFromEnvironment(values)
	if err != nil {
		fmt.Fprintln(stderr, "piwork-serve:", err)
		return 2
	}
	home, _ := os.UserHomeDir()
	shutdown, err := shutdownOptionsFromEnvironment(values)
	if err != nil {
		fmt.Fprintln(stderr, "piwork-serve:", err)
		return 2
	}
	a, err := New(ctx, Options{AgentGRPCListen: grpcListen, AgentGRPCAdvertise: grpcAdvertise, WorkDrainTimeout: shutdown.WorkDrainTimeout, WorkStopTimeout: shutdown.WorkStopTimeout, ShutdownTimeout: shutdown.ShutdownTimeout, DataDirectory: directory, OperatorCredentialPath: values["PIWORK_OPERATOR_CREDENTIAL_PATH"], Initialization: initialization, PackageHelperImage: values["PIWORK_PACKAGE_HELPER_IMAGE"], FileHelperImage: values["PIWORK_FILE_HELPER_IMAGE"], SnapshotHelperImage: values["PIWORK_SNAPSHOT_HELPER_IMAGE"], DockerOptions: dockerengine.SelectionOptions{DockerHost: values["DOCKER_HOST"], DockerContext: values["DOCKER_CONTEXT"], DockerConfig: values["DOCKER_CONFIG"], HomeDirectory: home}})
	if err != nil {
		if errors.Is(err, corestore.ErrUnsupported) {
			fmt.Fprintln(stderr, "piwork-serve:", corestore.ErrUnsupported)
		} else if errors.Is(err, safefs.ErrLocked) {
			fmt.Fprintln(stderr, "piwork-serve: another Core owns this data directory")
		} else {
			fmt.Fprintln(stderr, "piwork-serve: Core initialization failed; verify private configuration")
		}
		return 1
	}
	stop := context.AfterFunc(ctx, a.cancel)
	defer stop()
	bound, err := a.Listen(address)
	if err != nil {
		cleanup, cancel := context.WithTimeout(context.Background(), shutdown.ShutdownTimeout)
		a.Close(cleanup)
		cancel()
		fmt.Fprintln(stderr, "piwork-serve: Core could not open its HTTP listener")
		return 1
	}
	if err := json.NewEncoder(stdout).Encode(map[string]any{"event": "core.listening", "url": bound.URL(), "pid": os.Getpid(), "dataDirectory": directory}); err != nil {
		a.cancel()
		cleanup, cancel := context.WithTimeout(context.Background(), shutdown.ShutdownTimeout)
		defer cancel()
		_ = a.Close(cleanup)
		fmt.Fprintln(stderr, "piwork-serve: Core startup output could not be written")
		return 1
	}
	var serverError error
	select {
	case <-ctx.Done():
	case serverError = <-a.serveDone:
	}
	cleanup, cancel := context.WithTimeout(context.Background(), shutdown.ShutdownTimeout)
	defer cancel()
	if err := a.Close(cleanup); err != nil {
		fmt.Fprintln(stderr, "piwork-serve: Core shutdown was not confirmed")
		return 1
	}
	if serverError != nil {
		fmt.Fprintln(stderr, "piwork-serve: Core HTTP listener stopped unexpectedly")
		return 1
	}
	return 0
}
func serveUsage(stderr io.Writer) int {
	fmt.Fprintln(stderr, "piwork-serve: invalid or repeated serve option; use serve --help")
	return 2
}
