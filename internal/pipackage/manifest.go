// Package pipackage implements static Pi package formats. It never evaluates
// package JavaScript, runs an installer, or obtains runtime credentials.
package pipackage

import (
	"encoding/json"
	"errors"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf16"

	semver "github.com/Masterminds/semver/v3"
)

const (
	CompressedBytes  int64 = 256 << 20
	RestoredBytes    int64 = 1 << 30
	PreparationBytes int64 = 4 << 30
	FileBytes        int64 = 64 << 20
	ManifestBytes    int64 = 1 << 20
	MaxEntries             = 100000
	MaxDepth               = 64
	MaxPathBytes           = 4096
)

type InputError struct{ Code string }

func (e *InputError) Error() string { return e.Code }
func (e *InputError) Is(other error) bool {
	target, ok := other.(*InputError)
	return ok && target.Code == e.Code
}

var (
	ErrSource   = &InputError{"PI_PACKAGE_INVALID_SOURCE"}
	ErrManifest = &InputError{"PI_PACKAGE_INVALID_MANIFEST"}
	ErrUnsafe   = &InputError{"PI_PACKAGE_UNSAFE_ARCHIVE"}
	ErrLimit    = &InputError{"PI_PACKAGE_LIMIT_EXCEEDED"}
	ErrSDK      = &InputError{"PI_PACKAGE_SDK_VERSION_UNSUPPORTED"}
)

var HostModules = []string{"@earendil-works/pi-ai", "@earendil-works/pi-agent-core", "@earendil-works/pi-coding-agent", "@earendil-works/pi-tui"}
var packageName = regexp.MustCompile(`^(?:@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*$`)
var kinds = []string{"extensions", "skills", "prompts", "themes"}

func jsLength(value string) int { return len(utf16.Encode([]rune(value))) }
func ValidName(value string) bool {
	return len(value) > 0 && jsLength(value) <= 214 && packageName.MatchString(value)
}

type Manifest struct {
	Name             string              `json:"name"`
	Version          *string             `json:"version"`
	Pi               map[string][]string `json:"pi"`
	Dependencies     map[string]string   `json:"dependencies"`
	PeerDependencies map[string]string   `json:"peerDependencies"`
}

func ParseManifest(raw []byte) (Manifest, error) {
	if int64(len(raw)) > ManifestBytes {
		return Manifest{}, ErrLimit
	}
	// Manifests preserve JSON.parse's last-key behavior and original bytes;
	// strict duplicate-key validation belongs to platform request protocols.
	var object map[string]json.RawMessage
	if json.Unmarshal(raw, &object) != nil || object == nil {
		return Manifest{}, ErrManifest
	}
	var result Manifest
	if json.Unmarshal(object["name"], &result.Name) != nil || !ValidName(result.Name) {
		return Manifest{}, ErrManifest
	}
	if value, ok := object["version"]; ok {
		var version string
		if json.Unmarshal(value, &version) != nil || string(value) == "null" || version == "" || jsLength(version) > 256 {
			return Manifest{}, ErrManifest
		}
		result.Version = &version
	}
	result.Dependencies = make(map[string]string)
	result.PeerDependencies = make(map[string]string)
	if value, ok := object["pi"]; ok {
		var declarations map[string]json.RawMessage
		if json.Unmarshal(value, &declarations) != nil || declarations == nil {
			return Manifest{}, ErrManifest
		}
		result.Pi = make(map[string][]string)
		for _, kind := range kinds {
			if value, ok := declarations[kind]; ok {
				var entries []string
				if json.Unmarshal(value, &entries) != nil || entries == nil {
					return Manifest{}, ErrManifest
				}
				for _, entry := range entries {
					if entry == "" || jsLength(entry) > 4096 || strings.HasPrefix(entry, "/") || strings.ContainsAny(entry, "\\\x00") {
						return Manifest{}, ErrManifest
					}
					for _, part := range strings.Split(entry, "/") {
						if part == ".." {
							return Manifest{}, ErrManifest
						}
					}
				}
				result.Pi[kind] = entries
			}
		}
	}
	for _, field := range []string{"dependencies", "peerDependencies"} {
		value, ok := object[field]
		if !ok || field == "dependencies" && string(value) == "null" {
			continue
		}
		var entries map[string]json.RawMessage
		if json.Unmarshal(value, &entries) != nil || entries == nil {
			return Manifest{}, ErrManifest
		}
		for name, value := range entries {
			var version string
			if !ValidName(name) || json.Unmarshal(value, &version) != nil || string(value) == "null" || version == "" {
				return Manifest{}, ErrManifest
			}
			if field == "dependencies" {
				result.Dependencies[name] = version
				continue
			}
			if strings.TrimSpace(version) == "" {
				return Manifest{}, ErrManifest
			}
			if IsHostModule(name) {
				if _, err := parsePeerRange(version); err != nil {
					return Manifest{}, ErrManifest
				}
			}
			result.PeerDependencies[name] = version
		}
	}
	return result, nil
}

