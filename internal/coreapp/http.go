package coreapp

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"

	"piwork/internal/contracts"
	"piwork/internal/identity"
)

func bearer(r *http.Request) (string, error) {
	values := r.Header.Values("Authorization")
	if len(values) != 1 || !strings.HasPrefix(values[0], "Bearer ") || len(values[0]) <= 7 {
		return "", contracts.NewError("AUTHENTICATION_REQUIRED", "")
	}
	return strings.TrimPrefix(values[0], "Bearer "), nil
}
func (a *Application) operator(r *http.Request) (identity.Principal, error) {
	values := r.Header.Values("Authorization")
	if len(values) != 1 || !strings.HasPrefix(values[0], "Operator ") || !a.Settings.VerifyOperator(r.Context(), strings.TrimPrefix(values[0], "Operator ")) {
		return identity.Principal{}, contracts.NewError("OPERATOR_AUTHENTICATION_REQUIRED", "")
	}
	return identity.OperatorPrincipal(), nil
}
func readJSON[T any](r *http.Request) (T, error) {
	var result T
	value, err := contracts.ParseJSON(r.Body, 1<<20)
	if err != nil {
		return result, err
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return result, contracts.NewError("INVALID_REQUEST", "")
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if d.Decode(&result) != nil {
		return result, contracts.NewError("INVALID_REQUEST", "")
	}
	return result, nil
}

type credentialInput struct {
	Account  contracts.Field[string] `json:"account"`
	Password contracts.Field[string] `json:"password"`
}

func readCredentials(r *http.Request) (string, string, error) {
	body, err := readJSON[credentialInput](r)
	if err != nil {
		return "", "", err
	}
	if !body.Account.Present || body.Account.Null || !body.Password.Present || body.Password.Null {
		return "", "", contracts.NewError("INVALID_REQUEST", "")
	}
	return body.Account.Value, body.Password.Value, nil
}
func readControlJSON[T any](r *http.Request, schema string, admin bool) (T, error) {
	if admin {
		values := r.Header.Values("Content-Type")
		if len(values) != 1 || values[0] != "application/json" {
			var zero T
			return zero, contracts.NewError("UNSUPPORTED_MEDIA_TYPE", "")
		}
	}
	body := &bodyReader{ReadCloser: r.Body}
	result, err := contracts.Decode[T](body, schema, 2<<20)
	if timedOut(body.err) {
		return result, contracts.NewError("REQUEST_TIMEOUT", "")
	}
	return result, err
}

type bodyReader struct {
	io.ReadCloser
	err error
}

func (r *bodyReader) Read(p []byte) (int, error) {
	n, err := r.ReadCloser.Read(p)
	if err != nil && err != io.EOF {
		r.err = err
	}
	return n, err
}
func timedOut(err error) bool {
	var timeout net.Error
	return errors.As(err, &timeout) && timeout.Timeout()
}
func readEmptyAction(r *http.Request, admin bool) error {
	raw, err := io.ReadAll(io.LimitReader(r.Body, (2<<20)+1))
	if err != nil {
		if timedOut(err) {
			return contracts.NewError("REQUEST_TIMEOUT", "")
		}
		return contracts.NewError("INVALID_JSON", "")
	}
	if len(raw) > 2<<20 {
		return contracts.NewError("REQUEST_TOO_LARGE", "")
	}
	if len(raw) == 0 {
		return nil
	}
	copy := r.Clone(r.Context())
	copy.Body = io.NopCloser(bytes.NewReader(raw))
	_, err = readControlJSON[contracts.AdminEmptyAction](copy, "AdminEmptyActionSchema", admin)
	return err
}
func adminRuntime(view RuntimeView) any {
	if !view.Configured {
		return map[string]any{"configured": false}
	}
	return map[string]any{"configured": true, "agentImage": view.AgentImage, "model": view.Model, "modelRef": view.ModelRef, "updatedAt": view.UpdatedAt}
}
func adminStatus(status Status) any {
	return struct {
		Version int `json:"adminApiVersion"`
		Status
	}{1, status}
}
func requestCorrelation() contracts.ResourceId {
	id, err := uuid.NewRandom()
	if err != nil {
		return "correlation-unavailable"
	}
	return contracts.ResourceId("correlation-" + id.String())
}
func (a *Application) handle(w http.ResponseWriter, r *http.Request) error {
	path := r.URL.Path
	if r.Method == "GET" && path == "/healthz" {
		send(w, 200, map[string]string{"status": "healthy"})
		return nil
	}
	if r.Method == "GET" && path == "/readyz" {
		profiles, hasProfile := r.URL.Query()["profile"]
		if hasProfile && (len(profiles) != 1 || profiles[0] != "docker-delivery") {
			return contracts.NewError("INVALID_REQUEST", "profile")
		}
		status, value := a.deliveryStatus()
		ready, reason := status.Ready, status.State
		var preparation *Preparation
		if hasProfile {
			preparation = &value
			ready = ready && value.Ready
			if status.Ready && !value.Ready {
				reason = "DEPENDENCIES_PREPARING"
				for _, component := range value.Components {
					if component.State == "failed" {
						reason = "DEPENDENCY_FAILED"
					}
				}
			}
		}
		code := 503
		if ready {
			code = 200
		}
		name := "not_ready"
		if ready {
			name = "ready"
		}
		send(w, code, struct {
			Status      string       `json:"status"`
			Reason      string       `json:"reason"`
			State       string       `json:"state"`
			Ready       bool         `json:"ready"`
			Checks      any          `json:"checks"`
			Preparation *Preparation `json:"preparation,omitempty"`
		}{Status: name, Reason: reason, State: status.State, Ready: ready, Checks: status.Checks, Preparation: preparation})
		return nil
	}
	if r.Method == "GET" && path == "/control/status" {
		status, preparation := a.deliveryStatus()
		send(w, 200, struct {
			Status
			Preparation Preparation `json:"preparation"`
		}{status, preparation})
		return nil
	}
	if r.Method == "POST" && path == "/api/v1/login" {
		account, password, err := readCredentials(r)
		if err != nil {
			return err
		}
		source, _, err := net.SplitHostPort(r.RemoteAddr)
		if err != nil {
			source = "unknown"
		}
		result, err := a.Identity.Login(r.Context(), account, password, source)
		if err != nil {
			return err
		}
		send(w, 200, result)
		return nil
	}
	if strings.HasPrefix(path, "/control/") {
		actor, err := a.operator(r)
		if err != nil {
			return err
		}
		if r.Method == "POST" && path == "/control/admin/bootstrap" {
			account, password, err := readCredentials(r)
			if err != nil {
				return err
			}
			user, err := a.Identity.Bootstrap(r.Context(), account, password)
			if err != nil {
				return err
			}
			if err := a.ScheduleRuntimeRefresh(); err != nil {
				return err
			}
			send(w, 201, map[string]any{"userId": user.Id, "account": user.Account})
			return nil
		}
		return a.control(w, r, actor, false)
	}
	if !strings.HasPrefix(path, "/api/v1/") {
		return contracts.NewError("NOT_FOUND", "")
	}
	if path == "/api/v1/service-access/resolve" && r.Method == http.MethodGet || strings.HasPrefix(path, "/api/v1/service-gateway/") {
		a.serviceGateway.serve(w, r)
		return nil
	}
	token, err := bearer(r)
	if err != nil {
		return err
	}
	session, err := a.Identity.Authenticate(r.Context(), token)
	if err != nil {
		return err
	}
	if path == "/api/v1/service-access" && r.Method == http.MethodGet {
		send(w, 200, map[string]any{"version": 1, "protocols": []string{"http", "sse", "websocket"}})
		return nil
	}
	if path == "/api/v1/file-access" && r.Method == http.MethodGet {
		send(w, 200, a.fileCapability())
		return nil
	}
	if r.Method == "GET" && path == "/api/v1/me" {
		send(w, 200, map[string]any{"id": session.User.ID, "account": session.User.Account, "role": session.User.Role, "expiresAt": session.ExpiresAt})
		return nil
	}
	if r.Method == "POST" && path == "/api/v1/logout" {
		if err := a.Identity.Logout(r.Context(), token); err != nil {
			return err
		}
		w.WriteHeader(204)
		return nil
	}
	if path == "/api/v1/admin" || strings.HasPrefix(path, "/api/v1/admin/") {
		if session.User.Role != "admin" {
			return contracts.NewError("PERMISSION_DENIED", "")
		}
		return a.control(w, r, session.Principal(), true)
	}
	if handled, err := a.skillRead(w, r); handled {
		return err
	}
	if handled, err := a.packageCatalogHTTP(w, r, false, "/api/v1"); handled {
		return err
	}
	if handled, err := a.snapshotHTTP(w, r, session.Principal(), token); handled {
		return err
	}
	if handled, err := a.workCreateHTTP(w, r, session.Principal()); handled {
		return err
	}
	if handled, err := a.workRead(w, r, session.Principal()); handled {
		return err
	}
	if handled, err := a.serviceHTTP(w, r, session.Principal()); handled {
		return err
	}
	if handled, err := a.workConfigurationRead(w, r, session.Principal()); handled {
		return err
	}
	if handled, err := a.workConfigurationApplyHTTP(w, r, session.Principal()); handled {
		return err
	}
	if handled, err := a.workConfigurationSave(w, r, session.Principal()); handled {
		return err
	}
	if handled, err := a.workPackageUpload(w, r, session.Principal()); handled {
		return err
	}
	if handled, err := a.workPackageHTTP(w, r, session.Principal()); handled {
		return err
	}
	if handled, err := a.workActionHTTP(w, r, session.Principal()); handled {
		return err
	}
	if handled, err := a.operationRead(w, r, session.Principal()); handled {
		return err
	}
	if handled, err := a.conversation(w, r, session.Principal(), token); handled {
		return err
	}
	return contracts.NewError("NOT_FOUND", "")
}

func (a *Application) control(w http.ResponseWriter, r *http.Request, actor identity.Principal, admin bool) error {
	prefix := "/control"
	if admin {
		prefix = "/api/v1/admin"
		if relative := strings.TrimPrefix(r.URL.EscapedPath(), prefix); relative != "/package-uploads" {
			_ = http.NewResponseController(w).SetReadDeadline(time.Now().Add(120 * time.Second))
		}
	}
	if !strings.HasPrefix(r.URL.EscapedPath(), prefix+"/") {
		return contracts.NewError("NOT_FOUND", "")
	}
	relative := strings.TrimPrefix(r.URL.EscapedPath(), prefix)
	if admin {
		if handled, err := a.modelAdminHTTP(w, r, actor, relative); handled {
			return err
		}
	}
	parts := strings.Split(strings.TrimPrefix(relative, "/"), "/")
	allowed := ""
	switch relative {
	case "/status":
		allowed = "GET"
	case "/users":
		allowed = "GET, POST"
	case "/runtime":
		allowed = "GET, PUT"
	case "/default-work":
		if admin {
			allowed = "GET, PATCH"
		} else {
			allowed = "GET, PUT"
		}
	case "/skills":
		allowed = "GET, POST"
	case "/package-uploads":
		allowed = "POST"
	case "/packages":
		allowed = "GET, POST"
	}
	if len(parts) == 2 && parts[0] == "skills" {
		name, ok := skillPathName(parts[1])
		if !ok {
			return contracts.NewError("NOT_FOUND", "")
		}
		parts[1], allowed = name, "GET, PUT, DELETE"
	}
	if len(parts) == 3 && parts[0] == "skills" && (parts[2] == "enable" || parts[2] == "disable") {
		name, ok := skillPathName(parts[1])
		if !ok {
			return contracts.NewError("NOT_FOUND", "")
		}
		parts[1], allowed = name, "POST"
	}
	if len(parts) == 2 && parts[0] == "packages" {
		allowed = "GET, DELETE"
	}
	if len(parts) == 2 && parts[0] == "operations" {
		allowed = "GET"
	}
	if len(parts) == 3 && parts[0] == "packages" && (parts[2] == "enable" || parts[2] == "disable" || parts[2] == "update") {
		allowed = "POST"
	}
	if len(parts) == 3 && parts[0] == "users" && (parts[2] == "enable" || parts[2] == "disable" || parts[2] == "reset-credential") {
		id, err := url.PathUnescape(parts[1])
		if err != nil || id == "" || strings.ContainsAny(id, "/\\\x00") {
			return contracts.NewError("NOT_FOUND", "")
		}
		parts[1], allowed = id, "POST"
	}
	if admin && allowed != "" && !strings.Contains(", "+allowed+", ", ", "+r.Method+", ") {
		w.Header().Set("Allow", allowed)
		return contracts.NewError("METHOD_NOT_ALLOWED", "")
	}
	if r.Method == http.MethodPost && relative == "/package-uploads" {
		return a.packageUpload(w, r, actor, "core", "")
	}
	if handled, err := a.corePackageInstallHTTP(w, r, actor, admin, prefix); handled {
		return err
	}
	if handled, err := a.corePackageOperationHTTP(w, r, prefix); handled {
		return err
	}
	if handled, err := a.packageCatalogHTTP(w, r, true, prefix); handled {
		return err
	}
	if handled, err := a.packageCatalogMutation(w, r, actor, admin, prefix); handled {
		return err
	}
	if r.Method == "GET" && relative == "/status" {
		status := a.Status()
		if admin {
			send(w, 200, struct {
				Version int `json:"adminApiVersion"`
				Status
			}{1, status})
		} else {
			send(w, 200, status)
		}
		return nil
	}
	if r.Method == "GET" && relative == "/users" {
		users, err := a.Identity.ListUsers(r.Context(), actor)
		if err != nil {
			return err
		}
		send(w, 200, contracts.AdminUsers{Users: users})
		return nil
	}
	if r.Method == "POST" && relative == "/users" {
		body, err := readControlJSON[contracts.AdminCreateUserRequest](r, "AdminCreateUserRequestSchema", admin)
		if err != nil {
			return err
		}
		role := "user"
		if body.Role.Present {
			role = string(body.Role.Value)
		}
		user, err := a.Identity.CreateUser(r.Context(), actor, string(body.Account), body.Password, role)
		if err != nil {
			return err
		}
		send(w, 201, user)
		return nil
	}
	if len(parts) == 3 && parts[0] == "users" && r.Method == "POST" {
		id, action := parts[1], parts[2]
		switch action {
		case "enable", "disable":
			if admin {
				if err := readEmptyAction(r, admin); err != nil {
					return err
				}
			}
			enabled := action == "enable"
			if err := a.Identity.SetEnabled(r.Context(), actor, id, enabled); err != nil {
				return err
			}
			send(w, 200, contracts.AdminUserEnabledResult{UserId: contracts.ResourceId(id), Enabled: enabled})
			return nil
		case "reset-credential":
			body, err := readControlJSON[contracts.AdminResetCredentialRequest](r, "AdminResetCredentialRequestSchema", admin)
			if err != nil {
				return err
			}
			if err := a.Identity.ResetPassword(r.Context(), actor, id, body.Password); err != nil {
				return err
			}
			send(w, 200, contracts.AdminCredentialResetResult{UserId: contracts.ResourceId(id), CredentialReset: true})
			return nil
		}
	}
	if r.Method == "GET" && relative == "/runtime" {
		view, err := a.Settings.RuntimeView()
		if err != nil {
			return err
		}
		if admin {
			send(w, 200, adminRuntime(view))
		} else {
			send(w, 200, view)
		}
		return nil
	}
	if r.Method == "GET" && relative == "/default-work" {
		view, err := a.defaultWorkView(r.Context())
		if err != nil {
			return err
		}
		send(w, 200, view)
		return nil
	}
	if relative == "/default-work" && (admin && r.Method == "PATCH" || !admin && r.Method == "PUT") {
		var patch defaultWorkPatch
		if admin {
			input, err := readControlJSON[contracts.AdminDefaultWorkPatch](r, "AdminDefaultWorkPatchSchema", true)
			if err != nil {
				return err
			}
			patch = adminDefaultPatch(input)
		} else {
			input, err := readJSON[defaultWorkOperatorInput](r)
			if err != nil {
				return err
			}
			if !input.Patch.Present || input.Patch.Null {
				return contracts.NewError("INVALID_REQUEST", "")
			}
			patch = input.Patch.Value
		}
		view, err := a.patchDefaultWork(r.Context(), actor, patch)
		if err != nil {
			return err
		}
		send(w, 200, view)
		return nil
	}
	if r.Method == "GET" && relative == "/skills" {
		skills, err := a.operatorSkills(r.Context())
		if err != nil {
			return err
		}
		send(w, 200, contracts.AdminSkills{Skills: skills})
		return nil
	}
	if r.Method == "GET" && len(parts) == 2 && parts[0] == "skills" {
		skill, err := a.operatorSkill(r.Context(), parts[1])
		if err != nil {
			return err
		}
		send(w, 200, skill)
		return nil
	}
	if !admin && r.Method == "POST" && relative == "/skills" {
		input, err := readJSON[struct {
			Path contracts.Field[string] `json:"path"`
		}](r)
		if err != nil {
			return err
		}
		if !input.Path.Present || input.Path.Null {
			return contracts.NewError("INVALID_REQUEST", "path")
		}
		skill, err := a.importSkill(r.Context(), actor, input.Path.Value, "", false)
		if err != nil {
			return err
		}
		send(w, 201, skill)
		return nil
	}
	if admin && r.Method == "POST" && relative == "/skills" {
		return a.adminSkillUpload(w, r, actor, "", false)
	}
	if !admin && len(parts) == 2 && parts[0] == "skills" && r.Method == "PUT" {
		input, err := readJSON[struct {
			Path contracts.Field[string] `json:"path"`
		}](r)
		if err != nil {
			return err
		}
		if !input.Path.Present || input.Path.Null {
			return contracts.NewError("INVALID_REQUEST", "path")
		}
		skill, err := a.importSkill(r.Context(), actor, input.Path.Value, parts[1], true)
		if err != nil {
			return err
		}
		send(w, 200, skill)
		return nil
	}
	if admin && len(parts) == 2 && parts[0] == "skills" && r.Method == "PUT" {
		return a.adminSkillUpload(w, r, actor, parts[1], true)
	}
	if len(parts) == 2 && parts[0] == "skills" && r.Method == "DELETE" {
		if err := a.removeSkill(r.Context(), actor, parts[1]); err != nil {
			return err
		}
		w.WriteHeader(204)
		return nil
	}
	if len(parts) == 3 && parts[0] == "skills" && (parts[2] == "enable" || parts[2] == "disable") && r.Method == "POST" {
		if err := readEmptyAction(r, admin); err != nil {
			return err
		}
		skill, err := a.setSkillEnabled(r.Context(), actor, parts[1], parts[2] == "enable")
		if err != nil {
			return err
		}
		send(w, 200, skill)
		return nil
	}
	if r.Method == "PUT" && relative == "/runtime" {
		raw, err := readControlJSON[json.RawMessage](r, "AdminRuntimeInputSchema", admin)
		if err != nil {
			return err
		}
		var selection contracts.AdminRuntimeSelection
		if contracts.Validate("AdminRuntimeSelectionSchema", raw) == nil && json.Unmarshal(raw, &selection) == nil {
			return a.runtimeSelectionHTTP(w, r, actor, selection, admin)
		}
		var body contracts.AdminRuntimeLegacyInput
		if json.Unmarshal(raw, &body) != nil {
			return contracts.NewError("INVALID_REQUEST", "")
		}
		input := RuntimeInput{AgentImage: body.AgentImage, Provider: body.Provider, Model: body.Model, Credential: body.Credential}
		if body.BaseUrl.Present {
			input.BaseURL = &body.BaseUrl.Value
		}
		view, err := a.Settings.ConfigureRuntimeAuthorized(input, func() error {
			if err := a.Identity.AuthorizeAdministrator(r.Context(), actor); err != nil {
				return err
			}
			a.invalidateRuntimePreparation()
			return nil
		})
		if err != nil {
			_ = a.ScheduleRuntimeRefresh()
			return err
		}
		if err := a.ScheduleRuntimeRefresh(); err != nil {
			return err
		}
		if admin {
			send(w, 200, map[string]any{"runtime": adminRuntime(view), "status": adminStatus(a.Status())})
		} else {
			send(w, 200, view)
		}
		return nil
	}
	return contracts.NewError("NOT_FOUND", "")
}
