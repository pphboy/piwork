package coreapp

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode/utf16"

	"github.com/google/uuid"
	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/identity"
)

var ErrOperatorCredential = errors.New("operator credential storage is invalid")

type operatorMetadata struct {
	Version   int    `json:"version"`
	Digest    string `json:"digest"`
	CreatedAt string `json:"createdAt"`
}
type Settings struct {
	store *corestore.Store
	files *corestore.PlatformFiles
	mu    sync.Mutex
}

func NewSettings(store *corestore.Store, files *corestore.PlatformFiles) *Settings {
	return &Settings{store: store, files: files}
}
func strictMetadata(data []byte, output any) error {
	if _, err := contracts.ParseJSON(bytes.NewReader(data), 2<<20); err != nil {
		return corestore.ErrStorage
	}
	d := json.NewDecoder(bytes.NewReader(data))
	d.DisallowUnknownFields()
	if d.Decode(output) != nil {
		return corestore.ErrStorage
	}
	return nil
}
func (s *Settings) EnsureOperator(ctx context.Context) error {
	raw, err := s.store.ControlMetadata(ctx, "operator_credential")
	if err != nil {
		return ErrOperatorCredential
	}
	file, err := s.files.ReadOperator()
	if corestore.IsMissingPlatformFile(err) {
		if len(raw) != 0 {
			return ErrOperatorCredential
		}
		token, err := newOperatorToken()
		if err != nil {
			return ErrOperatorCredential
		}
		file = []byte(token + "\n")
		if err := s.files.PublishOperator(file); err != nil {
			return ErrOperatorCredential
		}
	} else if err != nil {
		return ErrOperatorCredential
	}
	token := strings.TrimRight(string(file), "\r\n")
	if len(token) < 32 || len(token) > 512 || strings.ContainsAny(token, "\x00\r\n") {
		return ErrOperatorCredential
	}
	digest := identity.TokenDigest(token)
	if len(raw) == 0 {
		metadata, _ := json.Marshal(operatorMetadata{1, digest, time.Now().UTC().Format(time.RFC3339Nano)})
		if _, err := s.store.PutControlMetadataIfAbsent(ctx, "operator_credential", metadata); err != nil {
			return ErrOperatorCredential
		}
		raw, err = s.store.ControlMetadata(ctx, "operator_credential")
		if err != nil {
			return ErrOperatorCredential
		}
	}
	var metadata operatorMetadata
	if strictMetadata(raw, &metadata) != nil || metadata.Version != 1 || len(metadata.Digest) != 64 || subtle.ConstantTimeCompare([]byte(metadata.Digest), []byte(digest)) != 1 {
		return ErrOperatorCredential
	}
	return nil
}
func newOperatorToken() (string, error) {
	var token [32]byte
	if _, err := rand.Read(token[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(token[:]), nil
}
func (s *Settings) VerifyOperator(ctx context.Context, candidate string) bool {
	if len(candidate) < 32 || len(candidate) > 512 {
		return false
	}
	raw, err := s.store.ControlMetadata(ctx, "operator_credential")
	if err != nil {
		return false
	}
	var metadata operatorMetadata
	if strictMetadata(raw, &metadata) != nil || metadata.Version != 1 {
		return false
	}
	digest := identity.TokenDigest(candidate)
	return subtle.ConstantTimeCompare([]byte(digest), []byte(metadata.Digest)) == 1
}

type RuntimeInput struct {
	AgentImage, Provider, Model, Credential string
	BaseURL                                 *string
}
type RuntimeProfile struct {
	Version    int    `json:"version"`
	Revision   int64  `json:"revision"`
	AgentImage string `json:"agentImage"`
	ModelRef   string `json:"modelRef,omitempty"`
	Model      struct {
		Provider      string          `json:"provider"`
		ID            string          `json:"id"`
		BaseURL       *string         `json:"baseUrl,omitempty"`
		CredentialRef string          `json:"credentialRef"`
		API           string          `json:"api,omitempty"`
		Capabilities  json.RawMessage `json:"capabilities,omitempty"`
	} `json:"model"`
	UpdatedAt string `json:"updatedAt"`
}
type RuntimeView struct {
	Configured bool   `json:"configured"`
	Version    int    `json:"version,omitempty"`
	Revision   int64  `json:"revision,omitempty"`
	AgentImage string `json:"agentImage,omitempty"`
	ModelRef   string `json:"modelRef,omitempty"`
	Model      *struct {
		Provider            string  `json:"provider"`
		ID                  string  `json:"id"`
		BaseURL             *string `json:"baseUrl,omitempty"`
		CredentialAvailable bool    `json:"credentialAvailable"`
	} `json:"model,omitempty"`
	UpdatedAt string `json:"updatedAt,omitempty"`
}

var providerPattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,255}$`)

func ValidateRuntime(input RuntimeInput) error {
	length := func(s string) int { return len(utf16.Encode([]rune(s))) }
	if trimJS(input.AgentImage) == "" || length(input.AgentImage) > 4096 {
		return contracts.NewError("INVALID_REQUEST", "agentImage")
	}
	if !providerPattern.MatchString(input.Provider) {
		return contracts.NewError("INVALID_REQUEST", "provider")
	}
	if trimJS(input.Model) == "" || length(input.Model) > 512 {
		return contracts.NewError("INVALID_REQUEST", "model")
	}
	if input.Credential == "" || length(input.Credential) > 65536 {
		return contracts.NewError("INVALID_REQUEST", "credential")
	}
	if input.BaseURL != nil {
		u, err := url.Parse(*input.BaseURL)
		if err != nil || u.Host == "" || u.Scheme == "" {
			return contracts.NewError("INVALID_REQUEST", "baseUrl")
		}
		if u.Scheme != "https" && !(u.Scheme == "http" && (u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1" || u.Hostname() == "::1")) {
			return contracts.NewError("INVALID_REQUEST", "baseUrl")
		}
	}
	return nil
}
func (s *Settings) LoadRuntime() (RuntimeProfile, bool, error) {
	raw, err := s.files.Read("runtime-profile.json", 2<<20)
	var p RuntimeProfile
	if err != nil && !corestore.IsMissingPlatformFile(err) {
		return p, false, corestore.ErrStorage
	}
	if err == nil && (strictMetadata(raw, &p) != nil || p.Version != 1 || p.Revision < 1 || p.AgentImage == "" || p.Model.Provider == "" || p.Model.ID == "" || !regexp.MustCompile(`^model-[a-f0-9-]{36}\.secret$`).MatchString(p.Model.CredentialRef)) {
		return p, false, corestore.ErrStorage
	}
	selection, err := s.store.ControlMetadata(context.Background(), "runtime_model_selection")
	if err != nil {
		return RuntimeProfile{}, false, err
	}
	if len(selection) > 0 {
		var selected runtimeModelSelection
		if strictMetadata(selection, &selected) != nil || selected.Version != 1 {
			return RuntimeProfile{}, false, corestore.ErrStorage
		}
		if selected.SourceRevision == p.Revision {
			p = selected.Profile
		}
	}
	return p, p.Version == 1 && p.Revision > 0, nil
}
func (s *Settings) RuntimeView() (RuntimeView, error) {
	p, exists, err := s.LoadRuntime()
	if err != nil {
		return RuntimeView{}, err
	}
	if !exists {
		return RuntimeView{Configured: false}, nil
	}
	_, credentialErr := s.files.ReadSecret(p.Model.CredentialRef)
	v := RuntimeView{Configured: true, Version: p.Version, Revision: p.Revision, AgentImage: p.AgentImage, UpdatedAt: p.UpdatedAt, ModelRef: string(defaultModelReference(p))}
	v.Model = &struct {
		Provider            string  `json:"provider"`
		ID                  string  `json:"id"`
		BaseURL             *string `json:"baseUrl,omitempty"`
		CredentialAvailable bool    `json:"credentialAvailable"`
	}{p.Model.Provider, p.Model.ID, p.Model.BaseURL, credentialErr == nil}
	return v, nil
}
func (s *Settings) ConfigureRuntime(input RuntimeInput) (RuntimeView, error) {
	return s.ConfigureRuntimeAuthorized(input, nil)
}
func (s *Settings) ConfigureRuntimeAuthorized(input RuntimeInput, authorize func() error) (RuntimeView, error) {
	if api := modelAPI(input.Provider); api != "" && input.BaseURL != nil {
		endpoint, err := contracts.NormalizeProtocolModelEndpoint(api, input.BaseURL)
		if err != nil {
			return RuntimeView{}, contracts.NewError("INVALID_REQUEST", "baseUrl")
		}
		input.BaseURL = endpoint
	}
	if err := ValidateRuntime(input); err != nil {
		return RuntimeView{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	current, _, err := s.LoadRuntime()
	if err != nil {
		return RuntimeView{}, err
	}
	if current.Revision >= contracts.MaxSafeInteger {
		return RuntimeView{}, contracts.NewError("CONFLICT", "")
	}
	id, err := uuid.NewRandom()
	if err != nil {
		return RuntimeView{}, err
	}
	secretRef := "model-" + id.String() + ".secret"
	keepSecret := false
	defer func() {
		if !keepSecret {
			_ = s.files.RemoveSecret(secretRef)
		}
	}()
	if err := s.files.WriteSecret(secretRef, []byte(input.Credential+"\n")); err != nil {
		return RuntimeView{}, err
	}
	p := RuntimeProfile{Version: 1, Revision: current.Revision + 1, AgentImage: input.AgentImage, UpdatedAt: time.Now().UTC().Format(time.RFC3339Nano)}
	p.Model.Provider = input.Provider
	p.Model.ID = input.Model
	p.Model.BaseURL = input.BaseURL
	p.Model.CredentialRef = secretRef
	raw, _ := json.Marshal(p)
	if authorize != nil {
		if err := authorize(); err != nil {
			return RuntimeView{}, err
		}
	}
	// Publication can succeed even if the following directory fsync fails. Keep
	// the secret on any uncertain result; never delete a possibly live reference.
	keepSecret = true
	if err := s.files.Publish("runtime-profile.json", append(raw, '\n'), true); err != nil {
		return RuntimeView{}, err
	}
	return s.RuntimeView()
}
