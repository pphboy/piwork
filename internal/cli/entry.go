// Package cli contains native command entry points and shared argument handling.
package cli

import (
	"encoding/json"
	"fmt"
	"io"

	"piwork/internal/buildinfo"
)

// Entry is the minimal native entry point used while each command is migrated.
// It never delegates an unsupported command to the previous platform.
func Entry(program string, args []string, stdout, stderr io.Writer) int {
	if program == "piwork-cli" {
		return runUser(args, stdout, stderr)
	}
	if program == "piwork-console" {
		return runConsole(args, stdout, stderr)
	}
	if len(args) == 1 && (args[0] == "--version" || args[0] == "version") {
		if err := json.NewEncoder(stdout).Encode(buildinfo.Read(program)); err != nil {
			fmt.Fprintln(stderr, "Unable to write version information.")
			return 1
		}
		return 0
	}
	if len(args) == 1 && (args[0] == "--help" || args[0] == "-h") {
		fmt.Fprintf(stdout, "Usage: %s --version\n", program)
		return 0
	}
	// Business command implementations are added by the corresponding tasks.
	// Failing closed prevents a foundation build from masquerading as ready.
	fmt.Fprintf(stderr, "%s: native business commands are not available in this migration stage.\n", program)
	return 2
}
