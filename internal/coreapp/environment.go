package coreapp

import (
	"fmt"
	"io"
	"os"
	"regexp"
	"strings"
	"unicode/utf8"

	"golang.org/x/sys/unix"
)

const jsWhitespace = "\u0009\u000b\u000c\u0020\u00a0\ufeff\n\r\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000"

var environmentLine = regexp.MustCompile(`^(?:export[` + jsWhitespace + `]+)?([A-Za-z_][A-Za-z0-9_]*)[` + jsWhitespace + `]*=[` + jsWhitespace + `]*([^\r\n\x{2028}\x{2029}]*)$`)

func trimJS(s string) string {
	return strings.TrimFunc(s, func(r rune) bool {
		return strings.ContainsRune(jsWhitespace, r)
	})
}

// ParseEnvironment implements the existing literal .env subset. It never
// expands variables, evaluates expressions, or installs values in os.Environ.
func ParseEnvironment(contents string) (map[string]string, error) {
	if !utf8.ValidString(contents) {
		return nil, fmt.Errorf("environment file is invalid UTF-8")
	}
	result := map[string]string{}
	for index, original := range strings.Split(contents, "\n") {
		line := trimJS(original)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		match := environmentLine.FindStringSubmatch(line)
		if match == nil {
			return nil, fmt.Errorf("invalid environment file syntax on line %d", index+1)
		}
		key, value := match[1], match[2]
		if _, exists := result[key]; exists {
			return nil, fmt.Errorf("duplicate environment key on line %d", index+1)
		}
		if strings.HasPrefix(value, "'") || strings.HasPrefix(value, "\"") {
			quote := value[0]
			if len(value) < 2 || value[len(value)-1] != quote {
				return nil, fmt.Errorf("unterminated environment quote on line %d", index+1)
			}
			value = value[1 : len(value)-1]
			if quote == '"' {
				var b strings.Builder
				for n := 0; n < len(value); n++ {
					if value[n] == '\\' && n+1 < len(value) {
						next := value[n+1]
						if replacement, ok := map[byte]byte{'n': '\n', 'r': '\r', 't': '\t', '\\': '\\', '"': '"'}[next]; ok {
							b.WriteByte(replacement)
							n++
							continue
						}
					}
					b.WriteByte(value[n])
				}
				value = b.String()
			}
		} else {
			var previous rune
			for n, character := range value {
				if character == '#' && n > 0 && strings.ContainsRune(jsWhitespace, previous) {
					value = value[:n]
					break
				}
				previous = character
			}
			value = trimJS(value)
			if strings.ContainsAny(value, "`$") {
				return nil, fmt.Errorf("unsupported environment expression on line %d", index+1)
			}
		}
		result[key] = value
	}
	return result, nil
}
func ReadEnvironmentFile(name string) (map[string]string, error) {
	fd, err := unix.Open(name, unix.O_RDONLY|unix.O_NOFOLLOW|unix.O_CLOEXEC|unix.O_NONBLOCK, 0)
	if err != nil {
		return nil, fmt.Errorf("environment file is unavailable")
	}
	f := os.NewFile(uintptr(fd), name)
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() > 1<<20 {
		return nil, fmt.Errorf("environment file is not a supported regular file")
	}
	data, err := io.ReadAll(io.LimitReader(f, (1<<20)+1))
	if err != nil || len(data) > 1<<20 {
		return nil, fmt.Errorf("environment file could not be read")
	}
	return ParseEnvironment(string(data))
}
func MergeEnvironment(file map[string]string, process []string, explicit map[string]string) map[string]string {
	values := map[string]string{}
	for k, v := range file {
		values[k] = v
	}
	for _, entry := range process {
		if key, value, ok := strings.Cut(entry, "="); ok {
			values[key] = value
		}
	}
	for k, v := range explicit {
		values[k] = v
	}
	return values
}
