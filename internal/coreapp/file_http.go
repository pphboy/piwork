package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"piwork/internal/contracts"
	"piwork/internal/fileprotocol"
	"piwork/internal/workfiles"
)

type fileHTTPWriter struct {
	http.ResponseWriter
	started bool
}

func (w *fileHTTPWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }
func (w *fileHTTPWriter) WriteHeader(status int) {
	w.started = true
	w.ResponseWriter.WriteHeader(status)
}
func (w *fileHTTPWriter) Write(data []byte) (int, error) {
	if !w.started {
		w.WriteHeader(200)
	}
	return w.ResponseWriter.Write(data)
}

func (a *Application) serveFiles(writer http.ResponseWriter, request *http.Request) {
	w := &fileHTTPWriter{ResponseWriter: writer}
	var rangeSize *int64
	err := a.handleFiles(w, request, &rangeSize)
	if err == nil {
		return
	}
	if w.started {
		panic(http.ErrAbortHandler)
	}
	// Cancellation expires the connection deadlines to release blocked I/O.
	// Allow a bounded error reply when no response has started yet.
	_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(time.Second))
	workfiles.SendError(w, fileFailure(err), request.Method == "HEAD", rangeSize)
	_ = http.NewResponseController(w).SetWriteDeadline(time.Time{})
}

func fileHeader(r *http.Request, key string, limit int) (any, error) {
	values := r.Header.Values(key)
	if len(values) == 0 {
		return nil, nil
	}
	if len(values) != 1 || len(values[0]) > limit {
		return nil, fileprotocol.Failure("FILE_REQUEST_INVALID")
	}
	return values[0], nil
}
func fileRequestConditions(r *http.Request) (fileConditions, error) {
	var c fileConditions
	for _, item := range []struct {
		key    string
		limit  int
		target *json.RawMessage
	}{
		{"If-Match", 8192, &c.IfMatch}, {"If-None-Match", 8192, &c.IfNoneMatch}, {"If-Modified-Since", 128, &c.IfModifiedSince}, {"If-Unmodified-Since", 128, &c.IfUnmodifiedSince},
	} {
		value, err := fileHeader(r, item.key, item.limit)
		if err != nil {
			return c, err
		}
		*item.target = jsonValue(value)
	}
	return c, nil
}
func emptyFileConditions() fileConditions {
	return fileConditions{jsonValue(nil), jsonValue(nil), jsonValue(nil), jsonValue(nil)}
}
func sendFileEmpty(w http.ResponseWriter, status int) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Length", "0")
	w.WriteHeader(status)
}
func sendFileXML(w http.ResponseWriter, body string) {
	w.Header().Set("Content-Type", "application/xml; charset=utf-8")
	w.Header().Set("Content-Length", strconv.Itoa(len(body)))
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(207)
	_, _ = io.WriteString(w, body)
}

