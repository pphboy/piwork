// Package coreoperator implements the daemon's operator command surface.
// It cannot read user CLI credentials or call conversation endpoints.
package coreoperator

import (
	"errors"
	"fmt"
	"path/filepath"
	"piwork/internal/pipackage"
	"regexp"
	"strings"
)

const Usage = `usage: piwork-serve [--core URL] [--env-file FILE] [--data-dir DIR] [--operator-credential-file FILE] [--json] COMMAND
  serve [--data-dir DIR] [--listen HOST:PORT] [--env-file FILE] [--allow-insecure-remote]
  status
  admin bootstrap --account NAME [--password-stdin]
  admin users list
  admin users create --account NAME [--role admin|user] [--password-stdin]
  admin users enable USER_ID
  admin users disable USER_ID
  admin users reset-credential USER_ID [--password-stdin]
  config show
  config set --agent-image IMAGE --model-provider PROVIDER --model ID [--model-base-url URL] [--api-key-stdin | --api-key-file FILE]
  config default-work show
  config default-work set [--base-image IMAGE] [--skill NAME]... [--no-skills] [--package NAME]... [--no-packages] [--agents-md-file FILE]
  skills list|show NAME
  skills add --path ABSOLUTE_DIRECTORY
  skills update NAME --path ABSOLUTE_DIRECTORY
  skills enable|disable|remove NAME
  packages list|show NAME
  packages install SOURCE [--default] [--wait] [--verbose]
  packages update NAME --source SOURCE [--wait] [--verbose]
  packages enable|disable|remove NAME
  operation show OPERATION_ID
  --version

piwork is an alias of this operator program; user commands use piwork-cli.
Secrets are read without echo or with the explicit stdin/file option.
Bootstrap and config set may initialize an unlocked local data directory when
no explicit Core URL is selected and the default loopback Core is not running.
`

type invocation struct {
	globals             map[string]string
	json, help, version bool
	command             string
	options             map[string][]string
	id                  string
	source              pipackage.Source
	serveArgs           []string
}
type usageError struct{ message string }

func (e *usageError) Error() string { return e.message }
func usage(message string) error    { return &usageError{message} }

var globalFlags = map[string]bool{"--core": true, "--env-file": true, "--data-dir": true, "--operator-credential-file": true}
var account = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$`)
var resourceID = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$`)
var packageName = regexp.MustCompile(`^(?:@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*$`)

