package coreoperator

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"piwork/internal/buildinfo"
	"piwork/internal/contracts"
	"piwork/internal/coreapp"
	"piwork/internal/corestore"
	"piwork/internal/identity"
	"piwork/internal/safefs"
)

func Run(ctx context.Context, args []string, stdin io.Reader, stdout, stderr io.Writer) int {
	return run(ctx, args, stdin, stdout, stderr, os.Environ(), "http://127.0.0.1:7171")
}
func run(ctx context.Context, args []string, stdin io.Reader, stdout, stderr io.Writer, environment []string, fallback string) int {
	v, err := parse(args)
	if err != nil {
		return failure(err, stderr)
	}
	if v.help {
		fmt.Fprint(stdout, Usage)
		return 0
	}
	if v.version {
		return output(stdout, buildinfo.Read("piwork-serve"), false)
	}
	if err := ctx.Err(); err != nil {
		return failure(err, stderr)
	}
	if v.command == "serve" {
		return coreapp.RunServe(ctx, v.serveArgs, stdout, stderr)
	}
	// Complete local field checks before reading environment, secret files,
	// stdin, credentials, or network. A placeholder validates public fields only.
	if v.command == "runtime-set" {
		if err := coreapp.ValidateRuntime(runtimeInput(v, "validation-placeholder")); err != nil {
			return failure(usage("invalid runtime configuration fields"), stderr)
		}
	}
	file := map[string]string{}
	if name := v.globals["--env-file"]; name != "" {
		file, err = coreapp.ReadEnvironmentFile(name)
		if err != nil {
			return failure(errors.New("environment file is unavailable or invalid"), stderr)
		}
	}
	values := coreapp.MergeEnvironment(file, environment, nil)
	base := v.globals["--core"]
	if base == "" {
		base = values["PIWORK_CORE_URL"]
	}
	explicitEndpoint := base != ""
	if base == "" {
		base = fallback
	}
	c, err := connect(base)
	if err != nil {
		return failure(err, stderr)
	}
	defer c.close()
	directory := v.globals["--data-dir"]
	if directory == "" {
		directory = values["PIWORK_DATA_DIR"]
	}
	credential := v.globals["--operator-credential-file"]
	if credential == "" {
		credential = values["PIWORK_OPERATOR_CREDENTIAL_PATH"]
	}
	if credential == "" && directory != "" {
		credential = filepath.Join(directory, "operator.credential")
	}
	if v.command == "status" {
		result, err := c.request(ctx, "GET", "/control/status", nil)
		if err != nil {
			return failure(err, stderr)
		}
		return output(stdout, result, v.json)
	}
	offline := false
	if !explicitEndpoint && directory != "" && (v.command == "bootstrap" || v.command == "runtime-set") {
		// Only an unauthenticated read can select local initialization. A refused
		// connection is definitive here. Never replay a lost mutation locally,
		// fall back on timeouts, or borrow another endpoint's credentials.
		_, err = c.request(ctx, "GET", "/control/status", nil)
		var network *transportError
		if errors.As(err, &network) && network.refused {
			offline = true
		} else if err != nil {
			return failure(err, stderr)
		}
	}
	if !offline {
		if credential == "" {
			return failure(usage("operator commands require a data directory or an operator credential file"), stderr)
		}
		raw, err := protectedFile(credential, 512)
		if err != nil {
			return failure(err, stderr)
		}
		token := strings.TrimRight(string(raw), "\r\n")
		if len(token) < 32 || len(token) > 512 || strings.ContainsAny(token, "\r\n\x00") {
			return failure(errors.New("operator credential is malformed"), stderr)
		}
		c.token = token
	}
	if v.command == "packages-install" || v.command == "packages-update" {
		return runPackageMutation(ctx, c, v, stdout, stderr)
	}
	payload, method, path, err := prepare(ctx, v, stdin, stderr)
	if err != nil {
		return failure(err, stderr)
	}
	var result any
	if offline {
		result, err = initializeOffline(ctx, directory, credential, v, payload)
	} else {
		result, err = c.request(ctx, method, path, payload)
	}
	if err != nil {
		return failure(err, stderr)
	}
	return output(stdout, result, v.json)
}

