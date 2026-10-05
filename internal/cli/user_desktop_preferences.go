package cli

import (
	"context"
	"errors"
	"io"
	"mime"
	"net/http"

	"piwork/internal/client"
	"piwork/internal/clientfs"
)

type desktopPreferencesStorage interface {
	Load() (*string, error)
	Save(context.Context, string, func() error) (string, error)
	Clear(context.Context, func() error) error
}

var errDesktopPreferencesAuthorization = errors.New("local browser authorization expired")

func (d *nativeDesktop) servePreferences(w http.ResponseWriter, r *http.Request) {
	if r.URL.RawQuery != "" {
		desktopError(w, 400, "INVALID_DESKTOP_PREFERENCES")
		return
	}
	store := d.preferencesStorage
	if store == nil {
		store = client.DesktopPreferencesStore{CredentialPath: d.store.Path}
	}
	failure := func(err error) {
		switch {
		case errors.Is(err, errDesktopPreferencesAuthorization):
			desktopError(w, 403, "LOCAL_CSRF_OR_AUTH_REQUIRED")
		case errors.Is(err, client.ErrDesktopPreferencesInvalid):
			desktopError(w, 400, "INVALID_DESKTOP_PREFERENCES")
		case errors.Is(err, clientfs.ErrBusy):
			desktopError(w, 409, "DESKTOP_PREFERENCES_BUSY")
		case errors.Is(err, clientfs.ErrOutcomeUnknown):
			desktopError(w, 500, "DESKTOP_PREFERENCES_OUTCOME_UNKNOWN")
		default:
			desktopError(w, 500, "DESKTOP_PREFERENCES_UNAVAILABLE")
		}
	}
	check := func() error {
		if err := r.Context().Err(); err != nil {
			return err
		}
		if _, ok := d.authorize(r, true); !ok {
			return errDesktopPreferencesAuthorization
		}
		return nil
	}
	switch r.Method {
	case http.MethodGet:
		core, err := store.Load()
		if err != nil {
			failure(err)
			return
		}
		desktopJSON(w, 200, map[string]any{"coreUrl": core})
	case http.MethodPut:
		kind, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if err != nil || kind != "application/json" {
			failure(client.ErrDesktopPreferencesInvalid)
			return
		}
		raw, err := io.ReadAll(io.LimitReader(r.Body, client.DesktopPreferencesLimit+1))
		if err != nil {
			failure(client.ErrDesktopPreferencesInvalid)
			return
		}
		core, err := client.ParseDesktopPreferenceInput(raw)
		if err != nil {
			failure(err)
			return
		}
		core, err = store.Save(r.Context(), core, check)
		if err != nil {
			failure(err)
			return
		}
		desktopJSON(w, 200, map[string]any{"coreUrl": core})
	case http.MethodDelete:
		if r.Body != nil {
			raw, err := io.ReadAll(io.LimitReader(r.Body, 1))
			if err != nil || len(raw) != 0 {
				failure(client.ErrDesktopPreferencesInvalid)
				return
			}
		}
		if err := store.Clear(r.Context(), check); err != nil {
			failure(err)
			return
		}
		desktopJSON(w, 200, map[string]any{"coreUrl": nil})
	default:
		w.Header().Set("Allow", "GET, PUT, DELETE")
		desktopError(w, 405, "METHOD_NOT_ALLOWED")
	}
}