func (a *Application) handleFiles(w *fileHTTPWriter, r *http.Request, rangeSize **int64) error {
	size := len(r.Host) + 4
	for key, values := range r.Header {
		for _, value := range values {
			size += len(key) + len(value) + 4
		}
	}
	if size > 32<<10 {
		return fileprotocol.Failure("HEADERS_TOO_LARGE")
	}
	tokens := r.Header.Values("Authorization")
	if len(tokens) != 1 || !strings.HasPrefix(tokens[0], "Bearer ") {
		return fileprotocol.Failure("AUTH_REQUIRED")
	}
	token := strings.TrimPrefix(tokens[0], "Bearer ")
	if token == "" || strings.ContainsAny(token, " \t\r\n") {
		return fileprotocol.Failure("AUTH_REQUIRED")
	}
	session, err := a.Identity.Authenticate(r.Context(), token)
	if err != nil {
		return fileprotocol.Failure("AUTH_REQUIRED")
	}
	workID := workfiles.RawWorkID(r.RequestURI)
	var owner string
	err = a.Store.Read(r.Context(), func(tx *sql.Tx) error {
		return tx.QueryRowContext(r.Context(), `SELECT owner_user_id FROM works WHERE id=?`, workID).Scan(&owner)
	})
	if err != nil || owner != session.User.ID {
		return fileprotocol.Failure("NOT_FOUND")
	}
	target, err := workfiles.ParseTarget(r.RequestURI)
	if err != nil {
		return err
	}
	identity := fileAccessIdentity{WorkID: workID, OwnerUserID: owner, SessionID: session.SessionID}
	err = a.Store.Read(r.Context(), func(tx *sql.Tx) error {
		return tx.QueryRowContext(r.Context(), `SELECT generation FROM runtime_generations WHERE work_id=? AND state='ready' ORDER BY generation DESC LIMIT 1`, workID).Scan(&identity.RuntimeGeneration)
	})
	if err != nil {
		return fileprotocol.Failure("WORK_FILES_UNAVAILABLE")
	}
	if _, _, err = a.validateFileAccess(r.Context(), identity); err != nil {
		return err
	}
	ctx, cancel, err := a.Identity.WatchSession(r.Context(), token)
	if err != nil {
		return fileprotocol.Failure("AUTH_REQUIRED")
	}
	defer cancel()
	if target.RootWithoutSlash {
		w.Header().Set("Location", target.EncodedPath)
		sendFileEmpty(w, 308)
		return nil
	}
	if _, err = a.requireFileImage(); err != nil {
		return err
	}
	if _, ok := r.Header["If"]; ok {
		return fileprotocol.Failure("FILE_CONDITION_UNSUPPORTED")
	}
	if _, ok := r.Header["Lock-Token"]; ok {
		return fileprotocol.Failure("FILE_CONDITION_UNSUPPORTED")
	}
	encoding, err := fileHeader(r, "Content-Encoding", 128)
	if err != nil {
		return err
	}
	if encoding != nil && encoding != "identity" {
		return fileprotocol.Failure("FILE_MEDIA_UNSUPPORTED")
	}
	controller := http.NewResponseController(w)
	cancelIO := func() { _ = controller.SetReadDeadline(time.Now()); _ = controller.SetWriteDeadline(time.Now()) }
	input := fileExecutionInput{Identity: identity, Path: target.Segments, Conditions: emptyFileConditions(), CancelIO: cancelIO}
	// Also cover XML/empty-body reads before the helper job is accepted.
	stopIO := context.AfterFunc(ctx, cancelIO)
	defer stopIO()
	if r.Method == "OPTIONS" {
		w.Header().Set("Allow", workfiles.Allow)
		sendFileEmpty(w, 200)
		return nil
	}
	if r.Method == "PROPFIND" || r.Method == "PROPPATCH" {
		return a.fileProperties(ctx, w, r, input)
	}
	input.Conditions, err = fileRequestConditions(r)
	if err != nil {
		return err
	}
	if r.Method == "MKCOL" || r.Method == "COPY" || r.Method == "MOVE" || r.Method == "DELETE" {
		return a.fileNamespace(ctx, w, r, input)
	}
	if r.Method != "GET" && r.Method != "HEAD" && r.Method != "PUT" {
		return fileprotocol.Failure("FILE_METHOD_NOT_ALLOWED")
	}
	input.Action = r.Method
	if r.Method == "PUT" {
		if len(target.Segments) == 0 {
			return fileprotocol.Failure("FILE_ROOT_PROTECTED")
		}
		if _, ok := r.Header["Content-Range"]; ok {
			return fileprotocol.Failure("FILE_REQUEST_INVALID")
		}
		if r.ContentLength > fileprotocol.MaxFile {
			return fileprotocol.Failure("FILE_LIMIT_EXCEEDED")
		}
		if r.ContentLength >= 0 {
			input.ExpectedLength = r.ContentLength
		}
		input.Body = r.Body
	}
	if r.Method == "GET" && len(r.Header.Values("If-Range")) == 0 && len(r.Header.Values("Range")) != 0 {
		values := r.Header.Values("Range")
		if len(values) == 1 {
			input.Range, err = workfiles.ReadRange(values[0])
		} else {
			err = fileprotocol.Failure("FILE_RANGE_UNSATISFIABLE")
		}
		if err != nil {
			probe := input
			probe.Action = "HEAD"
			probe.Conditions = emptyFileConditions()
			probe.Range = nil
			probe.OnMeta = func(meta contracts.FileHelperMeta) error {
				var n int64
				if meta.Kind == "file" && json.Unmarshal(meta.Size, &n) == nil {
					*rangeSize = &n
				}
				return nil
			}
			if _, failure := a.executeFileJob(ctx, probe); failure != nil {
				return failure
			}
			return err
		}
	}
	return a.fileTransfer(ctx, w, r, input, rangeSize)
}

