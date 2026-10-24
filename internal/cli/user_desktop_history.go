package cli

import (
	"errors"
	"net/http"
	"net/url"
	"piwork/internal/contracts"
	"piwork/internal/sessionhistory"
	"strings"
)

func planDesktopHistory(r *http.Request, parts []string) (desktopControl, bool, error) {
	invalid := func() (desktopControl, bool, error) { return desktopControl{}, true, errors.New("INVALID_INPUT") }
	values, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil {
		return invalid()
	}
	if len(parts) >= 3 && parts[0] == "works" && (parts[2] == "history-capabilities" || len(parts) == 5 && parts[2] == "sessions" && parts[4] == "history") {
		if r.Method != http.MethodGet {
			return invalid()
		}
		for _, i := range []int{1} {
			if _, ok := desktopResourcePart(parts[i], desktopIDPattern); !ok {
				return invalid()
			}
		}
		if parts[2] == "history-capabilities" {
			if len(parts) != 3 || len(values) != 0 {
				return invalid()
			}
		} else {
			if _, ok := desktopResourcePart(parts[3], desktopIDPattern); !ok {
				return invalid()
			}
			query, err := sessionhistory.ParseQuery(values)
			if err != nil {
				return invalid()
			}
			values = sessionhistory.QueryValues(query)
		}
		path := "/api/v1/" + strings.Join(parts, "/")
		if len(values) > 0 {
			path += "?" + values.Encode()
		}
		return desktopControl{method: http.MethodGet, path: path, status: 200}, true, nil
	}
	if profiles, exists := values["responseProfile"]; exists {
		if len(profiles) != 1 || profiles[0] != contracts.HistoryResponseProfile || len(parts) < 4 || parts[0] != "works" || parts[2] != "runs" && !(parts[2] == "sessions" && parts[3] == "submissions") {
			return invalid()
		}
		values.Del("responseProfile")
		copy := r.Clone(r.Context())
		u := *r.URL
		u.RawQuery = values.Encode()
		copy.URL = &u
		plan, handled, err := planDesktopControl(copy)
		if err != nil || !handled {
			return plan, handled, err
		}
		separator := "?"
		if strings.Contains(plan.path, "?") {
			separator = "&"
		}
		plan.path += separator + "responseProfile=" + contracts.HistoryResponseProfile
		return plan, true, nil
	}
	return desktopControl{}, false, nil
}
