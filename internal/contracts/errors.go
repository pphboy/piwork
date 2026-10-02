package contracts

import (
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
)

// PublicError is a deliberately constructed domain error. Arbitrary errors,
// including errors with Code/Message fields, cannot pass through this boundary.
type PublicError struct {
	code         string
	field        string
	retryAfterMs Field[int64]
}

func (e *PublicError) Error() string { return publicErrors[e.code].message }

type errorDefinition struct {
	status    int
	message   string
	retryable bool
}

var publicErrors = map[string]errorDefinition{
	"TARGET_MODEL_UNAVAILABLE":          {400, "A required recipient model credential is unavailable", false},
	"EXTERNAL_MCP_SECRET_UNAVAILABLE":   {400, "A required external MCP credential is unavailable", false},
	"PACKAGE_BINDING_INVALID":           {400, "Work package bindings are invalid", false},
	"WORK_NAME_CONFLICT":                {409, "Work name is already reserved", false},
	"SNAPSHOT_VOLUME_CONFLICT":          {409, "Snapshot volume identity conflicts", false},
	"SNAPSHOT_DEADLINE_EXCEEDED":        {408, "Snapshot deadline was exceeded", false},
	"WORK_OPERATION_FAILED":             {500, "Work operation failed", false},
	"SNAPSHOT_HELPER_UNAVAILABLE":       {503, "Snapshot helper is not available", true},
	"SNAPSHOT_REQUIRES_STOPPED":         {409, "Work must be stopped before export", false},
	"SNAPSHOT_RUNTIME_UNAVAILABLE":      {503, "Snapshot runtime is unavailable", true},
	"SNAPSHOT_IMAGE_MISSING":            {409, "A captured Work image is missing", false},
	"SNAPSHOT_STORAGE_UNREADABLE":       {409, "Work snapshot storage is unreadable", false},
	"SNAPSHOT_STORAGE_UNSUPPORTED":      {409, "Work snapshot storage is unsupported", false},
	"SNAPSHOT_CAPACITY_BUSY":            {409, "Snapshot capacity is full", true},
	"SNAPSHOT_TRANSFER_BUSY":            {503, "Snapshot transfer capacity is full", true},
	"SNAPSHOT_CLEANUP_REQUIRED":         {503, "Snapshot cleanup is required", true},
	"SNAPSHOT_EXPORT_FAILED":            {500, "Work export failed", false},
	"PACKAGE_INVALID":                   {400, "Work package is invalid", false},
	"PACKAGE_FORMAT_UNSUPPORTED":        {400, "Work package format is unsupported", false},
	"PACKAGE_INCOMPATIBLE":              {400, "Work package is incompatible", false},
	"PACKAGE_LIMIT_EXCEEDED":            {413, "Work package exceeds a limit", false},
	"PACKAGE_EXPIRED":                   {410, "package has expired", false},
	"PACKAGE_NOT_READY":                 {409, "package is not ready", true},
	"PACKAGE_UNAVAILABLE":               {503, "package storage is unavailable", true},
	"CONTENT_LENGTH_REQUIRED":           {400, "valid Content-Length is required", false},
	"INVALID_DIGEST":                    {400, "X-Piwork-SHA256 is required", false},
	"RANGE_NOT_SUPPORTED":               {416, "Work package downloads do not support Range", false},
	"SERVICE_ACCESS_LIMIT":              {503, "Service connection capacity is full", true},
	"HEADERS_TOO_LARGE":                 {400, "Service request headers exceed a limit", false},
	"PORT_NOT_DECLARED":                 {400, "Service port is not declared", false},
	"PORT_REQUIRED":                     {400, "Service requires an explicit port", false},
	"SERVICE_UNAVAILABLE":               {503, "Service is unavailable", true},
	"SERVICE_UPSTREAM_UNAVAILABLE":      {502, "Service upstream is unavailable", true},
	"INVALID_SERVICE_DEFINITION":        {400, "service definition is invalid", false},
	"FAILED_PRECONDITION":               {409, "service request conflicts with current state", false},
	"AUTHENTICATION_FAILED":             {401, "authentication failed", false},
	"AUTHENTICATION_REQUIRED":           {401, "authentication is required", false},
	"OPERATOR_AUTHENTICATION_REQUIRED":  {401, "operator authentication is required", false},
	"ADMIN_REQUIRED":                    {503, "an administrator must be bootstrapped first", true},
	"RUNTIME_NOT_CONFIGURED":            {503, "the global runtime default is not configured", true},
	"AUTH_REQUIRED":                     {401, "Authentication is required", false},
	"PERMISSION_DENIED":                 {403, "permission denied", false},
	"NOT_FOUND":                         {404, "resource was not found", false},
	"METHOD_NOT_ALLOWED":                {405, "method is not allowed", false},
	"CONFLICT":                          {409, "request conflicts with current state", false},
	"REVISION_CONFLICT":                 {409, "Configuration changed", false},
	"IDEMPOTENCY_CONFLICT":              {409, "Idempotency key was already used", false},
	"RATE_LIMITED":                      {429, "rate limited", true},
	"DEPENDENCY_UNAVAILABLE":            {503, "A required dependency is unavailable", true},
	"STORAGE_UNAVAILABLE":               {503, "Storage is unavailable", true},
	"UNSUPPORTED_LIMIT":                 {400, "Resource limit is unsupported", false},
	"QUOTA_EXCEEDED":                    {429, "resource quota is exceeded", false},
	"WORK_BUSY":                         {409, "Work is busy", true},
	"WORK_NOT_READY":                    {409, "Work is not ready", true},
	"WORK_UNAVAILABLE":                  {503, "Work is not ready", true},
	"WORK_SNAPSHOT_BUSY":                {409, "Work is locked by a snapshot operation", true},
	"CURSOR_EXPIRED":                    {416, "Run cursor has expired; query durable Run status or Session history", false},
	"INVALID_ARGUMENT":                  {400, "Request fields are invalid", false},
	"INVALID_REQUEST":                   {400, "Request fields are invalid", false},
	"INVALID_CONFIGURATION":             {400, "Work configuration is invalid", false},
	"INVALID_JSON":                      {400, "Request body must be valid JSON", false},
	"REQUEST_TOO_LARGE":                 {413, "Request body is too large", false},
	"REQUEST_TIMEOUT":                   {408, "Request timed out", true},
	"UNSUPPORTED_MEDIA_TYPE":            {415, "Expected application/json", false},
	"PRECONDITION_FAILED":               {412, "Request precondition failed", false},
	"INTERNAL":                          {500, "Request could not be completed", false},
	"INTERNAL_ERROR":                    {500, "internal server error", false},
	"RUNTIME_UNAVAILABLE":               {503, "runtime dependency is unavailable", true},
	"LAST_ADMINISTRATOR":                {409, "cannot disable the last enabled administrator", false},
	"SKILL_ALREADY_EXISTS":              {409, "Skill already exists", false},
	"SKILL_UNAVAILABLE":                 {404, "Skill is unavailable", false},
	"SKILL_NAME_MISMATCH":               {400, "Skill name does not match the update target", false},
	"SKILL_UPLOAD_INVALID":              {400, "Skill upload is invalid", false},
	"SKILL_UPLOAD_LIMIT_EXCEEDED":       {413, "Skill upload exceeds a limit", false},
	"SKILL_UPLOAD_TIMEOUT":              {408, "Skill upload timed out", true},
	"SKILL_UPLOAD_BUSY":                 {429, "Skill upload capacity is full", true},
	"PI_PACKAGE_NOT_FOUND":              {404, "Work package is unavailable", false},
	"PI_PACKAGE_NOT_INSTALLED":          {400, "Package is not installed in this Work", false},
	"PI_PACKAGE_IN_DEFAULTS":            {409, "Package is selected by Work defaults", false},
	"PI_PACKAGE_BUSY":                   {409, "Package catalog is busy", true},
	"PI_PACKAGE_INVALID_SOURCE":         {400, "Package source is invalid", false},
	"PI_PACKAGE_INVALID_MANIFEST":       {400, "Package manifest is invalid", false},
	"PI_PACKAGE_UNSAFE_ARCHIVE":         {400, "Package archive is unsafe", false},
	"PI_PACKAGE_LIMIT_EXCEEDED":         {413, "Package exceeds a limit", false},
	"PI_PACKAGE_UNSUPPORTED_MEDIA_TYPE": {415, "Expected application/zip", false},
	"PI_PACKAGE_HELPER_INCOMPATIBLE":    {409, "Selected agent image does not provide the package helper contract", false},
	"PI_PACKAGE_ENVIRONMENT_MISMATCH":   {409, "Package preparation environment is incompatible", false},
	"PI_PACKAGE_ALREADY_INSTALLED":      {409, "Package is already installed", false},
	"PI_PACKAGE_NAME_MISMATCH":          {400, "Package name does not match the update target", false},
}
var safeField = regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)*$`)

func NewError(code string, field string) *PublicError {
	if _, known := publicErrors[code]; !known {
		code = "INTERNAL_ERROR"
	}
	if len(field) > 256 || !safeField.MatchString(field) {
		field = ""
	}
	return &PublicError{code: code, field: field}
}
func (e *PublicError) WithRetryAfter(milliseconds int64) *PublicError {
	copy := *e
	if milliseconds >= 0 && milliseconds <= MaxSafeInteger {
		copy.retryAfterMs = Supplied(milliseconds)
	}
	return &copy
}

type ErrorView struct {
	Code         string        `json:"code"`
	Message      string        `json:"message"`
	Retryable    bool          `json:"retryable"`
	Field        Field[string] `json:"field,omitzero"`
	RetryAfterMs Field[int64]  `json:"retryAfterMs,omitzero"`
}

func ProjectError(err error) (int, ErrorView) {
	public := NewError("INTERNAL_ERROR", "")
	var explicit *PublicError
	var validation *ValidationError
	switch {
	case errors.As(err, &explicit) && explicit != nil:
		public = explicit
	case errors.As(err, &validation):
		public = NewError("INVALID_REQUEST", validation.Field)
	case errors.Is(err, ErrJSONTooLarge):
		public = NewError("REQUEST_TOO_LARGE", "")
	case errors.Is(err, ErrInvalidJSON):
		public = NewError("INVALID_JSON", "")
	}
	definition, known := publicErrors[public.code]
	if !known {
		public = NewError("INTERNAL_ERROR", "")
		definition = publicErrors[public.code]
	}
	view := ErrorView{Code: public.code, Message: definition.message, Retryable: definition.retryable, RetryAfterMs: public.retryAfterMs}
	if public.field != "" {
		view.Field = Supplied(public.field)
	}
	return definition.status, view
}
func WriteError(writer http.ResponseWriter, err error) {
	status, view := ProjectError(err)
	writer.Header().Set("Content-Type", "application/json")
	writer.Header().Set("Cache-Control", "no-store")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(view)
}

// The operator/admin HTTP contract has correlationId rather than retryable.
// Keep the two wire views separate even though they share domain errors.
func ProjectAdminError(err error, correlationID ResourceId) (int, AdminError) {
	status, view := ProjectError(err)
	return status, AdminError{Code: view.Code, Message: view.Message, CorrelationId: correlationID, Field: view.Field, RetryAfterMs: view.RetryAfterMs}
}
