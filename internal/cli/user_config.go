package cli

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/url"
	"os"
	"regexp"
	"sort"
	"strings"

	"piwork/internal/client"
)

type configCommand struct {
	method, path, kind, file string
	input                    any
	packages                 []map[string]any
	wait                     bool
}

var packageNamePattern = regexp.MustCompile(`^(?:@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*$`)

func validateUserConfig(args []string) error {
	_, err := parseUserConfig(args)
	return err
}

func parseUserConfig(args []string) (configCommand, error) {
	invalid := errors.New("invalid work config command; run piwork-cli --help")
	if len(args) < 2 {
		return configCommand{}, invalid
	}
	verb := args[0]
	if verb == "skills" || verb == "packages" || verb == "agents" {
		if len(args) < 3 || args[2] == "" || strings.HasPrefix(args[2], "--") {
			return configCommand{}, invalid
		}
		sub, workID := args[1], args[2]
		path := "/api/v1/works/" + url.PathEscape(workID) + "/configuration/" + verb
		if sub == "list" && verb != "agents" || sub == "show" && verb == "agents" {
			if len(args) != 3 {
				return configCommand{}, invalid
			}
			return configCommand{method: "GET", path: path, kind: "read"}, nil
		}
		if sub != "set" {
			return configCommand{}, invalid
		}
		if verb == "agents" {
			if len(args) != 5 || args[3] != "--file" || args[4] == "" || strings.HasPrefix(args[4], "--") {
				return configCommand{}, invalid
			}
			return configCommand{method: "PUT", path: path, kind: "agents", file: args[4]}, nil
		}
		flag, none := "--skill", "--no-skills"
		if verb == "packages" {
			flag, none = "--package", "--no-packages"
		}
		values, err := parseConfigSelection(args[3:], flag, none)
		if err != nil || values == nil {
			return configCommand{}, invalid
		}
		if verb == "skills" {
			return configCommand{method: "PUT", path: path, kind: "selection", input: map[string]any{"skills": values}}, nil
		}
		return configCommand{method: "PUT", path: path, kind: "selection", input: map[string]any{"packages": packageEntries(values)}}, nil
	}
	workID := args[1]
	if workID == "" || strings.HasPrefix(workID, "--") {
		return configCommand{}, invalid
	}
	path := "/api/v1/works/" + url.PathEscape(workID) + "/configuration"
	switch verb {
	case "show":
		if len(args) != 2 {
			return configCommand{}, invalid
		}
		return configCommand{method: "GET", path: path, kind: "read"}, nil
	case "apply":
		options, err := parseWorkMutationOptions(args[2:], false)
		if err != nil {
			return configCommand{}, invalid
		}
		return configCommand{method: "POST", path: path + "/apply", kind: "apply", input: options["--idempotency-key"], wait: options["--wait"] == "true"}, nil
	case "set":
		file := ""
		var selection []string
		var options []string
		for i := 2; i < len(args); i++ {
			if args[i] == "--config" {
				if file != "" || i+1 >= len(args) || args[i+1] == "" || strings.HasPrefix(args[i+1], "--") {
					return configCommand{}, invalid
				}
				i++
				file = args[i]
			} else {
				options = append(options, args[i])
			}
		}
		if len(options) > 0 {
			var err error
			selection, err = parseConfigSelection(options, "--package", "--no-packages")
			if err != nil {
				return configCommand{}, invalid
			}
		}
		if file == "" && selection == nil {
			return configCommand{}, invalid
		}
		if file == "" {
			return configCommand{method: "PUT", path: path + "/packages", kind: "selection", input: map[string]any{"packages": packageEntries(selection)}}, nil
		}
		cmd := configCommand{method: "PUT", path: path, kind: "config", file: file}
		if selection != nil {
			cmd.packages = packageEntries(selection)
		}
		return cmd, nil
	}
	return configCommand{}, invalid
}

func parseConfigSelection(args []string, flag, none string) ([]string, error) {
	var values []string
	seen := map[string]bool{}
	empty := false
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case none:
			if empty || len(values) > 0 {
				return nil, errors.New("selection flags conflict")
			}
			empty = true
		case flag:
			if empty || i+1 >= len(args) || args[i+1] == "" || strings.HasPrefix(args[i+1], "--") {
				return nil, errors.New("selection value required")
			}
			i++
			value := args[i]
			if seen[value] {
				return nil, errors.New("duplicate selection")
			}
			seen[value] = true
			if flag == "--package" && (len(value) > 214 || !packageNamePattern.MatchString(value)) {
				return nil, errors.New("invalid package selection")
			}
			values = append(values, value)
		default:
			return nil, errors.New("unknown selection option")
		}
	}
	if empty {
		return []string{}, nil
	}
	if len(values) == 0 || len(values) > 64 {
		return nil, errors.New("selection required or exceeds limit")
	}
	sort.Strings(values)
	return values, nil
}

func packageEntries(names []string) []map[string]any {
	items := make([]map[string]any, 0, len(names))
	for _, name := range names {
		items = append(items, map[string]any{"name": name, "enabled": true})
	}
	return items
}

func readConfigFile(path string) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	raw, err := io.ReadAll(io.LimitReader(f, (1<<20)+1))
	if err != nil {
		return nil, err
	}
	if len(raw) > 1<<20 {
		return nil, errors.New("configuration file exceeds 1 MiB")
	}
	return raw, nil
}

func runUserConfig(ctx context.Context, api *client.Client, args []string, stderr io.Writer) (any, error) {
	command, err := parseUserConfig(args)
	if err != nil {
		return nil, err
	}
	input := command.input
	switch command.kind {
	case "agents":
		raw, err := readConfigFile(command.file)
		if err != nil {
			return nil, err
		}
		input = map[string]any{"agentsMd": string(raw)}
	case "config":
		raw, err := readConfigFile(command.file)
		if err != nil {
			return nil, err
		}
		var configuration map[string]any
		if json.Unmarshal(raw, &configuration) != nil || configuration == nil {
			return nil, errors.New("configuration file must contain a JSON object")
		}
		if command.packages != nil {
			configuration["packages"] = command.packages
		}
		input = map[string]any{"configuration": configuration}
	case "apply":
		key, _ := input.(string)
		if key == "" {
			key, err = randomKey()
			if err != nil {
				return nil, err
			}
		}
		input = map[string]string{"idempotencyKey": key}
	}
	var result json.RawMessage
	if err := api.Request(ctx, command.method, command.path, input, &result); err != nil {
		return nil, err
	}
	if command.kind != "apply" || !command.wait {
		return result, nil
	}
	var accepted map[string]any
	if json.Unmarshal(result, &accepted) != nil {
		return nil, errors.New("Core did not return an Operation")
	}
	return observeUserOperation(ctx, api, accepted, stderr)
}
