package workpackage

import (
	"strings"
	"unicode"
)

// ExportFilename preserves the Work name while making it safe as a single
// filename on both Linux and Windows. The package extension is always appended.
func ExportFilename(name string) string {
	name = strings.Map(func(char rune) rune {
		if unicode.IsControl(char) || strings.ContainsRune(`<>:"/\|?*`, char) {
			return '_'
		}
		return char
	}, name)
	name = strings.TrimRight(name, ". ")
	if name == "" {
		name = "work"
	}
	stem, _, _ := strings.Cut(name, ".")
	stem = strings.ToUpper(stem)
	switch stem {
	case "CON", "PRN", "AUX", "NUL":
		name = "_" + name
	default:
		if len(stem) == 4 && (strings.HasPrefix(stem, "COM") || strings.HasPrefix(stem, "LPT")) && stem[3] >= '1' && stem[3] <= '9' {
			name = "_" + name
		}
	}
	return name + ".work"
}
