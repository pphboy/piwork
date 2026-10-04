package contracts

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"math"
	"reflect"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

//go:embed schemas.json
var schemaBytes []byte

type definition struct {
	Type                 string                 `json:"type"`
	Const                json.RawMessage        `json:"const"`
	AnyOf                []*definition          `json:"anyOf"`
	Not                  *definition            `json:"not"`
	Properties           map[string]*definition `json:"properties"`
	Required             []string               `json:"required"`
	AdditionalProperties json.RawMessage        `json:"additionalProperties"`
	PatternProperties    map[string]*definition `json:"patternProperties"`
	Items                json.RawMessage        `json:"items"`
	AdditionalItems      json.RawMessage        `json:"additionalItems"`
	MinLength            *int                   `json:"minLength"`
	MaxLength            *int                   `json:"maxLength"`
	MinItems             *int                   `json:"minItems"`
	MaxItems             *int                   `json:"maxItems"`
	UniqueItems          bool                   `json:"uniqueItems"`
	MinProperties        *int                   `json:"minProperties"`
	MaxProperties        *int                   `json:"maxProperties"`
	Minimum              *float64               `json:"minimum"`
	Maximum              *float64               `json:"maximum"`
	Pattern              string                 `json:"pattern"`
	Format               string                 `json:"format"`
}

var catalog = sync.OnceValue(func() map[string]*definition {
	var result map[string]*definition
	if err := json.Unmarshal(schemaBytes, &result); err != nil {
		panic("invalid compiled contract catalog")
	}
	return result
})
var regexps sync.Map

// ValidationError holds only a safe field identifier, never a rejected value.
type ValidationError struct{ Field string }

func (e *ValidationError) Error() string { return "request fields are invalid" }
func invalid(field string) error         { return &ValidationError{Field: field} }

