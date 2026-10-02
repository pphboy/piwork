package client

import "regexp"

var safeMessagePatterns = []struct {
	expression  *regexp.Regexp
	replacement string
}{
	{regexp.MustCompile(`(?i)\b(Bearer|Operator)\s+[A-Za-z0-9._~+/-]+`), "$1 [REDACTED]"},
	{regexp.MustCompile(`(?i)\b(password|passphrase|api[-_ ]?key|token|credential|secret)\s*([=:])\s*([^\s,;]+)`), "$1$2[REDACTED]"},
	{regexp.MustCompile(`(?i)([?&](?:password|api[-_]?key|token|credential|secret)=)[^&#\s]*`), "${1}[REDACTED]"},
	{regexp.MustCompile(`(?:/[^\s/:]+)*/(?:secrets?/[^\s:]+|[^\s/:]*\.secret|operator\.credential)\b`), "[REDACTED_PATH]"},
}

// SafeErrorMessage preserves the former user-client diagnostic redaction rules.
func SafeErrorMessage(message string) string {
	for _, pattern := range safeMessagePatterns {
		message = pattern.expression.ReplaceAllString(message, pattern.replacement)
	}
	return message
}
