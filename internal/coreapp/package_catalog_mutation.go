package coreapp

import (
	"database/sql"
	"net/http"
	"net/url"
	"strings"
	"time"

	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/identity"
	"piwork/internal/pipackage"
)

func (a *Application) packageCatalogMutation(w http.ResponseWriter, r *http.Request, actor identity.Principal, admin bool, prefix string) (bool, error) {
	path := r.URL.EscapedPath()
	if !strings.HasPrefix(path, prefix+"/packages/") {
		return false, nil
	}
	parts := strings.Split(strings.TrimPrefix(path, prefix+"/packages/"), "/")
	action := ""
	switch {
	case r.Method == http.MethodDelete && len(parts) == 1:
		action = "remove"
	case r.Method == http.MethodPost && len(parts) == 2 && (parts[1] == "enable" || parts[1] == "disable"):
		action = parts[1]
	}
	if action == "" {
		return false, nil
	}
	name, err := url.PathUnescape(parts[0])
	if err != nil || !pipackage.ValidName(name) {
		return true, contracts.NewError("PI_PACKAGE_NOT_FOUND", "")
	}
	if action != "remove" {
		if err := readEmptyAction(r, admin); err != nil {
			return true, err
		}
	}
	err = a.Store.Write(r.Context(), func(tx *sql.Tx) error {
		if actor.IsOperator() {
			values := r.Header.Values("Authorization")
			if len(values) != 1 || !strings.HasPrefix(values[0], "Operator ") || !a.Settings.VerifyOperator(r.Context(), strings.TrimPrefix(values[0], "Operator ")) {
				return contracts.NewError("OPERATOR_AUTHENTICATION_REQUIRED", "")
			}
		} else if err := a.Identity.AuthorizeAdministratorTx(tx, actor); err != nil {
			return err
		}
		var enabled bool
		if err := tx.QueryRowContext(r.Context(), `SELECT enabled FROM pi_package_catalog WHERE name=?`, name).Scan(&enabled); err == sql.ErrNoRows {
			return contracts.NewError("PI_PACKAGE_NOT_FOUND", "")
		} else if err != nil {
			return err
		}
		var busy bool
		if err := tx.QueryRowContext(r.Context(), `SELECT EXISTS(SELECT 1 FROM pi_package_jobs WHERE scope_kind='core' AND phase IN ('queued','source','prepare','validate','publish','cleanup-pending'))`).Scan(&busy); err != nil {
			return err
		}
		if busy {
			return contracts.NewError("PI_PACKAGE_BUSY", "")
		}
		if action == "remove" || action == "disable" {
			defaults, err := corestore.ReadDefaultWorkTx(tx)
			if err != nil {
				return err
			}
			if defaults.Configuration != nil {
				for _, item := range defaults.Configuration.Packages {
					if string(item.Name) == name {
						return contracts.NewError("PI_PACKAGE_IN_DEFAULTS", "")
					}
				}
			}
		}
		if action == "remove" {
			_, err := tx.ExecContext(r.Context(), `DELETE FROM pi_package_catalog WHERE name=?`, name)
			return err
		}
		target := action == "enable"
		if enabled == target {
			return nil
		}
		_, err := tx.ExecContext(r.Context(), `UPDATE pi_package_catalog SET enabled=?,updated_at=? WHERE name=?`, target, time.Now().UTC().Format(time.RFC3339Nano), name)
		return err
	})
	if err != nil {
		return true, err
	}
	if action == "remove" {
		w.WriteHeader(http.StatusNoContent)
		return true, nil
	}
	view, err := a.packageCatalog(r.Context(), true, name, true)
	if err == nil {
		send(w, http.StatusOK, view)
	}
	return true, err
}
