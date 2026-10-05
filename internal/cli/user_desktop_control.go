package cli

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"

	"piwork/internal/client"
	"piwork/internal/contracts"
)

var desktopIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9-]{0,127}$`)
var desktopNamePattern = regexp.MustCompile(`^(?:@[a-z0-9][a-z0-9._-]*/)?[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`)

type desktopControl struct {
	method string
	path   string
	input  any
	status int
}

func desktopResourcePart(raw string, pattern *regexp.Regexp) (string, bool) {
	value, err := url.PathUnescape(raw)
	return value, err == nil && pattern.MatchString(value) && !strings.ContainsAny(value, "\\\x00")
}

func desktopControlInput(r *http.Request, allowed ...string) (map[string]json.RawMessage, error) {
	input, err := readDesktopObject(r, 1<<20)
	if err != nil {
		return nil, err
	}
	for name := range input {
		valid := false
		for _, expected := range allowed {
			if name == expected {
				valid = true
			}
		}
		if !valid {
			return nil, errors.New("INVALID_INPUT")
		}
	}
	return input, nil
}

func desktopRandomKey() (string, error) {
	var raw [16]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", err
	}
	return "desktop-" + hex.EncodeToString(raw[:]), nil
}

func desktopFieldString(input map[string]json.RawMessage, name string, maximum int) (string, bool) {
	var value string
	if json.Unmarshal(input[name], &value) != nil || strings.TrimSpace(value) == "" || len(value) > maximum || strings.ContainsRune(value, 0) {
		return "", false
	}
	return value, true
}

func (d *nativeDesktop) serveControl(w http.ResponseWriter, r *http.Request) bool {
	if !strings.HasPrefix(r.URL.EscapedPath(), "/_desktop/api/") {
		return false
	}
	view := d.view(r.Context(), "")
	if view["state"] != "authenticated" {
		desktopError(w, 401, "AUTH_REQUIRED")
		return true
	}
	d.mu.Lock()
	if d.identity.credential == nil || !d.identity.checked {
		d.mu.Unlock()
		desktopError(w, 401, "AUTH_REQUIRED")
		return true
	}
	coreURL, token, generation, userID := d.identity.coreURL, d.identity.credential.Token, d.identity.generation, d.identity.credential.User.ID
	d.mu.Unlock()
	plan, handled, err := planDesktopControl(r)
	if !handled {
		return false
	}
	if err != nil {
		desktopControlFailure(w, err)
		return true
	}
	api, err := client.New(coreURL, token)
	if err != nil {
		desktopError(w, 503, "CORE_UNAVAILABLE")
		return true
	}
	var result json.RawMessage
	err = api.Request(r.Context(), plan.method, plan.path, plan.input, &result)
	if err != nil {
		var apiErr *client.APIError
		if errors.As(err, &apiErr) && apiErr.Status == 401 {
			d.revokeToken(coreURL, token)
		}
		desktopControlFailure(w, err)
		return true
	}
	d.mu.Lock()
	current := generation == d.identity.generation && d.identity.checked && d.identity.credential != nil && d.identity.credential.Token == token
	d.mu.Unlock()
	if !current {
		desktopError(w, 409, "CONNECTION_CHANGED")
		return true
	}
	if r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/_desktop/api/operations/") {
		var operation struct {
			State string `json:"state"`
		}
		if json.Unmarshal(result, &operation) == nil && (operation.State == "succeeded" || operation.State == "failed" || operation.State == "superseded") {
			id := strings.TrimPrefix(r.URL.Path, "/_desktop/api/operations/")
			if desktopIDPattern.MatchString(id) {
				_ = (desktopOperationRecords{credentialPath: d.store.Path}).markTerminal(coreURL, userID, id)
			}
		}
	}
	if r.Method != http.MethodGet && plan.status == 202 {
		var accepted struct {
			OperationID string `json:"operationId"`
		}
		if json.Unmarshal(result, &accepted) == nil && desktopIDPattern.MatchString(accepted.OperationID) {
			var value map[string]json.RawMessage
			if json.Unmarshal(result, &value) == nil {
				saved := (desktopOperationRecords{credentialPath: d.store.Path}).accept(coreURL, userID, desktopOperationType(r.URL.Path), result) == nil
				value["localRecordSaved"], _ = json.Marshal(saved)
				desktopJSON(w, plan.status, value)
				return true
			}
		}
	}
	if len(result) == 0 {
		desktopJSON(w, plan.status, map[string]any{})
	} else {
		desktopJSON(w, plan.status, result)
	}
	return true
}

func desktopOperationType(path string) string {
	switch {
	case path == "/_desktop/api/works":
		return "Create Work"
	case strings.HasSuffix(path, "/exports"):
		return "Export Work"
	case strings.HasSuffix(path, "/apply"):
		return "Apply Work configuration"
	case strings.Contains(path, "/services/"):
		return "Service action"
	case strings.Contains(path, "/packages"):
		return "Pi Package action"
	case strings.Contains(path, "/works/"):
		return "Work action"
	default:
		return "Operation"
	}
}

func desktopControlFailure(w http.ResponseWriter, err error) {
	var apiErr *client.APIError
	if errors.As(err, &apiErr) {
		status := apiErr.Status
		if status < 400 || status > 599 {
			status = 503
		}
		if apiErr.Code != "" {
			message := apiErr.Code
			if status < 500 && apiErr.Text != "" {
				message = apiErr.Text
			}
			desktopJSON(w, status, map[string]string{"code": apiErr.Code, "message": message})
		} else {
			desktopError(w, status, "CORE_UNAVAILABLE")
		}
		return
	}
	switch err.Error() {
	case "JSON_REQUIRED":
		desktopError(w, 415, "JSON_REQUIRED")
	case "REQUEST_TOO_LARGE":
		desktopError(w, 413, "REQUEST_TOO_LARGE")
	case "INVALID_JSON":
		desktopError(w, 400, "INVALID_JSON")
	default:
		desktopError(w, 400, "INVALID_INPUT")
	}
}

func planDesktopControl(r *http.Request) (desktopControl, bool, error) {
	path := strings.TrimPrefix(r.URL.EscapedPath(), "/_desktop/api/")
	parts := strings.Split(path, "/")
	if path == "" || strings.Contains(path, "//") {
		return desktopControl{}, false, nil
	}
	for _, part := range parts {
		if part == "" {
			return desktopControl{}, false, nil
		}
	}
	feedbackRead := r.Method == http.MethodGet && len(parts) >= 3 && len(parts) <= 4 && parts[0] == "works" && parts[2] == "agent-requests"
	if r.URL.RawQuery != "" && !feedbackRead && !(len(parts) == 5 && parts[0] == "works" && parts[2] == "services" && parts[4] == "logs") {
		return desktopControl{}, true, errors.New("INVALID_INPUT")
	}
	method := r.Method
	create := func(method, path string, input any, status int) (desktopControl, bool, error) {
		return desktopControl{method: method, path: path, input: input, status: status}, true, nil
	}
	identifier := func(raw string) (string, error) {
		id, ok := desktopResourcePart(raw, desktopIDPattern)
		if !ok {
			return "", errors.New("INVALID_INPUT")
		}
		return url.PathEscape(id), nil
	}
	name := func(raw string) (string, error) {
		value, ok := desktopResourcePart(raw, desktopNamePattern)
		if !ok {
			return "", errors.New("INVALID_INPUT")
		}
		return strings.ReplaceAll(url.PathEscape(value), "@", "%40"), nil
	}
	mutationKey := func() (string, error) { return desktopRandomKey() }
	if method == http.MethodGet && (parts[0] == "skills" || parts[0] == "packages") && len(parts) <= 2 {
		corePath := "/api/v1/" + parts[0]
		if len(parts) == 2 {
			value, err := name(parts[1])
			if err != nil {
				return desktopControl{}, true, err
			}
			corePath += "/" + value
		}
		return create(method, corePath, nil, 200)
	}
	if method == http.MethodGet && len(parts) == 2 && (parts[0] == "operations" || parts[0] == "work-snapshots") {
		id, err := identifier(parts[1])
		if err != nil {
			return desktopControl{}, true, err
		}
		return create(method, "/api/v1/"+parts[0]+"/"+id, nil, 200)
	}
	if parts[0] != "works" {
		return desktopControl{}, false, nil
	}
	if len(parts) == 1 {
		if method == http.MethodGet {
			return create(method, "/api/v1/works", nil, 200)
		}
		if method != http.MethodPost {
			return desktopControl{}, false, nil
		}
		input, err := desktopControlInput(r, "name", "configuration", "baseImage", "skills", "packages", "agentsMd")
		if err != nil {
			return desktopControl{}, true, err
		}
		if _, ok := desktopFieldString(input, "name", 128); !ok {
			return desktopControl{}, true, errors.New("INVALID_INPUT")
		}
		key, err := mutationKey()
		if err != nil {
			return desktopControl{}, true, err
		}
		input["idempotencyKey"], _ = json.Marshal(key)
		return create(method, "/api/v1/works", input, 202)
	}
	workID, err := identifier(parts[1])
	if err != nil {
		return desktopControl{}, true, err
	}
	base := "/api/v1/works/" + workID
	if len(parts) == 2 && method == http.MethodGet {
		return create(method, base, nil, 200)
	}
	if len(parts) < 3 {
		return desktopControl{}, false, nil
	}
	if len(parts) == 3 && method == http.MethodPost {
		for _, action := range []string{"start", "stop", "retry", "delete"} {
			if parts[2] == action {
				key, err := mutationKey()
				if err != nil {
					return desktopControl{}, true, err
				}
				return create(method, base+"/"+action, map[string]string{"idempotencyKey": key}, 202)
			}
		}
	}
	if parts[2] == "services" {
		servicePath := base + "/services"
		if len(parts) == 3 && method == http.MethodGet {
			return create(method, servicePath, nil, 200)
		}
		if len(parts) < 4 {
			return desktopControl{}, false, nil
		}
		serviceID, err := identifier(parts[3])
		if err != nil {
			return desktopControl{}, true, err
		}
		servicePath += "/" + serviceID
		if len(parts) == 4 && method == http.MethodGet {
			return create(method, servicePath, nil, 200)
		}
		if len(parts) == 5 && parts[4] == "logs" && method == http.MethodGet {
			query := r.URL.Query()
			if len(query) > 1 || len(query["tailLines"]) > 1 {
				return desktopControl{}, true, errors.New("INVALID_INPUT")
			}
			tail := 100
			if query.Has("tailLines") {
				value, err := strconv.Atoi(query.Get("tailLines"))
				if err != nil || value < 1 || value > 200 {
					return desktopControl{}, true, errors.New("INVALID_INPUT")
				}
				tail = value
			}
			return create(method, servicePath+"/logs?tailLines="+strconv.Itoa(tail), nil, 200)
		}
		if len(parts) == 5 && method == http.MethodPost {
			action := map[string]string{"start": "enable", "stop": "disable", "restart": "restart", "retry": "retry", "remove": "remove"}[parts[4]]
			if action != "" {
				key, err := mutationKey()
				if err != nil {
					return desktopControl{}, true, err
				}
				return create(method, servicePath+"/"+action, map[string]string{"idempotencyKey": key}, 202)
			}
		}
		return desktopControl{}, false, nil
	}
	if parts[2] == "configuration" {
		path := base + "/configuration"
		if len(parts) == 3 {
			if method == http.MethodGet {
				return create(method, path, nil, 200)
			}
			if method == http.MethodPut {
				input, err := desktopControlInput(r, "configuration")
				if err != nil || len(input["configuration"]) == 0 {
					return desktopControl{}, true, errors.New("INVALID_INPUT")
				}
				return create(method, path, input, 200)
			}
		}
		if len(parts) == 4 {
			switch parts[3] {
			case "apply":
				if method == http.MethodPost {
					key, err := mutationKey()
					if err != nil {
						return desktopControl{}, true, err
					}
					return create(method, path+"/apply", map[string]string{"idempotencyKey": key}, 202)
				}
			case "skills", "packages", "agents":
				if method == http.MethodGet {
					return create(method, path+"/"+parts[3], nil, 200)
				}
				if method == http.MethodPut {
					field := map[string]string{"skills": "skills", "packages": "packages", "agents": "agentsMd"}[parts[3]]
					input, err := desktopControlInput(r, field)
					if err != nil || len(input[field]) == 0 {
						return desktopControl{}, true, errors.New("INVALID_INPUT")
					}
					return create(method, path+"/"+parts[3], input, 200)
				}
			}
		}
		return desktopControl{}, false, nil
	}
	if parts[2] == "packages" {
		path := base + "/packages"
		if len(parts) == 3 {
			if method == http.MethodGet {
				return create(method, path, nil, 200)
			}
			if method == http.MethodPost {
				input, err := desktopControlInput(r, "source")
				if err != nil || len(input["source"]) == 0 {
					return desktopControl{}, true, errors.New("INVALID_INPUT")
				}
				key, err := mutationKey()
				if err != nil {
					return desktopControl{}, true, err
				}
				input["idempotencyKey"], _ = json.Marshal(key)
				return create(method, path, input, 202)
			}
		}
		if len(parts) < 4 {
			return desktopControl{}, false, nil
		}
		packageName, err := name(parts[3])
		if err != nil {
			return desktopControl{}, true, err
		}
		path += "/" + packageName
		if len(parts) == 4 && (method == http.MethodGet || method == http.MethodDelete) {
			return create(method, path, nil, 200)
		}
		if len(parts) == 5 && method == http.MethodPost {
			if parts[4] == "update" {
				input, err := desktopControlInput(r, "source")
				if err != nil || len(input["source"]) == 0 {
					return desktopControl{}, true, errors.New("INVALID_INPUT")
				}
				key, err := mutationKey()
				if err != nil {
					return desktopControl{}, true, err
				}
				input["idempotencyKey"], _ = json.Marshal(key)
				return create(method, path+"/update", input, 202)
			}
			if parts[4] == "enable" || parts[4] == "disable" {
				return create(method, path+"/"+parts[4], nil, 200)
			}
		}
		return desktopControl{}, false, nil
	}
	if (parts[2] == "models" || parts[2] == "chat-capabilities" || parts[2] == "chat-models" || parts[2] == "commands") && len(parts) == 3 && method == http.MethodGet {
		return create(method, base+"/"+parts[2], nil, 200)
	}
	if parts[2] == "agent-requests" || parts[2] == "evidence" {
		resource := parts[2]
		path := base + "/" + resource
		if len(parts) >= 4 {
			id, err := identifier(parts[3])
			if err != nil {
				return desktopControl{}, true, err
			}
			path += "/" + id
		}
		if method == http.MethodGet && len(parts) <= 4 && (resource == "agent-requests" || len(parts) == 4) {
			schema := "AgentRequestQuerySchema"
			if len(parts) == 4 {
				schema = "AgentEvidenceQuerySchema"
			}
			if resource == "evidence" && r.URL.RawQuery != "" {
				return desktopControl{}, true, errors.New("INVALID_INPUT")
			}
			input := map[string]any{}
			for key, values := range r.URL.Query() {
				if len(values) != 1 || values[0] == "" {
					return desktopControl{}, true, errors.New("INVALID_INPUT")
				}
				if key == "limit" {
					n, err := strconv.ParseInt(values[0], 10, 64)
					if err != nil {
						return desktopControl{}, true, errors.New("INVALID_INPUT")
					}
					input[key] = n
				} else {
					input[key] = values[0]
				}
			}
			if contracts.Validate(schema, input) != nil {
				return desktopControl{}, true, errors.New("INVALID_INPUT")
			}
			if r.URL.RawQuery != "" {
				path += "?" + r.URL.Query().Encode()
			}
			return create(method, path, nil, 200)
		}
		if resource == "agent-requests" && len(parts) == 5 && method == http.MethodPost {
			if parts[4] == "cancel" {
				input, err := desktopControlInput(r)
				if err != nil {
					return desktopControl{}, true, err
				}
				return create(method, path+"/cancel", input, 200)
			}
			if parts[4] == "retry" {
				input, err := desktopControlInput(r, "submissionKey")
				if err != nil {
					return desktopControl{}, true, err
				}
				key, okay := desktopFieldString(input, "submissionKey", 256)
				if !okay {
					return desktopControl{}, true, errors.New("INVALID_INPUT")
				}
				return create(method, path+"/retry", map[string]string{"submissionKey": key}, 200)
			}
		}
		return desktopControl{}, false, nil
	}
	if (parts[2] == "sessions" || parts[2] == "runs") && len(parts) == 5 && parts[3] == "submissions" && method == http.MethodGet {
		key, err := url.PathUnescape(parts[4])
		if err != nil || contracts.Validate("ChatSubmissionKeySchema", key) != nil {
			return desktopControl{}, true, errors.New("INVALID_INPUT")
		}
		return create(method, base+"/"+parts[2]+"/submissions/"+url.PathEscape(key), nil, 200)
	}
	if parts[2] == "sessions" {
		path := base + "/sessions"
		if len(parts) == 5 && parts[4] == "chat-options" && (method == http.MethodGet || method == http.MethodPatch) {
			sessionID, err := identifier(parts[3])
			if err != nil {
				return desktopControl{}, true, err
			}
			if method == http.MethodGet {
				return create(method, path+"/"+sessionID+"/chat-options", nil, 200)
			}
			input, err := desktopControlInput(r, "modelRef", "thinkingLevel")
			if err != nil {
				return desktopControl{}, true, err
			}
			raw, _ := json.Marshal(input)
			value, err := contracts.ParseJSON(strings.NewReader(string(raw)), 4096)
			if err != nil || contracts.Validate("SetSessionChatOptionsSchema", value) != nil {
				return desktopControl{}, true, errors.New("INVALID_INPUT")
			}
			return create(method, path+"/"+sessionID+"/chat-options", input, 200)
		}
		if len(parts) == 5 && parts[4] == "model" && method == http.MethodPatch {
			sessionID, err := identifier(parts[3])
			if err != nil {
				return desktopControl{}, true, err
			}
			input, err := desktopControlInput(r, "modelRef")
			if err != nil {
				return desktopControl{}, true, err
			}
			raw, _ := json.Marshal(input)
			value, err := contracts.ParseJSON(strings.NewReader(string(raw)), 4096)
			if err != nil || contracts.Validate("SetSessionModelSchema", value) != nil {
				return desktopControl{}, true, errors.New("INVALID_INPUT")
			}
			return create(method, path+"/"+sessionID+"/model", input, 200)
		}
		if len(parts) == 3 && method == http.MethodGet {
			return create(method, path, nil, 200)
		}
		if len(parts) == 3 && method == http.MethodPost {
			input, err := desktopControlInput(r, "idempotencyKey")
			if err != nil {
				return desktopControl{}, true, err
			}
			key, err := desktopOriginalKey(input, "idempotencyKey")
			if err != nil {
				return desktopControl{}, true, err
			}
			return create(method, path, map[string]string{"idempotencyKey": key}, 202)
		}
		if len(parts) == 4 && method == http.MethodGet {
			sessionID, err := identifier(parts[3])
			if err != nil {
				return desktopControl{}, true, err
			}
			return create(method, path+"/"+sessionID, nil, 200)
		}
		return desktopControl{}, false, nil
	}
	if parts[2] == "runs" {
		path := base + "/runs"
		if len(parts) == 3 && method == http.MethodPost {
			input, err := desktopControlInput(r, "sessionId", "prompt", "modelRef", "submissionKey", "inputMode")
			if err != nil {
				return desktopControl{}, true, err
			}
			if model, exists := input["modelRef"]; exists {
				var value any
				if json.Unmarshal(model, &value) != nil || value != nil && contracts.Validate("ResourceIdSchema", value) != nil {
					return desktopControl{}, true, errors.New("INVALID_INPUT")
				}
			}
			sessionID, valid := desktopFieldString(input, "sessionId", 128)
			if _, okay := desktopResourcePart(sessionID, desktopIDPattern); !okay || !valid {
				return desktopControl{}, true, errors.New("INVALID_INPUT")
			}
			if _, valid := desktopFieldString(input, "prompt", 65536); !valid {
				return desktopControl{}, true, errors.New("INVALID_INPUT")
			}
			if mode, exists := input["inputMode"]; exists {
				var value any
				if json.Unmarshal(mode, &value) != nil || contracts.Validate("ChatInputModeSchema", value) != nil {
					return desktopControl{}, true, errors.New("INVALID_INPUT")
				}
			}
			key, err := desktopOriginalKey(input, "submissionKey")
			if err != nil {
				return desktopControl{}, true, err
			}
			input["submissionKey"], _ = json.Marshal(key)
			return create(method, path, input, 202)
		}
		if len(parts) >= 4 {
			runID, err := identifier(parts[3])
			if err != nil {
				return desktopControl{}, true, err
			}
			path += "/" + runID
			if len(parts) == 4 && method == http.MethodGet {
				return create(method, path, nil, 200)
			}
			if len(parts) == 5 && parts[4] == "cancel" && method == http.MethodPost {
				key, err := mutationKey()
				if err != nil {
					return desktopControl{}, true, err
				}
				return create(method, path+"/cancel", map[string]string{"idempotencyKey": key}, 202)
			}
		}
		return desktopControl{}, false, nil
	}
	if parts[2] == "exports" && len(parts) == 3 && method == http.MethodPost {
		key, err := mutationKey()
		if err != nil {
			return desktopControl{}, true, err
		}
		return create(method, base+"/exports", map[string]string{"idempotencyKey": key}, 202)
	}
	return desktopControl{}, false, nil
}

func desktopOriginalKey(input map[string]json.RawMessage, name string) (string, error) {
	if _, exists := input[name]; !exists {
		return desktopRandomKey()
	}
	key, okay := desktopFieldString(input, name, 256)
	if !okay || contracts.Validate("ChatSubmissionKeySchema", key) != nil {
		return "", errors.New("INVALID_INPUT")
	}
	return key, nil
}
