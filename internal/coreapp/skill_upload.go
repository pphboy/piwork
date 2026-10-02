package coreapp

import (
	"bytes"
	"context"
	"errors"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"piwork/internal/contracts"
	"piwork/internal/identity"
	"piwork/internal/skillartifact"
)

const (
	skillUploadMaxBody    = 64 << 20
	skillUploadMaxFile    = 8 << 20
	skillUploadMaxContent = 32 << 20
	skillUploadMaxFiles   = 2048
)

var uploadSkillName = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,63}$`)
var errSkillUploadLimit = errors.New("Skill upload limit exceeded")
var errSkillUploadTimeout = errors.New("Skill upload timed out")

type skillUploadReader struct {
	source   io.Reader
	control  *http.ResponseController
	deadline time.Time
	progress time.Time
	bytes    int64
}

func (reader *skillUploadReader) Read(p []byte) (int, error) {
	until := reader.progress.Add(time.Minute)
	if until.After(reader.deadline) {
		until = reader.deadline
	}
	if !until.After(time.Now()) {
		return 0, errSkillUploadTimeout
	}
	if reader.control.SetReadDeadline(until) != nil {
		return 0, errSkillUploadTimeout
	}
	n, err := reader.source.Read(p)
	reader.bytes += int64(n)
	if n > 0 {
		reader.progress = time.Now()
	}
	if reader.bytes > skillUploadMaxBody {
		return n, errSkillUploadLimit
	}
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, os.ErrDeadlineExceeded) {
		return n, errSkillUploadTimeout
	}
	return n, err
}

func acquireSkillUploadSlot(a *Application) bool {
	for {
		active := a.skillUploads.Load()
		if active >= 2 {
			return false
		}
		if a.skillUploads.CompareAndSwap(active, active+1) {
			return true
		}
	}
}

func (a *Application) adminSkillUpload(w http.ResponseWriter, r *http.Request, actor identity.Principal, expectedName string, update bool) error {
	if err := a.Identity.AuthorizeAdministrator(r.Context(), actor); err != nil {
		return err
	}
	if r.ContentLength > skillUploadMaxBody {
		return contracts.NewError("SKILL_UPLOAD_LIMIT_EXCEEDED", "")
	}
	if !acquireSkillUploadSlot(a) {
		return contracts.NewError("SKILL_UPLOAD_BUSY", "").WithRetryAfter(1000)
	}
	defer a.skillUploads.Add(-1)
	contentType := r.Header.Get("Content-Type")
	mediaType, params, err := mime.ParseMediaType(contentType)
	if err != nil || mediaType != "multipart/form-data" || len(params) != 1 || params["boundary"] == "" || len(params["boundary"]) > 70 {
		return contracts.NewError("UNSUPPORTED_MEDIA_TYPE", "")
	}
	now := time.Now()
	reader := &skillUploadReader{source: r.Body, control: http.NewResponseController(w), deadline: now.Add(30 * time.Minute), progress: now}
	parser := multipart.NewReader(reader, params["boundary"])
	var name string
	var files []skillartifact.File
	var contentBytes int64
	seenFiles := make(map[string]struct{})
	seenDirectories := make(map[string]struct{})
	for index := 0; ; index++ {
		part, err := parser.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return skillUploadReadError(err)
		}
		if index > skillUploadMaxFiles || len(part.Header) > 64 {
			return contracts.NewError("SKILL_UPLOAD_LIMIT_EXCEEDED", "")
		}
		_, disposition, err := mime.ParseMediaType(part.Header.Get("Content-Disposition"))
		if err != nil {
			return contracts.NewError("SKILL_UPLOAD_INVALID", "")
		}
		if index == 0 {
			if disposition["name"] != "directoryName" {
				return contracts.NewError("SKILL_UPLOAD_INVALID", "")
			}
			if _, hasFilename := disposition["filename"]; hasFilename {
				return contracts.NewError("SKILL_UPLOAD_INVALID", "")
			}
			data, readErr := io.ReadAll(io.LimitReader(part, 65))
			if readErr != nil {
				return skillUploadReadError(readErr)
			}
			if len(data) > 64 {
				return contracts.NewError("SKILL_UPLOAD_INVALID", "")
			}
			part.Close()
			name = string(data)
			if !uploadSkillName.MatchString(name) {
				return contracts.NewError("SKILL_UPLOAD_INVALID", "")
			}
			if update && name != expectedName {
				return contracts.NewError("SKILL_NAME_MISMATCH", "")
			}
			continue
		}
		encoded, hasFilename := disposition["filename"]
		if disposition["name"] != "files" || !hasFilename || len(files) >= skillUploadMaxFiles {
			if len(files) >= skillUploadMaxFiles {
				return contracts.NewError("SKILL_UPLOAD_LIMIT_EXCEEDED", "")
			}
			return contracts.NewError("SKILL_UPLOAD_INVALID", "")
		}
		relative, err := decodeSkillUploadPath(encoded)
		if err != nil || !recordSkillUploadPath(relative, seenFiles, seenDirectories) {
			return contracts.NewError("SKILL_UPLOAD_INVALID", "")
		}
		data, readErr := io.ReadAll(io.LimitReader(part, skillUploadMaxFile+1))
		if readErr != nil {
			return skillUploadReadError(readErr)
		}
		contentBytes += int64(len(data))
		if len(data) > skillUploadMaxFile || contentBytes > skillUploadMaxContent {
			return contracts.NewError("SKILL_UPLOAD_LIMIT_EXCEEDED", "")
		}
		part.Close()
		files = append(files, skillartifact.File{Path: relative, Data: data})
	}
	if name == "" || len(files) == 0 {
		return contracts.NewError("SKILL_UPLOAD_INVALID", "")
	}
	snapshot, err := skillartifact.FromFiles(name, files)
	if err != nil {
		return contracts.NewError("SKILL_UPLOAD_INVALID", "")
	}
	if err := a.Identity.AuthorizeAdministrator(r.Context(), actor); err != nil {
		return err
	}
	skill, err := a.publishSkillSnapshot(r.Context(), actor, snapshot, update)
	if err != nil {
		_, view := contracts.ProjectError(err)
		switch view.Code {
		case "CONFLICT":
			return contracts.NewError("SKILL_ALREADY_EXISTS", "")
		case "NOT_FOUND":
			return contracts.NewError("SKILL_UNAVAILABLE", "")
		case "INVALID_REQUEST":
			return contracts.NewError("SKILL_UPLOAD_INVALID", "")
		}
		return err
	}
	if update {
		send(w, http.StatusOK, skill)
	} else {
		send(w, http.StatusCreated, skill)
	}
	return nil
}

func skillUploadReadError(err error) error {
	if errors.Is(err, errSkillUploadLimit) {
		return contracts.NewError("SKILL_UPLOAD_LIMIT_EXCEEDED", "")
	}
	if errors.Is(err, errSkillUploadTimeout) || errors.Is(err, context.DeadlineExceeded) {
		return contracts.NewError("SKILL_UPLOAD_TIMEOUT", "")
	}
	return contracts.NewError("SKILL_UPLOAD_INVALID", "")
}

func decodeSkillUploadPath(encoded string) (string, error) {
	if encoded == "" || strings.ContainsAny(encoded, "/\\") {
		return "", errors.New("invalid uploaded path")
	}
	decoded, err := url.PathUnescape(encoded)
	if err != nil || !utf8.ValidString(decoded) || encodeURIComponent(decoded) != encoded || len(decoded) > 4096 || strings.HasPrefix(decoded, "/") || strings.ContainsRune(decoded, '\\') || len(strings.Split(decoded, "/")) > 64 {
		return "", errors.New("invalid uploaded path")
	}
	if len(decoded) >= 2 && (decoded[0] >= 'A' && decoded[0] <= 'Z' || decoded[0] >= 'a' && decoded[0] <= 'z') && decoded[1] == ':' {
		return "", errors.New("invalid uploaded path")
	}
	for _, part := range strings.Split(decoded, "/") {
		if part == "" || part == "." || part == ".." {
			return "", errors.New("invalid uploaded path")
		}
		for _, r := range part {
			if r < 0x20 || r == 0x7f {
				return "", errors.New("invalid uploaded path")
			}
		}
	}
	return decoded, nil
}

func encodeURIComponent(value string) string {
	var output bytes.Buffer
	const hex = "0123456789ABCDEF"
	for _, b := range []byte(value) {
		if b >= 'a' && b <= 'z' || b >= 'A' && b <= 'Z' || b >= '0' && b <= '9' || strings.ContainsRune("-_.!~*'()", rune(b)) {
			output.WriteByte(b)
		} else {
			output.WriteByte('%')
			output.WriteByte(hex[b>>4])
			output.WriteByte(hex[b&15])
		}
	}
	return output.String()
}

func recordSkillUploadPath(relative string, files, directories map[string]struct{}) bool {
	if _, duplicate := files[relative]; duplicate {
		return false
	}
	if _, conflict := directories[relative]; conflict {
		return false
	}
	parts := strings.Split(relative, "/")
	for i := 1; i < len(parts); i++ {
		parent := strings.Join(parts[:i], "/")
		if _, conflict := files[parent]; conflict {
			return false
		}
	}
	files[relative] = struct{}{}
	for i := 1; i < len(parts); i++ {
		directories[strings.Join(parts[:i], "/")] = struct{}{}
	}
	return true
}