func (a *Application) fileProperties(ctx context.Context, w http.ResponseWriter, r *http.Request, input fileExecutionInput) error {
	if r.Method == "PROPPATCH" && len(input.Path) == 0 {
		return fileprotocol.Failure("FILE_ROOT_PROTECTED")
	}
	body, err := workfiles.ReadXML(r)
	if err != nil {
		return err
	}
	var props workfiles.PropertyRequest
	var patch []workfiles.QName
	if r.Method == "PROPFIND" {
		props, err = workfiles.ParsePropfind(body)
		if err != nil {
			return err
		}
		depth, failure := fileHeader(r, "Depth", 32)
		if failure != nil {
			return failure
		}
		switch depth {
		case "0":
			input.Depth = 0
		case "1":
			input.Depth = 1
		case nil, "infinity":
			return fileprotocol.Failure("FILE_DEPTH_UNSUPPORTED")
		default:
			return fileprotocol.Failure("FILE_REQUEST_INVALID")
		}
	} else {
		patch, err = workfiles.ParseProppatch(body)
		if err != nil {
			return err
		}
		input.Depth = 0
	}
	input.Action = "PROPFIND"
	var entries []contracts.FileHelperMeta
	input.OnMeta = func(meta contracts.FileHelperMeta) error { entries = append(entries, meta); return nil }
	result, err := a.executeFileJob(ctx, input)
	if err != nil {
		return err
	}
	if len(entries) == 0 || result.Status != 207 || result.Entries != int64(len(entries)) {
		return fileprotocol.Failure("FILE_BACKEND_PROTOCOL_ERROR")
	}
	if r.Method == "PROPFIND" {
		body, err = workfiles.RenderPropfind(input.Identity.WorkID, entries, props)
	} else {
		body, err = workfiles.RenderProppatch(input.Identity.WorkID, entries[0], patch)
	}
	if err != nil {
		return err
	}
	sendFileXML(w, body)
	return nil
}

func (a *Application) fileNamespace(ctx context.Context, w http.ResponseWriter, r *http.Request, input fileExecutionInput) error {
	if len(input.Path) == 0 {
		return fileprotocol.Failure("FILE_ROOT_PROTECTED")
	}
	input.Action = r.Method
	var err error
	if r.Method == "COPY" || r.Method == "MOVE" {
		input.Destination, err = workfiles.Destination(r, input.Identity.WorkID)
		if err != nil {
			return err
		}
	}
	if r.Method != "MKCOL" {
		depth, failure := fileHeader(r, "Depth", 32)
		if failure != nil {
			return failure
		}
		if r.Method == "COPY" && depth == "0" {
			input.Depth = 0
		} else if depth == nil || depth == "infinity" {
			input.Depth = "infinity"
		} else {
			return fileprotocol.Failure("FILE_REQUEST_INVALID")
		}
	}
	overwrite, err := fileHeader(r, "Overwrite", 16)
	if err != nil {
		return err
	}
	if overwrite != nil {
		if overwrite != "T" && overwrite != "F" {
			return fileprotocol.Failure("FILE_REQUEST_INVALID")
		}
		input.Overwrite = overwrite == "T"
	}
	code := "FILE_REQUEST_INVALID"
	if r.Method == "MKCOL" {
		code = "FILE_MEDIA_UNSUPPORTED"
	}
	if r.ContentLength > 0 {
		return fileprotocol.Failure(code)
	}
	var one [1]byte
	n, err := r.Body.Read(one[:])
	if n != 0 {
		return fileprotocol.Failure(code)
	}
	if err != nil && err != io.EOF {
		return fileFailure(err)
	}
	result, err := a.executeFileJob(ctx, input)
	if err != nil {
		return err
	}
	if result.Status == 207 {
		if len(result.Failures) == 0 {
			return fileprotocol.Failure("FILE_BACKEND_PROTOCOL_ERROR")
		}
		roots := [][]string{input.Path}
		if input.Destination != nil {
			roots = append(roots, input.Destination)
		}
		body, err := workfiles.RenderFailures(input.Identity.WorkID, roots, result.Failures)
		if err != nil {
			return err
		}
		sendFileXML(w, body)
	} else {
		if result.Status != 201 && result.Status != 204 || len(result.Failures) != 0 {
			return fileprotocol.Failure("FILE_BACKEND_PROTOCOL_ERROR")
		}
		sendFileEmpty(w, int(result.Status))
	}
	return nil
}

