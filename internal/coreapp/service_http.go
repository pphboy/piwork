package coreapp

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/identity"
	"piwork/internal/workaccess"
)

func (a *Application) serviceHTTP(w http.ResponseWriter, r *http.Request, principal identity.Principal) (bool, error) {
	parts := strings.Split(strings.TrimPrefix(r.URL.EscapedPath(), "/"), "/")
	if len(parts) < 5 || parts[0] != "api" || parts[1] != "v1" || parts[2] != "works" || parts[4] != "services" {
		return false, nil
	}
	for _, index := range []int{3, 5} {
		if index >= len(parts) {
			continue
		}
		part, err := url.PathUnescape(parts[index])
		if err != nil || !validResourceID(part) {
			return true, contracts.NewError("NOT_FOUND", "")
		}
		parts[index] = part
	}
	workID := parts[3]
	actor := serviceActor{User: &principal}
	permission := workaccess.Metadata
	if r.Method != http.MethodGet {
		permission = workaccess.Control
	}
	if len(parts) == 7 && (parts[6] == "logs" || parts[6] == "revisions") {
		permission = workaccess.Content
	}
	if err := a.Store.Read(r.Context(), func(tx *sql.Tx) error { _, err := a.authorizeServiceTx(tx, actor, workID, permission); return err }); err != nil {
		return true, err
	}
	if len(parts) == 5 && r.Method == http.MethodGet {
		views, err := a.listServices(r.Context(), actor, workID)
		if err != nil {
			return true, err
		}
		send(w, 200, map[string]any{"services": views})
		return true, nil
	}
	if len(parts) == 6 && r.Method == http.MethodGet {
		view, err := a.readService(r.Context(), actor, workID, parts[5])
		if err != nil {
			return true, err
		}
		send(w, 200, view)
		return true, nil
	}
	if len(parts) == 7 && r.Method == http.MethodGet && parts[6] == "logs" {
		if len(r.URL.Query()["tailLines"]) > 1 {
			return true, contracts.NewError("INVALID_REQUEST", "tailLines")
		}
		lines := 100
		if value := r.URL.Query().Get("tailLines"); value != "" {
			parsed, err := strconv.Atoi(value)
			if err != nil {
				return true, contracts.NewError("INVALID_REQUEST", "tailLines")
			}
			lines = parsed
		}
		view, err := a.serviceLogs(r.Context(), actor, workID, parts[5], lines)
		if err != nil {
			return true, err
		}
		send(w, 200, view)
		return true, nil
	}
	if len(parts) == 7 && r.Method == http.MethodGet && parts[6] == "revisions" {
		var revisions []any
		err := a.Store.Read(r.Context(), func(tx *sql.Tx) error {
			if _, err := corestore.ReadService(tx, workID, parts[5], true); err != nil {
				return err
			}
			rows, err := tx.Query(`SELECT revision,definition_json,resolved_image_digest,created_at FROM service_revisions WHERE work_id=? AND service_id=? ORDER BY revision`, workID, parts[5])
			if err != nil {
				return err
			}
			defer rows.Close()
			revisions = []any{}
			for rows.Next() {
				var revision int64
				var definition, createdAt string
				var image *string
				if err := rows.Scan(&revision, &definition, &image, &createdAt); err != nil {
					return err
				}
				revisions = append(revisions, map[string]any{"workId": workID, "serviceId": parts[5], "revision": revision, "definitionJson": definition, "resolvedImageDigest": image, "createdAt": createdAt})
			}
			return rows.Err()
		})
		if err != nil {
			return true, servicePublicError(err)
		}
		send(w, 200, map[string]any{"revisions": revisions})
		return true, nil
	}
	var accepted acceptedServiceOperation
	var err error
	if len(parts) == 5 && r.Method == http.MethodPost || len(parts) == 6 && (r.Method == http.MethodPut || r.Method == http.MethodPatch) {
		body, readErr := readJSON[struct {
			Definition       json.RawMessage        `json:"definition"`
			ExpectedRevision contracts.Field[int64] `json:"expectedRevision"`
			Key              string                 `json:"idempotencyKey"`
		}](r)
		if readErr != nil {
			return true, readErr
		}
		if len(body.Definition) == 0 || string(body.Definition) == "null" || body.Key == "" || len(body.Key) > 256 {
			return true, contracts.NewError("INVALID_REQUEST", "")
		}
		serviceID := ""
		expected := int64(0)
		if len(parts) == 6 {
			if !body.ExpectedRevision.Present || body.ExpectedRevision.Null {
				return true, contracts.NewError("INVALID_REQUEST", "expectedRevision")
			}
			serviceID = parts[5]
			expected = body.ExpectedRevision.Value
		} else if body.ExpectedRevision.Present {
			return true, contracts.NewError("INVALID_REQUEST", "expectedRevision")
		}
		accepted, err = a.acceptServiceDefinition(r.Context(), actor, workID, serviceID, expected, body.Definition, body.Key)
	} else if len(parts) == 7 && r.Method == http.MethodPost {
		body, readErr := readJSON[struct {
			Key string `json:"idempotencyKey"`
		}](r)
		if readErr != nil {
			return true, readErr
		}
		if body.Key == "" || len(body.Key) > 256 {
			return true, contracts.NewError("INVALID_REQUEST", "idempotencyKey")
		}
		accepted, err = a.acceptServiceAction(r.Context(), actor, workID, parts[5], parts[6], body.Key)
	} else {
		return true, contracts.NewError("NOT_FOUND", "")
	}
	if err != nil {
		return true, servicePublicError(err)
	}
	if !accepted.Reused {
		a.cancelServiceEffects(workID)
	}
	a.enqueueWork(workID)
	send(w, 202, accepted)
	return true, nil
}
