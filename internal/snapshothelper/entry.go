package snapshothelper

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"regexp"

	"piwork/internal/cli"
	"piwork/internal/snapshottree"
	"piwork/internal/workpackage"
)

var logicalKey = regexp.MustCompile(`^[a-z][a-z0-9-]{0,63}$`)
var digestPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)

func Entry(ctx context.Context, args []string, sink, stderr io.Writer) int {
	if len(args) == 1 && (args[0] == "--version" || args[0] == "version") {
		return cli.Entry("piwork-snapshot-helper", args, sink, stderr)
	}
	if len(args) == 1 && (args[0] == "--help" || args[0] == "-h") {
		fmt.Fprintln(sink, "Usage: piwork-snapshot-helper capture | restore DIGEST | restore-context DIGEST CONTEXT | restore-package DIGEST CONTEXT PACKAGE | verify-history | restore-history | verify-package")
		return 0
	}
	code := run(ctx, args, sink)
	if code != "" {
		json.NewEncoder(stderr).Encode(map[string]string{"code": code})
		if code == "SNAPSHOT_HELPER_ARGUMENT" {
			return 2
		}
		return 1
	}
	return 0
}
func run(ctx context.Context, args []string, sink io.Writer) string {
	if len(args) == 0 {
		return "SNAPSHOT_HELPER_ARGUMENT"
	}
	action := args[0]
	if action == "verify-history" || action == "restore-history" || action == "verify-package" {
		if len(args) != 1 {
			return "SNAPSHOT_HELPER_ARGUMENT"
		}
		var result any
		var err error
		if action == "verify-package" {
			result, err = verifyUploadedPackage(ctx, "/snapshot/spool")
		} else {
			result, err = verifyVolumeHistory(ctx, "/snapshot/volume", "/snapshot/spool", action == "restore-history")
		}
		if err != nil {
			return historyCode(err)
		}
		if json.NewEncoder(sink).Encode(result) != nil {
			return "SNAPSHOT_STORAGE_UNREADABLE"
		}
		return ""
	}
	root := "/snapshot/volume"
	owned := false
	switch action {
	case "capture":
		if len(args) != 1 {
			return "SNAPSHOT_HELPER_ARGUMENT"
		}
	case "restore":
		if len(args) != 2 || !digestPattern.MatchString(args[1]) {
			return "SNAPSHOT_HELPER_ARGUMENT"
		}
	case "restore-context":
		if len(args) != 3 || !digestPattern.MatchString(args[1]) || !logicalKey.MatchString(args[2]) {
			return "SNAPSHOT_HELPER_ARGUMENT"
		}
		root = "/snapshot/spool/contexts/" + args[2]
		owned = true
	case "restore-package":
		if len(args) != 4 || !digestPattern.MatchString(args[1]) || !logicalKey.MatchString(args[2]) || !digestPattern.MatchString(args[3]) {
			return "SNAPSHOT_HELPER_ARGUMENT"
		}
		root = "/snapshot/spool/context-packages/" + args[2] + "/" + args[3]
		owned = true
	default:
		return "SNAPSHOT_HELPER_ARGUMENT"
	}
	blobs, err := workpackage.OpenBlobDirectory("/snapshot/spool")
	if err != nil {
		return "SNAPSHOT_STORAGE_UNREADABLE"
	}
	defer blobs.Close()
	var result snapshottree.Result
	if action == "capture" {
		result, err = snapshottree.Capture(ctx, root, blobs)
	} else {
		result, err = snapshottree.Restore(ctx, root, blobs, args[1], owned)
	}
	if err != nil {
		return snapshottree.Code(err)
	}
	if json.NewEncoder(sink).Encode(result) != nil {
		return "SNAPSHOT_STORAGE_UNREADABLE"
	}
	return ""
}