func IsHostModule(name string) bool {
	for _, host := range HostModules {
		if name == host {
			return true
		}
	}
	return false
}

type peerRange []*semver.Constraints

var prereleaseVersion = regexp.MustCompile(`(?:^|[\s<>=~^])v?([0-9]+\.[0-9]+\.[0-9]+)-[0-9A-Za-z.-]+`)
var rangeVersion = regexp.MustCompile(`v?([0-9]+|[xX*])(?:\.([0-9]+|[xX*]))?(?:\.([0-9]+|[xX*]))?(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?`)
var firstWildcard = regexp.MustCompile(`(^|\s)([<>=~^]*\s*)[v]?[xX*](?:\.[xX*0-9]+){0,2}($|\s)`)

func parsePeerRange(value string) (peerRange, error) {
	// npm does not accept the Go library's comma/!= extensions.
	if strings.ContainsAny(value, ",!") {
		return nil, ErrManifest
	}
	for _, match := range rangeVersion.FindAllStringSubmatch(value, -1) {
		for _, part := range match[1:4] {
			if part == "" || strings.ContainsAny(part, "xX*") {
				continue
			}
			number, err := strconv.ParseUint(part, 10, 64)
			if err != nil || number > 9007199254740991 || len(part) > 1 && part[0] == '0' {
				return nil, ErrManifest
			}
		}
	}
	var result peerRange
	for _, branch := range strings.Split(value, "||") {
		branch = strings.TrimSpace(branch)
		if branch == "" {
			branch = "*"
		}
		branch = firstWildcard.ReplaceAllStringFunc(branch, func(token string) string {
			parts := firstWildcard.FindStringSubmatch(token)
			operator := strings.TrimSpace(parts[2])
			replacement := "*"
			if operator == "<" || operator == ">" {
				replacement = "<0.0.0-0"
			}
			return parts[1] + replacement + parts[3]
		})
		constraint, err := semver.NewConstraint(branch)
		if err != nil {
			return nil, ErrManifest
		}
		result = append(result, constraint)
	}
	return result, nil
}

func validHostVersion(value string) (*semver.Version, error) {
	if len(value) > 256 {
		return nil, ErrSDK
	}
	version, err := semver.StrictNewVersion(strings.TrimPrefix(strings.TrimSpace(value), "v"))
	if err != nil || version.Major() > 9007199254740991 || version.Minor() > 9007199254740991 || version.Patch() > 9007199254740991 {
		return nil, ErrSDK
	}
	return version, nil
}

func CheckHostPeers(manifest Manifest, versions map[string]string) error {
	for _, name := range HostModules {
		version, err := validHostVersion(versions[name])
		if err != nil {
			return ErrSDK
		}
		rangeValue, ok := manifest.PeerDependencies[name]
		if !ok {
			continue
		}
		constraints, err := parsePeerRange(rangeValue)
		if err != nil {
			return ErrSDK
		}
		matched := false
		branches := strings.Split(rangeValue, "||")
		for i, constraint := range constraints {
			if !constraint.Check(version) {
				continue
			}
			if version.Prerelease() != "" {
				allowed := false
				for _, match := range prereleaseVersion.FindAllStringSubmatch(branches[i], -1) {
					base, err := semver.StrictNewVersion(match[1])
					if err == nil && base.Major() == version.Major() && base.Minor() == version.Minor() && base.Patch() == version.Patch() {
						allowed = true
					}
				}
				if !allowed {
					continue
				}
			}
			matched = true
			break
		}
		if !matched {
			return ErrSDK
		}
	}
	return nil
}

func ErrorCode(err error) any {
	var input *InputError
	if errors.As(err, &input) {
		return input.Code
	}
	return nil
}