func fileRangeSpan(value any, size int64) (start, length int64) {
	if value == nil {
		return 0, size
	}
	rangeValue := value.(map[string]any)
	if suffix, ok := rangeValue["suffix"].(int64); ok {
		if suffix > size {
			suffix = size
		}
		return size - suffix, suffix
	}
	start = rangeValue["start"].(int64)
	end := size - 1
	if explicit, ok := rangeValue["end"].(int64); ok && explicit < end {
		end = explicit
	}
	return start, end - start + 1
}
func (a *Application) fileTransfer(ctx context.Context, w *fileHTTPWriter, r *http.Request, input fileExecutionInput, rangeSize **int64) error {
	var metadata *contracts.FileHelperMeta
	var size, transferred, announced int64
	begin := func(status int, length int64) {
		announced = length
		w.Header().Set("Cache-Control", "no-store")
		if status != 304 {
			w.Header().Set("Content-Length", strconv.FormatInt(length, 10))
		}
		if metadata != nil {
			if metadata.Kind == "file" {
				w.Header().Set("Content-Type", "application/octet-stream")
			}
			var ms int64
			if string(metadata.ModifiedMs) != "null" && json.Unmarshal(metadata.ModifiedMs, &ms) == nil {
				w.Header().Set("Last-Modified", time.UnixMilli(ms).UTC().Format(http.TimeFormat))
			}
		}
		if status == 206 {
			start, _ := fileRangeSpan(input.Range, size)
			w.Header().Set("Content-Range", "bytes "+strconv.FormatInt(start, 10)+"-"+strconv.FormatInt(start+length-1, 10)+"/"+strconv.FormatInt(size, 10))
		}
		w.WriteHeader(status)
	}
	input.OnMeta = func(meta contracts.FileHelperMeta) error {
		if metadata != nil {
			return fileprotocol.Failure("FILE_BACKEND_PROTOCOL_ERROR")
		}
		metadata = &meta
		if meta.Kind == "file" {
			if json.Unmarshal(meta.Size, &size) != nil {
				return fileprotocol.Failure("FILE_BACKEND_PROTOCOL_ERROR")
			}
			if size > fileprotocol.MaxFile {
				return fileprotocol.Failure("FILE_LIMIT_EXCEEDED")
			}
			*rangeSize = &size
		}
		return nil
	}
	input.OnData = func(chunk []byte) error {
		if metadata == nil || metadata.Kind != "file" || r.Method != "GET" {
			return fileprotocol.Failure("FILE_BACKEND_PROTOCOL_ERROR")
		}
		if !w.started {
			_, length := fileRangeSpan(input.Range, size)
			status := 200
			if input.Range != nil {
				status = 206
			}
			begin(status, length)
		}
		transferred += int64(len(chunk))
		if transferred > announced {
			return fileprotocol.Failure("FILE_BACKEND_PROTOCOL_ERROR")
		}
		n, err := w.Write(chunk)
		if err != nil {
			return fileFailure(err)
		}
		if n != len(chunk) {
			return fileprotocol.Failure("FILE_TRANSFER_TIMEOUT")
		}
		return nil
	}
	result, err := a.executeFileJob(ctx, input)
	if err != nil {
		return err
	}
	if r.Method == "GET" {
		if metadata == nil || transferred != result.Bytes {
			return fileprotocol.Failure("FILE_BACKEND_PROTOCOL_ERROR")
		}
		expected := int64(200)
		if input.Range != nil {
			expected = 206
		}
		if w.started && (transferred != announced || result.Status != expected) || !w.started && result.Status != 304 && (result.Status != expected || result.Bytes != size) {
			return fileprotocol.Failure("FILE_BACKEND_PROTOCOL_ERROR")
		}
	} else if r.Method == "HEAD" {
		if metadata == nil || result.Bytes != 0 || result.Status != 200 && result.Status != 304 {
			return fileprotocol.Failure("FILE_BACKEND_PROTOCOL_ERROR")
		}
	} else if result.Status != 201 && result.Status != 204 {
		return fileprotocol.Failure("FILE_BACKEND_PROTOCOL_ERROR")
	}
	if !w.started {
		length := int64(0)
		if r.Method == "HEAD" && result.Status == 200 && metadata.Kind == "file" {
			length = size
		}
		if r.Method == "GET" {
			length = result.Bytes
		}
		begin(int(result.Status), length)
	}
	return nil
}
