package pipackage

import (
	"regexp"
	"strconv"
	"strings"
)

// A bounded pattern AST handles Node's resource glob forms without expanding
// brace products or invoking a runtime. Path and pattern inputs are already
// bounded by the package contract. Matching uses memoized sequence positions.
type globNode struct {
	kind                   rune
	literal                rune
	class                  *regexp.Regexp
	alternatives           [][]globNode
	minimum, maximum, step int64
	width                  int
	explicitDot            bool
}
type glob struct{ nodes []globNode }

func compileGlob(pattern string) glob { return glob{parseGlob([]rune(pattern))} }

func closing(input []rune, start int, left, right rune) int {
	depth := 0
	for i := start; i < len(input); i++ {
		if input[i] == left {
			depth++
		}
		if input[i] == right {
			depth--
			if depth == 0 {
				return i
			}
		}
	}
	return -1
}
func splitGlob(input []rune, separator rune) [][]rune {
	var result [][]rune
	start, braces, groups, classes := 0, 0, 0, 0
	for i, c := range input {
		switch c {
		case '{':
			braces++
		case '}':
			braces--
		case '(':
			groups++
		case ')':
			groups--
		case '[':
			classes++
		case ']':
			classes--
		}
		if c == separator && braces == 0 && groups == 0 && classes == 0 {
			result = append(result, input[start:i])
			start = i + 1
		}
	}
	return append(result, input[start:])
}
func parseGlob(input []rune) []globNode {
	var result []globNode
	for i := 0; i < len(input); i++ {
		c := input[i]
		if strings.ContainsRune("@+?*!", c) && i+1 < len(input) && input[i+1] == '(' {
			if end := closing(input, i+1, '(', ')'); end >= 0 {
				node := globNode{kind: c}
				for _, part := range splitGlob(input[i+2:end], '|') {
					node.alternatives = append(node.alternatives, parseGlob(part))
				}
				result = append(result, node)
				i = end
				continue
			}
		}
		if c == '{' {
			if end := closing(input, i, '{', '}'); end >= 0 {
				parts := splitGlob(input[i+1:end], ',')
				if len(parts) > 1 {
					node := globNode{kind: '@'}
					for _, part := range parts {
						node.alternatives = append(node.alternatives, parseGlob(part))
					}
					result = append(result, node)
					i = end
					continue
				}
				rangeParts := strings.Split(string(input[i+1:end]), "..")
				if len(rangeParts) == 2 || len(rangeParts) == 3 {
					first, e1 := strconv.ParseInt(rangeParts[0], 10, 64)
					last, e2 := strconv.ParseInt(rangeParts[1], 10, 64)
					if e1 == nil && e2 == nil {
						step := int64(1)
						if len(rangeParts) == 3 {
							step, _ = strconv.ParseInt(rangeParts[2], 10, 64)
							if step < 0 {
								step = -step
							}
							if step == 0 {
								step = 1
							}
						}
						width := 0
						if len(rangeParts[0]) > 1 && rangeParts[0][0] == '0' || len(rangeParts[1]) > 1 && rangeParts[1][0] == '0' {
							width = len(rangeParts[0])
							if len(rangeParts[1]) > width {
								width = len(rangeParts[1])
							}
						}
						result = append(result, globNode{kind: 'n', minimum: first, maximum: last, step: step, width: width})
						i = end
						continue
					}
					if len([]rune(rangeParts[0])) == 1 && len([]rune(rangeParts[1])) == 1 {
						step := int64(1)
						if len(rangeParts) == 3 {
							parsed, err := strconv.ParseInt(rangeParts[2], 10, 64)
							if err == nil && parsed != 0 {
								step = parsed
								if step < 0 {
									step = -step
								}
							}
						}
						result = append(result, globNode{kind: 'r', minimum: int64([]rune(rangeParts[0])[0]), maximum: int64([]rune(rangeParts[1])[0]), step: step})
						i = end
						continue
					}
				}
			}
		}
		if c == '[' {
			if end := closing(input, i, '[', ']'); end > i+1 {
				text := string(input[i : end+1])
				if strings.HasPrefix(text, "[!") {
					text = "[^" + text[2:]
				}
				class, err := regexp.Compile("^(?:" + text + ")$")
				if err == nil {
					result = append(result, globNode{kind: 'c', class: class, explicitDot: !strings.HasPrefix(text, "[^") && strings.Contains(text, ".")})
					i = end
					continue
				}
			}
		}
		if c == '*' {
			end := i
			for end+1 < len(input) && input[end+1] == '*' {
				end++
			}
			kind := rune('*')
			if end > i && (i == 0 || input[i-1] == '/') && (end+1 == len(input) || input[end+1] == '/') {
				kind = 'G'
				if end+1 < len(input) && input[end+1] == '/' {
					kind = 'D'
					end++
				}
			}
			result = append(result, globNode{kind: kind})
			i = end
			continue
		}
		if c == '?' {
			result = append(result, globNode{kind: '?'})
		} else {
			result = append(result, globNode{kind: 'l', literal: c})
		}
	}
	return result
}

