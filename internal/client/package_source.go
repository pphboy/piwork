package client

import (
	"runtime"
	"strings"
	"unicode/utf8"

	"piwork/internal/clientfs"
	"piwork/internal/pipackage"
)

// ParsePackageSource is shared by command validation and upload preparation.
// Remote sources retain the server grammar; host paths stay client-side.
func ParsePackageSource(argument string) (pipackage.Source, error) {
	return parsePackageSource(argument, runtime.GOOS == "windows")
}

func parsePackageSource(argument string, windowsHost bool) (pipackage.Source, error) {
	if !windowsHost || strings.HasPrefix(argument, "npm:") || strings.HasPrefix(argument, "git:") {
		return pipackage.ParseSource(argument)
	}
	if argument == "" || strings.TrimSpace(argument) != argument || !utf8.ValidString(argument) {
		return pipackage.Source{}, pipackage.ErrSource
	}
	for _, c := range argument {
		if c < 32 || c == 127 {
			return pipackage.Source{}, pipackage.ErrSource
		}
	}
	path := strings.ReplaceAll(argument, "/", `\`)
	if strings.HasPrefix(path, `\\?\`) || strings.HasPrefix(path, `\\.\`) || strings.HasPrefix(path, `\??\`) {
		return pipackage.Source{}, pipackage.ErrSource
	}
	local := strings.HasPrefix(path, `.\`) || strings.HasPrefix(path, `..\`)
	if len(path) >= 2 && path[1] == ':' {
		if !(path[0] >= 'a' && path[0] <= 'z' || path[0] >= 'A' && path[0] <= 'Z') || len(path) < 3 || path[2] != '\\' {
			return pipackage.Source{}, pipackage.ErrSource
		}
		path = path[3:]
		local = true
	} else if strings.HasPrefix(path, `\\`) {
		parts := strings.Split(strings.TrimPrefix(path, `\\`), `\`)
		if len(parts) < 3 || parts[0] == "" || parts[1] == "" || parts[0] == "." || parts[1] == "." || parts[0] == ".." || parts[1] == ".." {
			return pipackage.Source{}, pipackage.ErrSource
		}
		local = true
		path = strings.Join(parts, `\`)
	} else if strings.HasPrefix(argument, "/") && !strings.HasPrefix(argument, "//") {
		// Preserve the original explicit slash-root source grammar.
		local = true
		path = strings.TrimPrefix(path, `\`)
	}
	if !local {
		return pipackage.Source{}, pipackage.ErrSource
	}
	parts := strings.Split(strings.TrimRight(path, `\`), `\`)
	for _, part := range parts {
		if part == "." || part == ".." {
			continue
		}
		if !clientfs.ValidFileName(part) || strings.ContainsAny(part, ":*?\"<>|") || strings.HasSuffix(part, ".") || strings.HasSuffix(part, " ") {
			return pipackage.Source{}, pipackage.ErrSource
		}
	}
	name := parts[len(parts)-1]
	if name == "" || name == "." || name == ".." {
		return pipackage.Source{}, pipackage.ErrSource
	}
	kind := "local"
	if strings.HasSuffix(strings.ToLower(argument), ".zip") {
		kind = "zip"
	}
	return pipackage.Source{Kind: kind, Path: argument, DisplayName: name}, nil
}
