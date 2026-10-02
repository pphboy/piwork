package workfiles

import (
	"fmt"
	"net/http"
	"strconv"

	"piwork/internal/fileprotocol"
)

var Status = map[string]int{
	"FILE_PATH_INVALID": 400, "FILE_XML_INVALID": 400, "FILE_REQUEST_INVALID": 400, "FILE_CONDITION_UNSUPPORTED": 400,
	"LOCAL_AUTH_REQUIRED": 401, "AUTH_REQUIRED": 401, "FILE_ROOT_PROTECTED": 403, "FILE_PERMISSION_DENIED": 403, "FILE_DESTINATION_DENIED": 403, "FILE_DEPTH_UNSUPPORTED": 403, "FILE_REQUEST_DENIED": 403, "LOCAL_CREDENTIAL_TARGET_DENIED": 403,
	"NOT_FOUND": 404, "FILE_NOT_FOUND": 404, "FILE_METHOD_NOT_ALLOWED": 405, "WORK_FILES_UNAVAILABLE": 409, "WORK_SNAPSHOT_BUSY": 409, "FILE_CONFLICT": 409, "FILE_TYPE_UNSUPPORTED": 409, "FILE_NAME_UNSUPPORTED": 409, "FILE_CLEANUP_REQUIRED": 409,
	"FILE_PRECONDITION_FAILED": 412, "FILE_LIMIT_EXCEEDED": 413, "FILE_PATH_TOO_LONG": 414, "FILE_MEDIA_UNSUPPORTED": 415, "FILE_RANGE_UNSATISFIABLE": 416, "FILE_ACCESS_BUSY": 429, "HEADERS_TOO_LARGE": 431,
	"FILE_ACCESS_UNSUPPORTED": 501, "FILE_BACKEND_PROTOCOL_ERROR": 502, "CORE_UNAVAILABLE": 502, "FILE_HELPER_UNAVAILABLE": 503, "FILE_RUNTIME_UNAVAILABLE": 503, "FILE_TRANSFER_TIMEOUT": 504, "FILE_STORAGE_FULL": 507,
}

func SendError(writer http.ResponseWriter, err error, head bool, rangeSize *int64) {
	code := fileprotocol.Code(err)
	status, ok := Status[code]
	if !ok {
		code, status = "FILE_RUNTIME_UNAVAILABLE", 503
	}
	finite := ""
	if code == "FILE_DEPTH_UNSUPPORTED" {
		finite = "<d:propfind-finite-depth/>"
	}
	body := fmt.Sprintf(`<?xml version="1.0" encoding="utf-8"?><d:error xmlns:d="DAV:" xmlns:p="urn:piwork:files"><p:code>%s</p:code>%s</d:error>`, code, finite)
	writer.Header().Set("Content-Type", "application/xml; charset=utf-8")
	writer.Header().Set("Cache-Control", "no-store")
	writer.Header().Set("X-Piwork-File-Error", code)
	writer.Header().Set("Content-Length", strconv.Itoa(len(body)))
	if code == "FILE_ACCESS_BUSY" {
		writer.Header().Set("Retry-After", "1")
	}
	if code == "FILE_METHOD_NOT_ALLOWED" {
		writer.Header().Set("Allow", Allow)
	}
	if code == "FILE_RANGE_UNSATISFIABLE" && rangeSize != nil {
		writer.Header().Set("Content-Range", fmt.Sprintf("bytes */%d", *rangeSize))
	}
	writer.WriteHeader(status)
	if !head {
		_, _ = writer.Write([]byte(body))
	}
}
