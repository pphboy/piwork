package snapshothelper

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"regexp"
	"syscall"

	"piwork/internal/cli"
	"piwork/internal/snapshottree"
	"piwork/internal/workhistory"
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
	if action == "checkpoint-history" || action == "restore-history-backup" {
		if len(args) != 1 {
			return "SNAPSHOT_HELPER_ARGUMENT"
		}
		request, err := readBackupRequest("/snapshot/spool")
		if err != nil {
			return historyCode(err)
		}
		var result workhistory.BackupResult
		if action == "checkpoint-history" {
			result, err = workhistory.CheckpointHistory(ctx, "/var/data", "/snapshot/spool", request)
		} else {
			result, err = workhistory.RestoreHistoryBackup(ctx, "/var/data", "/snapshot/spool", request)
		}
		if err != nil {
			return historyCode(err)
		}
		raw, err := json.Marshal(result)
		if err != nil {
			return "SNAPSHOT_STORAGE_UNREADABLE"
		}
		file, err := os.CreateTemp("/snapshot/spool", action+"-result-*.tmp")
		if err != nil {
			return "SNAPSHOT_STORAGE_UNREADABLE"
		}
		parent, statErr := os.Stat("/snapshot/spool")
		if statErr != nil {
			file.Close()
			return "SNAPSHOT_STORAGE_UNREADABLE"
		}
		attrs, ok := parent.Sys().(*syscall.Stat_t)
		if !ok || file.Chown(int(attrs.Uid), int(attrs.Gid)) != nil {
			file.Close()
			return "SNAPSHOT_STORAGE_UNREADABLE"
		}
		_, err = file.Write(raw)
		if err == nil {
			err = file.Sync()
		}
		closeErr := file.Close()
		if err != nil || closeErr != nil {
			return "SNAPSHOT_STORAGE_UNREADABLE"
		}
		if os.Rename(file.Name(), "/snapshot/spool/"+action+"-result.json") != nil {
			return "SNAPSHOT_STORAGE_UNREADABLE"
		}
		dir, err := os.Open("/snapshot/spool")
		if err != nil {
			return "SNAPSHOT_STORAGE_UNREADABLE"
		}
		err = dir.Sync()
		dir.Close()
		if err != nil {
			return "SNAPSHOT_STORAGE_UNREADABLE"
		}
		if json.NewEncoder(sink).Encode(result) != nil {
			return "SNAPSHOT_STORAGE_UNREADABLE"
		}
		return ""
	}
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