func (g glob) match(value string) bool {
	input := []rune(value)
	matches := globPositions(g.nodes, input, 0)
	for _, position := range matches {
		if position == len(input) {
			return true
		}
	}
	return false
}

func globPositions(nodes []globNode, input []rune, start int) []int {
	type state struct{ index, position int }
	memo := make(map[state][]int)
	var walk func(int, int) []int
	walk = func(index, position int) []int {
		key := state{index, position}
		if result, ok := memo[key]; ok {
			return result
		}
		if index == len(nodes) {
			return []int{position}
		}
		node := nodes[index]
		var ends []int
		dot := position < len(input) && input[position] == '.' && (position == 0 || input[position-1] == '/')
		switch {
		case node.kind == 'l':
			if position < len(input) && input[position] == node.literal {
				ends = append(ends, position+1)
			}
		case node.kind == 'c':
			if position < len(input) && input[position] != '/' && (!dot || node.explicitDot) && node.class.MatchString(string(input[position])) {
				ends = append(ends, position+1)
			}
		case node.kind == 'r':
			if position < len(input) {
				v := int64(input[position])
				lo, hi := node.minimum, node.maximum
				if lo > hi {
					lo, hi = hi, lo
				}
				if v >= lo && v <= hi && (v-node.minimum)%node.step == 0 {
					ends = append(ends, position+1)
				}
			}
		case node.kind == 'n':
			for end := position + 1; end <= len(input) && end-position <= 20; end++ {
				value, err := strconv.ParseInt(string(input[position:end]), 10, 64)
				if err != nil {
					continue
				}
				lo, hi := node.minimum, node.maximum
				if lo > hi {
					lo, hi = hi, lo
				}
				if value < lo || value > hi || (value-node.minimum)%node.step != 0 {
					continue
				}
				if node.width > 0 && end-position != node.width {
					continue
				}
				if node.width == 0 && end-position > 1 && input[position] == '0' {
					continue
				}
				ends = append(ends, end)
			}
		case len(node.alternatives) > 0:
			if node.kind == '!' {
				for end := position; end <= len(input); end++ {
					if end > position && input[end-1] == '/' {
						break
					}
					excluded := false
					for _, alt := range node.alternatives {
						suffix := append(append([]globNode{}, alt...), nodes[index+1:]...)
						for _, match := range globPositions(suffix, input, position) {
							if match == len(input) {
								excluded = true
							}
						}
					}
					if !excluded && !dot {
						ends = append(ends, end)
					}
				}
			} else {
				for _, alt := range node.alternatives {
					ends = append(ends, globPositions(alt, input, position)...)
				}
				if node.kind == '?' || node.kind == '*' {
					ends = append(ends, position)
				}
				if node.kind == '+' || node.kind == '*' {
					seen := make(map[int]bool)
					for cursor := 0; cursor < len(ends); cursor++ {
						end := ends[cursor]
						if seen[end] {
							continue
						}
						seen[end] = true
						for _, alt := range node.alternatives {
							for _, next := range globPositions(alt, input, end) {
								if next > end && !seen[next] {
									ends = append(ends, next)
								}
							}
						}
					}
				}
			}
		case node.kind == '?':
			if position < len(input) && input[position] != '/' && !dot {
				ends = append(ends, position+1)
			}
		case node.kind == '*':
			ends = append(ends, position)
			if !dot {
				for end := position; end < len(input) && input[end] != '/'; end++ {
					ends = append(ends, end+1)
				}
			}
		case node.kind == 'G' || node.kind == 'D':
			ends = append(ends, position)
			for end := position; end < len(input); end++ {
				if input[end] == '.' && (end == 0 || input[end-1] == '/') {
					break
				}
				if node.kind == 'G' || input[end] == '/' {
					ends = append(ends, end+1)
				}
			}
		}
		seen := make(map[int]bool)
		var result []int
		for _, end := range ends {
			for _, next := range walk(index+1, end) {
				if !seen[next] {
					seen[next] = true
					result = append(result, next)
				}
			}
		}
		memo[key] = result
		return result
	}
	return walk(0, start)
}
