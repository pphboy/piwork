package pipackage

import (
	"sort"
	"strings"

	"piwork/internal/contracts"
)

type Inventory struct {
	Extensions []string `json:"extensions"`
	Skills     []string `json:"skills"`
	Prompts    []string `json:"prompts"`
	Themes     []string `json:"themes"`
}

func InspectResources(manifest Manifest, entries []contracts.DigestEntry) (Inventory, error) {
	var available []string
	var directories []string
	types := make(map[string]string)
	for _, entry := range entries {
		types[entry.Path] = entry.Type
		if entry.Type == "directory" {
			directories = append(directories, entry.Path)
		} else {
			available = append(available, entry.Path)
		}
	}
	sort.Strings(available)
	results := map[string][]string{"extensions": {}, "skills": {}, "prompts": {}, "themes": {}}
	if manifest.Pi == nil {
		for _, name := range available {
			if strings.HasPrefix(name, "extensions/") && (strings.HasSuffix(name, ".ts") || strings.HasSuffix(name, ".js")) {
				results["extensions"] = append(results["extensions"], name)
			}
			if strings.HasPrefix(name, "skills/") && (strings.HasSuffix(name, "/SKILL.md") || len(strings.Split(name, "/")) == 2 && strings.HasSuffix(name, ".md")) {
				results["skills"] = append(results["skills"], name)
			}
			if strings.HasPrefix(name, "prompts/") && strings.HasSuffix(name, ".md") {
				results["prompts"] = append(results["prompts"], name)
			}
			if strings.HasPrefix(name, "themes/") && strings.HasSuffix(name, ".json") {
				results["themes"] = append(results["themes"], name)
			}
		}
	} else {
		for _, kind := range kinds {
			included := make(map[string]bool)
			for _, raw := range manifest.Pi[kind] {
				excluded := strings.HasPrefix(raw, "!")
				pattern := raw
				if excluded {
					pattern = strings.TrimPrefix(pattern, "!")
				}
				pattern = strings.TrimSuffix(strings.TrimPrefix(pattern, "./"), "/")
				if pattern == "" || strings.HasPrefix(pattern, "/") || strings.Contains(pattern, "\\") {
					return Inventory{}, ErrManifest
				}
				for _, part := range strings.Split(pattern, "/") {
					if part == ".." || part == "" {
						return Inventory{}, ErrManifest
					}
				}
				matcher := compileGlob(pattern)
				var matchingDirs []string
				if kind == "skills" {
					for _, directory := range directories {
						if matcher.match(directory) {
							matchingDirs = append(matchingDirs, directory)
						}
					}
				}
				var matches []string
				for _, name := range available {
					match := name == pattern || strings.HasPrefix(name, pattern+"/") || matcher.match(name)
					if !match {
						for _, directory := range matchingDirs {
							if strings.HasPrefix(name, directory+"/") {
								match = true
								break
							}
						}
					}
					if match {
						matches = append(matches, name)
					}
				}
				if kind == "skills" && !excluded && !(types[pattern] != "" && types[pattern] != "directory") {
					matches = skillEntrypoints(pattern, matches)
				}
				if !excluded && len(matches) == 0 {
					return Inventory{}, ErrManifest
				}
				for _, name := range matches {
					if excluded {
						delete(included, name)
					} else {
						included[name] = true
					}
				}
			}
			for name := range included {
				results[kind] = append(results[kind], name)
			}
			sort.Strings(results[kind])
		}
	}
	return Inventory{results["extensions"], results["skills"], results["prompts"], results["themes"]}, nil
}
func skillEntrypoints(pattern string, matches []string) []string {
	wildcard := strings.IndexAny(pattern, "?*[]{}")
	prefix := pattern
	if wildcard >= 0 {
		prefix = pattern[:wildcard]
	}
	root := prefix
	if wildcard >= 0 {
		index := strings.LastIndex(prefix, "/")
		root = ""
		if index >= 0 {
			root = strings.TrimSuffix(prefix[:index+1], "/")
		}
	}
	rootSkill := "SKILL.md"
	if root != "" {
		rootSkill = root + "/SKILL.md"
	}
	for _, name := range matches {
		if name == rootSkill {
			return []string{rootSkill}
		}
	}
	result := []string{}
	for _, name := range matches {
		relative := name
		if root != "" {
			relative = strings.TrimPrefix(name, root+"/")
		}
		if strings.HasSuffix(name, "/SKILL.md") || !strings.Contains(relative, "/") && strings.HasSuffix(relative, ".md") {
			result = append(result, name)
		}
	}
	return result
}