func SchemaNames() []string {
	result := make([]string, 0, len(catalog()))
	for name := range catalog() {
		result = append(result, name)
	}
	sort.Strings(result)
	return result
}
func Validate(schema string, value any) error {
	s, exists := catalog()[schema]
	if !exists {
		return fmt.Errorf("unknown contract schema")
	}
	// Normalize typed DTOs to the same JSON data model used by ParseJSON.
	if !wireValue(value) {
		raw, err := json.Marshal(value)
		if err != nil {
			return invalid("")
		}
		value, err = ParseJSON(strings.NewReader(string(raw)), int64(len(raw)+1))
		if err != nil {
			return err
		}
	}
	if err := check(s, value, "", 0); err != nil {
		return err
	}
	switch schema {
	case "BrainVerificationTargetSchema":
		return validateBrainTarget(value)
	case "BrainCandidateSubmissionSchema":
		return validateBrainTarget(value.(map[string]any)["verificationTarget"])
	}
	return nil
}
func wireValue(v any) bool {
	switch v.(type) {
	case nil, string, bool, int64, float64, []any, map[string]any:
		return true
	}
	return false
}
func numeric(v any) (float64, bool) {
	switch n := v.(type) {
	case int64:
		return float64(n), true
	case float64:
		return n, true
	}
	return 0, false
}
func same(a, b any) bool {
	an, aok := numeric(a)
	bn, bok := numeric(b)
	if aok && bok {
		return an == bn
	}
	return reflect.DeepEqual(a, b)
}
func bounds(n int, min, max *int) bool { return (min == nil || n >= *min) && (max == nil || n <= *max) }
func child(field, name string) string {
	// Unknown client-selected keys do not become error fields.
	if field == "" {
		return name
	}
	return field + "." + name
}
func check(s *definition, v any, field string, depth int) error {
	if depth > MaxJSONDepth {
		return invalid(field)
	}
	if s.Const != nil {
		c, err := ParseJSON(strings.NewReader(string(s.Const)), int64(len(s.Const)+1))
		if err != nil || !same(c, v) {
			return invalid(field)
		}
	}
	if len(s.AnyOf) > 0 {
		matched := false
		for _, alternative := range s.AnyOf {
			if check(alternative, v, field, depth+1) == nil {
				matched = true
				break
			}
		}
		if !matched {
			return invalid(field)
		}
	}
	if s.Not != nil && check(s.Not, v, field, depth+1) == nil {
		return invalid(field)
	}
	switch s.Type {
	case "null":
		if v != nil {
			return invalid(field)
		}
	case "boolean":
		if _, ok := v.(bool); !ok {
			return invalid(field)
		}
	case "string":
		t, ok := v.(string)
		if !ok || !utf8.ValidString(t) || !bounds(utf8.RuneCountInString(t), s.MinLength, s.MaxLength) || !matches(s.Pattern, t) {
			return invalid(field)
		}
		if s.Format == "date-time" {
			if _, err := time.Parse(time.RFC3339Nano, t); err != nil {
				return invalid(field)
			}
		}
	case "integer", "number":
		n, ok := numeric(v)
		if !ok || math.IsInf(n, 0) || math.IsNaN(n) || (s.Type == "integer" && math.Trunc(n) != n) ||
			(math.Trunc(n) == n && math.Abs(n) > float64(MaxSafeInteger)) ||
			(s.Minimum != nil && n < *s.Minimum) || (s.Maximum != nil && n > *s.Maximum) {
			return invalid(field)
		}
	case "array":
		a, ok := v.([]any)
		if !ok || !bounds(len(a), s.MinItems, s.MaxItems) {
			return invalid(field)
		}
		var tuple []*definition
		var item *definition
		if len(s.Items) > 0 {
			if s.Items[0] == '[' {
				if json.Unmarshal(s.Items, &tuple) != nil {
					return invalid(field)
				}
			} else if json.Unmarshal(s.Items, &item) != nil {
				return invalid(field)
			}
		}
		seen := make(map[string]bool)
		for i, value := range a {
			selected := item
			if tuple != nil {
				if i < len(tuple) {
					selected = tuple[i]
				} else if string(s.AdditionalItems) == "false" {
					return invalid(field)
				}
			}
			if selected != nil {
				if err := check(selected, value, field, depth+1); err != nil {
					return err
				}
			}
			if s.UniqueItems {
				encoded, err := json.Marshal(value)
				if err != nil {
					return invalid(field)
				}
				key := string(encoded)
				if seen[key] {
					return invalid(field)
				}
				seen[key] = true
			}
		}
	case "object":
		o, ok := v.(map[string]any)
		if !ok || !bounds(len(o), s.MinProperties, s.MaxProperties) {
			return invalid(field)
		}
		for _, key := range s.Required {
			if _, present := o[key]; !present {
				return invalid(child(field, key))
			}
		}
		for key, value := range o {
			known := false
			if property := s.Properties[key]; property != nil {
				known = true
				if err := check(property, value, child(field, key), depth+1); err != nil {
					return err
				}
			}
			for pattern, property := range s.PatternProperties {
				if matches(pattern, key) {
					known = true
					if err := check(property, value, field, depth+1); err != nil {
						return err
					}
				}
			}
			if !known && string(s.AdditionalProperties) == "false" {
				return invalid(field)
			}
			if !known && len(s.AdditionalProperties) > 0 && s.AdditionalProperties[0] == '{' {
				var additional definition
				if json.Unmarshal(s.AdditionalProperties, &additional) != nil {
					return invalid(field)
				}
				if err := check(&additional, value, field, depth+1); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

// Implement the fixed catalog's JS lookahead patterns by their exact intent;
// explicitly; other catalog patterns compile with RE2. No client regex is run.
func matches(pattern, text string) bool {
	if pattern == "" {
		return true
	}
	if pattern == "^package:piwork-brain:(?!brain_feedback$|brain_package_update$)[a-zA-Z][a-zA-Z0-9_-]{0,63}$" {
		name, found := strings.CutPrefix(text, "package:piwork-brain:")
		return found && name != "brain_feedback" && name != "brain_package_update" && matches("^[a-zA-Z][a-zA-Z0-9_-]{0,63}$", name)
	}
	if pattern == "^(?!package:)[a-zA-Z0-9][a-zA-Z0-9._:-]*$" {
		return !strings.HasPrefix(text, "package:") && matches("^[a-zA-Z0-9][a-zA-Z0-9._:-]*$", text)
	}
	if pattern == "^(?=.*\\S)[^\\u0000]+$" {
		if strings.ContainsRune(text, 0) || text == "" {
			return false
		}
		// JS dot stops at a line terminator; the lookahead must find a
		// non-whitespace character on the first line.
		for _, r := range text {
			if r == '\n' || r == '\r' || r == '\u2028' || r == '\u2029' {
				return false
			}
			if !jsWhitespace(r) {
				return true
			}
		}
		return false
	}
	compiled, exists := regexps.Load(pattern)
	if !exists {
		r, err := regexp.Compile(pattern)
		if err != nil {
			panic("unsupported compiled contract pattern")
		}
		compiled, _ = regexps.LoadOrStore(pattern, r)
	}
	return compiled.(*regexp.Regexp).MatchString(text)
}
func jsWhitespace(r rune) bool {
	return r == '\t' || r == '\n' || r == '\v' || r == '\f' || r == '\r' || r == ' ' || r == '\u00a0' || r == '\u1680' ||
		(r >= '\u2000' && r <= '\u200a') || r == '\u2028' || r == '\u2029' || r == '\u202f' || r == '\u205f' || r == '\u3000' || r == '\ufeff'
}
