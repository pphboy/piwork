package dockerengine

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/url"
	"reflect"
	"strconv"
	"strings"

	"github.com/distribution/reference"
	"github.com/moby/moby/api/types/registry"
)

type staticAuth struct {
	Auth          string `json:"auth"`
	Username      string `json:"username"`
	Password      string `json:"password"`
	IdentityToken string `json:"identitytoken"`
	RegistryToken string `json:"registrytoken"`
}

func parseAPIVersion(value string) (int, error) {
	parts := strings.Split(value, ".")
	if len(parts) != 2 {
		return 0, ErrAPIVersion
	}
	major, err := strconv.Atoi(parts[0])
	if err != nil || major < 1 || major > 100 {
		return 0, ErrAPIVersion
	}
	minor, err := strconv.Atoi(parts[1])
	if err != nil || minor < 0 || minor > 999 {
		return 0, ErrAPIVersion
	}
	if fmt.Sprintf("%d.%d", major, minor) != value {
		return 0, ErrAPIVersion
	}
	return major*1000 + minor, nil
}
func canonicalRegistry(value string) (string, error) {
	if strings.Contains(value, "://") {
		parsed, err := url.Parse(value)
		if err != nil || (parsed.Scheme != "https" && parsed.Scheme != "http") || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
			return "", ErrRegistryAuth
		}
		value = parsed.Host
	} else {
		value = strings.TrimSuffix(value, "/")
		if strings.Contains(value, "/") {
			return "", ErrRegistryAuth
		}
	}
	value = strings.ToLower(value)
	switch value {
	case "docker.io", "index.docker.io", "registry-1.docker.io":
		return "index.docker.io", nil
	}
	if value == "" || strings.ContainsAny(value, "\x00\r\n ") {
		return "", ErrRegistryAuth
	}
	return value, nil
}

// RegistryAuth is evaluated only when a pull is actually required. Unrelated
// credential-helper configuration cannot prevent use of a captured local ID.
func RegistryAuth(configDirectory, imageReference string) (string, error) {
	named, err := reference.ParseNormalizedNamed(imageReference)
	if err != nil {
		return "", ErrImageReference
	}
	target, err := canonicalRegistry(reference.Domain(named))
	if err != nil {
		return "", err
	}
	config, err := readDockerConfig(configDirectory)
	if err != nil {
		return "", err
	}
	var selected staticAuth
	matched := false
	for key, auth := range config.Auths {
		host, err := canonicalRegistry(key)
		if err != nil {
			continue
		}
		if host != target {
			continue
		}
		if matched && !reflect.DeepEqual(selected, auth) {
			return "", ErrRegistryAuth
		}
		selected = auth
		matched = true
	}
	if selected.Auth != "" {
		decoded, err := base64.StdEncoding.DecodeString(selected.Auth)
		if err != nil {
			return "", ErrRegistryAuth
		}
		username, password, ok := strings.Cut(string(decoded), ":")
		if !ok {
			return "", ErrRegistryAuth
		}
		if selected.Username != "" && selected.Username != username || selected.Password != "" && selected.Password != password {
			return "", ErrRegistryAuth
		}
		selected.Username = username
		selected.Password = password
	}
	if selected.Username != "" || selected.Password != "" || selected.IdentityToken != "" || selected.RegistryToken != "" {
		address := target
		if target == "index.docker.io" {
			address = "https://index.docker.io/v1/"
		}
		bytes, err := json.Marshal(registry.AuthConfig{Username: selected.Username, Password: selected.Password, IdentityToken: selected.IdentityToken, RegistryToken: selected.RegistryToken, ServerAddress: address})
		if err != nil {
			return "", ErrRegistryAuth
		}
		return base64.URLEncoding.EncodeToString(bytes), nil
	}
	for key, helper := range config.CredHelpers {
		host, err := canonicalRegistry(key)
		if err == nil && host == target && helper != "" {
			return "", ErrCredentialHelper
		}
	}
	if config.CredsStore != "" {
		return "", ErrCredentialHelper
	}
	return "", nil
}
