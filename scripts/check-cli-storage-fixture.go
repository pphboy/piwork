//go:build ignore

package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"piwork/scripts/clinative"
	"runtime"
)

func main() {
	create := flag.Bool("create", false, "create new private harmless fixture")
	probe := flag.Bool("probe-other-user", false, "check denial from another OS account")
	directory := flag.String("directory", "", "private fixture directory")
	owner := flag.String("owner", "", "expected owner's SID or UID")
	control := flag.String("control", "", "live owner's named pipe or Unix socket")
	flag.Parse()
	if *directory == "" || *create == *probe || flag.NArg() != 0 {
		fmt.Fprintln(os.Stderr, "choose --create or --probe-other-user, with --directory and probe --owner")
		os.Exit(2)
	}
	if *create {
		identity, err := clinative.CreateStorageFixture(*directory)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		json.NewEncoder(os.Stdout).Encode(map[string]string{"directory": *directory, "owner": identity})
		return
	}
	err := clinative.ProbeOtherUserStorage(*directory, *owner)
	if err == nil {
		err = clinative.ProbeOtherUserControl(*control)
	}
	status := "pass"
	diagnostic := "a different native OS account could neither read/write owner storage nor connect to the live Desktop control channel"
	if err != nil {
		status = "unverified"
		diagnostic = err.Error()
	}
	json.NewEncoder(os.Stdout).Encode(map[string]string{"id": "other-user", "sha256": os.Getenv("PIWORK_TEST_CLI_SHA256"), "target": runtime.GOOS + "/" + runtime.GOARCH, "status": status, "diagnostic": diagnostic})
	if err != nil {
		os.Exit(1)
	}
}
