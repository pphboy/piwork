package filehelper

import (
	"encoding/json"
	"net/http"
	"regexp"
	"strings"
	"time"

	"piwork/internal/contracts"
)

var etagPattern = regexp.MustCompile(`^(?:W/)?"[^"\x00-\x1f\x7f]*"`)

func nullableString(raw json.RawMessage) *string {
	if string(raw) == "null" {
		return nil
	}
	var value string
	if json.Unmarshal(raw, &value) != nil {
		return nil
	}
	return &value
}
func validateETag(value *string) error {
	if value == nil || *value == "*" {
		return nil
	}
	if *value == "" || len(*value) > 8192 {
		return pathError("FILE_REQUEST_INVALID")
	}
	rest := *value
	for {
		rest = strings.TrimLeft(rest, " \t")
		match := etagPattern.FindString(rest)
		if match == "" {
			return pathError("FILE_REQUEST_INVALID")
		}
		rest = strings.TrimLeft(rest[len(match):], " \t")
		if rest == "" {
			return nil
		}
		if rest[0] != ',' || len(rest) == 1 {
			return pathError("FILE_REQUEST_INVALID")
		}
		rest = rest[1:]
	}
}
func conditionDate(raw json.RawMessage) *int64 {
	value := nullableString(raw)
	if value == nil {
		return nil
	}
	// The existing helper ignores dates lacking an explicit timezone.
	if _, err := time.Parse(time.ANSIC, *value); err == nil {
		return nil
	}
	stamp, err := http.ParseTime(*value)
	if err != nil {
		return nil
	}
	seconds := stamp.Unix()
	return &seconds
}
func evaluateConditions(request contracts.FileHelperRequest, info *contracts.FileHelperMeta) (int64, error) {
	match, none := nullableString(request.Conditions.IfMatch), nullableString(request.Conditions.IfNoneMatch)
	if err := validateETag(match); err != nil {
		return 0, err
	}
	if err := validateETag(none); err != nil {
		return 0, err
	}
	exists := info != nil
	var modified int64
	if exists {
		if json.Unmarshal(info.ModifiedMs, &modified) != nil {
			return 0, pathError("FILE_RUNTIME_UNAVAILABLE")
		}
		modified /= 1000
	}
	if match != nil {
		if *match != "*" || !exists {
			return 0, pathError("FILE_PRECONDITION_FAILED")
		}
	} else if unmodified := conditionDate(request.Conditions.IfUnmodifiedSince); exists && unmodified != nil && modified > *unmodified {
		return 0, pathError("FILE_PRECONDITION_FAILED")
	}
	read := request.Action == "GET" || request.Action == "HEAD"
	if none != nil && *none == "*" && exists {
		if read {
			return 304, nil
		}
		return 0, pathError("FILE_PRECONDITION_FAILED")
	}
	if none == nil && read {
		if since := conditionDate(request.Conditions.IfModifiedSince); exists && since != nil && modified <= *since {
			return 304, nil
		}
	}
	return 0, nil
}
func normalizeRange(raw json.RawMessage, size int64) (int64, *int64, error) {
	if string(raw) == "null" {
		return 0, nil, nil
	}
	if size <= 0 {
		return 0, nil, pathError("FILE_RANGE_UNSATISFIABLE")
	}
	var rangeValue struct {
		Suffix *int64 `json:"suffix"`
		Start  int64  `json:"start"`
		End    *int64 `json:"end"`
	}
	if json.Unmarshal(raw, &rangeValue) != nil {
		return 0, nil, pathError("FILE_REQUEST_INVALID")
	}
	end := size - 1
	start := rangeValue.Start
	if rangeValue.Suffix != nil {
		if *rangeValue.Suffix < 1 {
			return 0, nil, pathError("FILE_REQUEST_INVALID")
		}
		start = size - *rangeValue.Suffix
		if start < 0 {
			start = 0
		}
	} else if rangeValue.End != nil && *rangeValue.End < end {
		end = *rangeValue.End
	}
	if start < 0 || start >= size || end < start {
		return 0, nil, pathError("FILE_RANGE_UNSATISFIABLE")
	}
	return start, &end, nil
}