func prepare(ctx context.Context, v invocation, input io.Reader, stderr io.Writer) (any, string, string, error) {
	switch v.command {
	case "operation-show":
		return nil, "GET", "/control/operations/" + url.PathEscape(v.id), nil
	case "skills-list", "packages-list":
		return nil, "GET", "/control/" + strings.TrimSuffix(v.command, "-list"), nil
	case "skills-add":
		return map[string]any{"path": v.one("--path")}, "POST", "/control/skills", nil
	case "skills-update":
		return map[string]any{"path": v.one("--path")}, "PUT", "/control/skills/" + url.PathEscape(v.id), nil
	case "skills-show", "skills-enable", "skills-disable", "skills-remove", "packages-show", "packages-enable", "packages-disable", "packages-remove":
		family, action, _ := strings.Cut(v.command, "-")
		path := "/control/" + family + "/" + url.PathEscape(v.id)
		method := "POST"
		if action == "show" {
			method = "GET"
		} else if action == "remove" {
			method = "DELETE"
		} else {
			path += "/" + action
		}
		return nil, method, path, nil
	case "bootstrap", "users-create", "users-reset-credential":
		password, err := readSecret(ctx, input, stderr, v.has("--password-stdin"), "Password: ")
		if err != nil {
			return nil, "", "", err
		}
		if err := identity.ValidatePassword(password); err != nil {
			return nil, "", "", err
		}
		if v.command == "users-reset-credential" {
			return map[string]any{"password": password}, "POST", "/control/users/" + url.PathEscape(v.id) + "/reset-credential", nil
		}
		body := map[string]any{"account": v.one("--account"), "password": password}
		path := "/control/admin/bootstrap"
		if v.command == "users-create" {
			path = "/control/users"
			if role := v.one("--role"); role != "" {
				body["role"] = role
			}
		}
		return body, "POST", path, nil
	case "users-list":
		return nil, "GET", "/control/users", nil
	case "users-enable", "users-disable":
		return nil, "POST", "/control/users/" + url.PathEscape(v.id) + "/" + strings.TrimPrefix(v.command, "users-"), nil
	case "runtime-show":
		return nil, "GET", "/control/runtime", nil
	case "runtime-set":
		var key string
		var err error
		if name := v.one("--api-key-file"); name != "" {
			var raw []byte
			raw, err = safefs.ReadProtectedFile(name, secretBytes)
			if err == nil {
				key, err = secretValue(raw)
			}
		} else {
			key, err = readSecret(ctx, input, stderr, v.has("--api-key-stdin"), "Model API key: ")
		}
		if err != nil {
			return nil, "", "", err
		}
		runtime := runtimeInput(v, key)
		if err := coreapp.ValidateRuntime(runtime); err != nil {
			return nil, "", "", err
		}
		body := map[string]any{"agentImage": runtime.AgentImage, "provider": runtime.Provider, "model": runtime.Model, "credential": runtime.Credential}
		if runtime.BaseURL != nil {
			body["baseUrl"] = *runtime.BaseURL
		}
		return body, "PUT", "/control/runtime", nil
	case "default-show":
		return nil, "GET", "/control/default-work", nil
	case "default-set":
		// Send only supplied fields: the Core atomically merges its current
		// defaults. A CLI read/merge/write would lose concurrent edits.
		patch := map[string]any{}
		if v.has("--base-image") {
			patch["baseImage"] = v.one("--base-image")
		}
		if v.has("--no-skills") {
			patch["skills"] = []string{}
		} else if v.has("--skill") {
			patch["skills"] = v.options["--skill"]
		}
		if v.has("--no-packages") {
			patch["packages"] = []any{}
		} else if v.has("--package") {
			names := append([]string(nil), v.options["--package"]...)
			sort.Strings(names)
			packages := make([]any, 0, len(names))
			for _, name := range names {
				packages = append(packages, map[string]any{"name": name, "enabled": true})
			}
			patch["packages"] = packages
		}
		if v.has("--agents-md-file") {
			// AGENTS is user content, not a secret; its parent need not be 0700.
			raw, err := readContentFile(v.one("--agents-md-file"), 1<<20)
			if err != nil {
				return nil, "", "", err
			}
			patch["agentsMd"] = string(raw)
		}
		return map[string]any{"patch": patch}, "PUT", "/control/default-work", nil
	}
	return nil, "", "", usage("unknown operator command")
}
func runtimeInput(v invocation, key string) coreapp.RuntimeInput {
	runtime := coreapp.RuntimeInput{AgentImage: v.one("--agent-image"), Provider: v.one("--model-provider"), Model: v.one("--model"), Credential: key}
	if v.has("--model-base-url") {
		base := v.one("--model-base-url")
		runtime.BaseURL = &base
	}
	return runtime
}
func initializeOffline(ctx context.Context, directory, credential string, v invocation, payload any) (any, error) {
	a, err := coreapp.New(ctx, coreapp.Options{DataDirectory: directory, OperatorCredentialPath: credential})
	if err != nil {
		return nil, err
	}
	defer func() {
		closing, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = a.Close(closing)
	}()
	body := payload.(map[string]any)
	if v.command == "bootstrap" {
		user, err := a.Identity.Bootstrap(ctx, body["account"].(string), body["password"].(string))
		if err != nil {
			return nil, err
		}
		return map[string]any{"userId": user.Id, "account": user.Account}, nil
	}
	return a.Settings.ConfigureRuntime(runtimeInput(v, body["credential"].(string)))
}
func output(writer io.Writer, value any, compact bool) int {
	encoder := json.NewEncoder(writer)
	if !compact {
		encoder.SetIndent("", "  ")
	}
	if encoder.Encode(value) != nil {
		return 1
	}
	return 0
}
func failure(err error, stderr io.Writer) int {
	if isUsage(err) {
		fmt.Fprintln(stderr, "piwork-serve:", err)
		return 2
	}
	if errors.Is(err, context.Canceled) {
		fmt.Fprintln(stderr, "piwork-serve: interrupted")
		return 130
	}
	var network *transportError
	if errors.As(err, &network) {
		fmt.Fprintln(stderr, "piwork-serve:", network)
		return 5
	}
	if errors.Is(err, safefs.ErrLocked) {
		fmt.Fprintln(stderr, "piwork-serve: another Core owns this data directory; use its online control endpoint")
		return 6
	}
	if errors.Is(err, corestore.ErrUnsupported) {
		fmt.Fprintln(stderr, "piwork-serve:", corestore.ErrUnsupported)
		return 1
	}
	status, view := contracts.ProjectError(err)
	var api *apiError
	if errors.As(err, &api) {
		status, view = api.status, api.public
	}
	fmt.Fprintf(stderr, "piwork-serve: %s: %s\n", view.Code, view.Message)
	if status == 401 || status == 403 {
		return 3
	}
	if view.Code == "ADMIN_REQUIRED" || view.Code == "RUNTIME_NOT_CONFIGURED" {
		return 4
	}
	if status == 409 {
		return 6
	}
	if status == 502 || status == 503 || status == 504 {
		return 7
	}
	return 1
}
