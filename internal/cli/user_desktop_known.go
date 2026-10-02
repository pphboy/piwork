package cli

import (
	"net/http"
	"strings"
)

func (d *nativeDesktop) serveKnownOperations(w http.ResponseWriter, r *http.Request) bool {
	path := r.URL.EscapedPath()
	if path != "/_desktop/api/known-operations" && !strings.HasPrefix(path, "/_desktop/api/known-operations/") {
		return false
	}
	if r.URL.RawQuery != "" {
		desktopError(w, 400, "INVALID_INPUT")
		return true
	}
	if d.view(r.Context(), "")["state"] != "authenticated" {
		desktopError(w, 401, "AUTH_REQUIRED")
		return true
	}
	d.mu.Lock()
	coreURL, userID := d.identity.coreURL, d.identity.credential.User.ID
	d.mu.Unlock()
	records := desktopOperationRecords{credentialPath: d.store.Path}
	if path == "/_desktop/api/known-operations" && r.Method == http.MethodGet {
		items, err := records.list(coreURL, userID)
		if err != nil {
			desktopError(w, 503, "LOCAL_RECORDS_UNAVAILABLE")
			return true
		}
		public := make([]map[string]string, 0, len(items))
		for _, item := range items {
			value := map[string]string{"operationId": item.OperationID, "type": item.Type, "recordedAt": item.RecordedAt}
			for key, entry := range map[string]string{"workId": item.WorkID, "serviceId": item.ServiceID, "snapshotId": item.SnapshotID} {
				if entry != "" {
					value[key] = entry
				}
			}
			public = append(public, value)
		}
		desktopJSON(w, 200, map[string]any{"operations": public})
		return true
	}
	if r.Method == http.MethodDelete && strings.HasPrefix(path, "/_desktop/api/known-operations/") {
		id := strings.TrimPrefix(path, "/_desktop/api/known-operations/")
		if !desktopIDPattern.MatchString(id) {
			desktopError(w, 400, "INVALID_INPUT")
			return true
		}
		if err := records.hide(coreURL, userID, id); err != nil {
			desktopError(w, 503, "LOCAL_RECORDS_UNAVAILABLE")
			return true
		}
		desktopJSON(w, 200, map[string]bool{"hidden": true})
		return true
	}
	desktopError(w, 404, "NOT_FOUND")
	return true
}
