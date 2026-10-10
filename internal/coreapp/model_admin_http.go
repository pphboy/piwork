package coreapp

import (
	"net/http"
	"strings"

	"piwork/internal/contracts"
	"piwork/internal/identity"
)

func modelAdminMethods(path string) string {
	parts := strings.Split(strings.TrimPrefix(path, "/"), "/")
	if len(parts) == 1 {
		switch parts[0] {
		case "model-providers":
			return "GET, POST"
		case "models":
			return "GET, POST"
		case "model-tests":
			return "POST"
		}
	}
	if len(parts) > 1 && contracts.Validate("ResourceIdSchema", parts[1]) != nil {
		return ""
	}
	if len(parts) == 2 && (parts[0] == "model-providers" || parts[0] == "models") {
		return "GET, PATCH, DELETE"
	}
	if len(parts) == 3 {
		if parts[0] == "model-providers" && parts[2] == "models" {
			return "POST"
		}
		if (parts[0] == "model-providers" || parts[0] == "models") && (parts[2] == "enable" || parts[2] == "disable") {
			return "POST"
		}
	}
	return ""
}
func (a *Application) modelAdminHTTP(w http.ResponseWriter, r *http.Request, actor identity.Principal, path string) (bool, error) {
	methods := modelAdminMethods(path)
	if methods == "" {
		return false, nil
	}
	if !strings.Contains(", "+methods+", ", ", "+r.Method+", ") {
		w.Header().Set("Allow", methods)
		return true, contracts.NewError("METHOD_NOT_ALLOWED", "")
	}
	parts := strings.Split(strings.TrimPrefix(path, "/"), "/")
	if path == "/model-tests" {
		return true, a.modelTestHTTP(w, r, actor)
	}
	if r.Method == "GET" && parts[0] == "models" {
		models, err := a.modelConfigViews(r.Context())
		if err != nil {
			return true, err
		}
		if len(parts) == 1 {
			send(w, 200, contracts.ModelConfigList{Models: models})
			return true, nil
		}
		for _, m := range models {
			if string(m.Id) == parts[1] {
				send(w, 200, m)
				return true, nil
			}
		}
		return true, contracts.NewError("NOT_FOUND", "")
	}
	if r.Method == "GET" {
		providers, models, err := a.registryViews(r.Context())
		if err != nil {
			return true, err
		}
		if len(parts) == 1 {
			if parts[0] == "model-providers" {
				send(w, 200, contracts.ModelProviderList{Providers: providers})
			} else {
				send(w, 200, contracts.ManagedModelList{Models: models})
			}
			return true, nil
		}
		if parts[0] == "model-providers" {
			for _, p := range providers {
				if string(p.Id) == parts[1] {
					send(w, 200, p)
					return true, nil
				}
			}
		} else {
			for _, m := range models {
				if string(m.Id) == parts[1] {
					send(w, 200, m)
					return true, nil
				}
			}
		}
		return true, contracts.NewError("NOT_FOUND", "")
	}
	if r.Method == "POST" && len(parts) == 1 && parts[0] == "models" {
		input, err := readControlJSON[contracts.CreateModelConfig](r, "CreateModelConfigSchema", true)
		if err != nil {
			return true, err
		}
		view, err := a.createModelConfig(r.Context(), actor, input)
		if err == nil {
			send(w, 201, view)
		}
		return true, err
	}
	if r.Method == "POST" && len(parts) == 1 {
		input, err := readControlJSON[contracts.CreateModelProvider](r, "CreateModelProviderSchema", true)
		if err != nil {
			return true, err
		}
		view, err := a.createModelProvider(r.Context(), actor, input)
		if err == nil {
			send(w, 201, view)
		}
		return true, err
	}
	if r.Method == "POST" && parts[2] == "models" {
		input, err := readControlJSON[contracts.CreateManagedModel](r, "CreateManagedModelSchema", true)
		if err != nil {
			return true, err
		}
		view, err := a.createManagedModel(r.Context(), actor, parts[1], input)
		if err == nil {
			send(w, 201, view)
		}
		return true, err
	}
	if r.Method == "PATCH" {
		if parts[0] == "model-providers" {
			input, err := readControlJSON[contracts.PatchModelProvider](r, "PatchModelProviderSchema", true)
			if err != nil {
				return true, err
			}
			view, err := a.patchModelProvider(r.Context(), actor, parts[1], input)
			if err == nil {
				send(w, 200, view)
			}
			return true, err
		}
		input, err := readControlJSON[contracts.PatchModelConfig](r, "PatchModelConfigSchema", true)
		if err != nil {
			return true, err
		}
		view, err := a.writeModelConfig(r.Context(), actor, parts[1], input)
		if err == nil {
			send(w, 200, view)
		}
		return true, err
	}
	action := "delete"
	if r.Method == "POST" {
		action = parts[2]
		if err := readEmptyAction(r, true); err != nil {
			return true, err
		}
	}
	view, err := a.modelLifecycle(r.Context(), actor, parts[0] == "model-providers", parts[1], action)
	if err == nil {
		if action == "delete" {
			w.WriteHeader(204)
		} else {
			if parts[0] == "models" {
				views, e := a.modelConfigViews(r.Context())
				if e != nil {
					return true, e
				}
				for _, m := range views {
					if string(m.Id) == parts[1] {
						view = m
						break
					}
				}
			}
			send(w, 200, view)
		}
	}
	return true, err
}