func parse(args []string) (invocation, error) {
	v := invocation{globals: map[string]string{}, options: map[string][]string{}}
	var rest []string
	// Globals are accepted before or after the command, preserving the documented
	// offline bootstrap spelling. Consume each value before interpreting it.
	for i := 0; i < len(args); i++ {
		a := args[i]
		if globalFlags[a] {
			if _, exists := v.globals[a]; exists {
				return v, usage("repeated global option")
			}
			if i+1 == len(args) || strings.HasPrefix(args[i+1], "--") || args[i+1] == "" {
				return v, usage("global option requires a value")
			}
			i++
			v.globals[a] = args[i]
		} else if a == "--json" {
			if v.json {
				return v, usage("repeated --json")
			}
			v.json = true
		} else {
			rest = append(rest, a)
		}
	}
	if len(rest) == 0 || rest[0] == "help" || rest[0] == "--help" || rest[0] == "-h" {
		v.help = true
		return v, nil
	}
	if len(rest) == 1 && (rest[0] == "--version" || rest[0] == "version") {
		v.version = true
		return v, nil
	}
	for _, a := range rest {
		if a == "--help" || a == "-h" {
			v.help = true
			return v, nil
		}
	}
	var options []string
	values, flags, repeated := map[string]bool{}, map[string]bool{}, map[string]bool{}
	switch rest[0] {
	case "serve":
		if v.json || v.globals["--core"] != "" || v.globals["--operator-credential-file"] != "" {
			return v, usage("operator connection options are not serve options")
		}
		v.command, v.serveArgs = "serve", append([]string(nil), rest[1:]...)
		for _, n := range []string{"--data-dir", "--env-file"} {
			if value := v.globals[n]; value != "" {
				v.serveArgs = append(v.serveArgs, n, value)
			}
		}
		return v, nil
	case "status":
		v.command, options = "status", rest[1:]
	case "admin":
		if len(rest) < 2 {
			return v, usage("admin requires bootstrap or users")
		}
		if rest[1] == "bootstrap" {
			v.command, options = "bootstrap", rest[2:]
			values["--account"], flags["--password-stdin"] = true, true
		} else if rest[1] == "users" && len(rest) >= 3 {
			v.command, options = "users-"+rest[2], rest[3:]
			switch rest[2] {
			case "list":
			case "create":
				values["--account"], values["--role"], flags["--password-stdin"] = true, true, true
			case "enable", "disable", "reset-credential":
				if len(options) == 0 || !resourceID.MatchString(options[0]) {
					return v, usage("user action requires a valid user ID")
				}
				v.id, options = options[0], options[1:]
				if rest[2] == "reset-credential" {
					flags["--password-stdin"] = true
				}
			default:
				return v, usage("unknown admin users action")
			}
		} else {
			return v, usage("admin requires bootstrap or users")
		}
	case "skills", "packages":
		if len(rest) < 2 {
			return v, usage("catalog command requires an action")
		}
		family, action := rest[0], rest[1]
		v.command, options = family+"-"+action, rest[2:]
		switch action {
		case "list":
		case "show", "enable", "disable", "remove", "update":
			if len(options) == 0 || strings.HasPrefix(options[0], "--") {
				return v, usage("catalog action requires a name")
			}
			v.id, options = options[0], options[1:]
			if family == "packages" && !pipackage.ValidName(v.id) || family == "skills" && !resourceID.MatchString(v.id) {
				return v, usage("invalid catalog name")
			}
			if action == "update" {
				if family == "skills" {
					values["--path"] = true
				} else {
					values["--source"] = true
					flags["--wait"], flags["--verbose"] = true, true
				}
			}
		case "add":
			if family != "skills" {
				return v, usage("packages use install")
			}
			values["--path"] = true
		case "install":
			if family != "packages" || len(options) == 0 || strings.HasPrefix(options[0], "--") {
				return v, usage("packages install requires one source")
			}
			var err error
			v.source, err = pipackage.ParseSource(options[0])
			if err != nil {
				return v, usage("invalid package source")
			}
			options = options[1:]
			flags["--default"], flags["--wait"], flags["--verbose"] = true, true, true
		default:
			return v, usage("unknown catalog action")
		}
	case "operation":
		if len(rest) < 3 || rest[1] != "show" || !resourceID.MatchString(rest[2]) {
			return v, usage("operation requires show and a valid operation ID")
		}
		v.command, v.id, options = "operation-show", rest[2], rest[3:]
	case "config":
		if len(rest) < 2 {
			return v, usage("config requires show, set, or default-work")
		}
		switch rest[1] {
		case "show":
			v.command, options = "runtime-show", rest[2:]
		case "set":
			v.command, options = "runtime-set", rest[2:]
			for _, n := range []string{"--agent-image", "--model-provider", "--model", "--model-base-url", "--api-key-file"} {
				values[n] = true
			}
			flags["--api-key-stdin"] = true
		case "default-work":
			if len(rest) < 3 || rest[2] != "show" && rest[2] != "set" {
				return v, usage("default-work requires show or set")
			}
			v.command, options = "default-"+rest[2], rest[3:]
			if rest[2] == "set" {
				for _, n := range []string{"--base-image", "--skill", "--package", "--agents-md-file"} {
					values[n] = true
				}
				flags["--no-skills"], flags["--no-packages"] = true, true
				repeated["--skill"], repeated["--package"] = true, true
			}
		default:
			return v, usage("unknown config action")
		}
	default:
		if strings.Contains("|login|logout|whoami|work|session|run|chat|proxy|desktop|", "|"+rest[0]+"|") {
			return v, usage("user command requires piwork-cli")
		}
		return v, usage("unknown operator command")
	}
	for i := 0; i < len(options); i++ {
		n := options[i]
		if !values[n] && !flags[n] {
			return v, usage("unknown command option")
		}
		if _, exists := v.options[n]; exists && !repeated[n] {
			return v, usage("repeated command option")
		}
		value := "true"
		if values[n] {
			if i+1 == len(options) || strings.HasPrefix(options[i+1], "--") || options[i+1] == "" {
				return v, usage("command option requires a value")
			}
			i++
			value = options[i]
		}
		v.options[n] = append(v.options[n], value)
	}
	if v.command == "bootstrap" || v.command == "users-create" {
		if !account.MatchString(v.one("--account")) {
			return v, usage("a valid --account is required")
		}
		if role := v.one("--role"); role != "" && role != "admin" && role != "user" {
			return v, usage("--role must be admin or user")
		}
	}
	if v.command == "runtime-set" {
		for _, n := range []string{"--agent-image", "--model-provider", "--model"} {
			if v.one(n) == "" {
				return v, usage(fmt.Sprintf("%s is required", n))
			}
		}
		if v.has("--api-key-stdin") && v.has("--api-key-file") {
			return v, usage("choose only one API key input")
		}
	}
	if v.command == "packages-update" {
		if !v.has("--source") {
			return v, usage("packages update requires --source")
		}
		var err error
		v.source, err = pipackage.ParseSource(v.one("--source"))
		if err != nil {
			return v, usage("invalid package source")
		}
	}
	if v.has("--verbose") && !v.has("--wait") {
		return v, usage("--verbose requires --wait")
	}
	if v.command == "skills-add" || v.command == "skills-update" {
		if !filepath.IsAbs(v.one("--path")) {
			return v, usage("skills require an absolute --path directory")
		}
	}
	if v.command == "default-set" {
		for _, pair := range [][2]string{{"--skill", "--no-skills"}, {"--package", "--no-packages"}} {
			if v.has(pair[0]) && v.has(pair[1]) {
				return v, usage("selection and clearing flags are mutually exclusive")
			}
			seen := map[string]bool{}
			for _, value := range v.options[pair[0]] {
				if seen[value] {
					return v, usage("duplicate selection")
				}
				seen[value] = true
				if pair[0] == "--package" && (len(value) > 214 || !packageName.MatchString(value)) {
					return v, usage("invalid package name")
				}
			}
			if pair[0] == "--package" && len(seen) > 64 {
				return v, usage("too many packages")
			}
		}
	}
	return v, nil
}
func (v invocation) one(name string) string {
	if len(v.options[name]) == 0 {
		return ""
	}
	return v.options[name][0]
}
func (v invocation) has(name string) bool { return len(v.options[name]) != 0 }
func isUsage(err error) bool              { var target *usageError; return errors.As(err, &target) }
