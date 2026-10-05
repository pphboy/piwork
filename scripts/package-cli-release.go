//go:build ignore

package main

import (
	"flag"
	"fmt"
	"os"
	"piwork/scripts/clirelease"
)

func main() {
	directory := flag.String("build", "", "candidate dist/cli/<goos>-<goarch> directory")
	evidence := flag.String("evidence", "", "matching native acceptance report")
	output := flag.String("output", "dist/cli-release", "archive output directory")
	flag.Parse()
	if *directory == "" || *evidence == "" || flag.NArg() != 0 {
		fmt.Fprintln(os.Stderr, "usage: go run scripts/package-cli-release.go --build <directory> --evidence <report> [--output <directory>]")
		os.Exit(2)
	}
	path, err := clirelease.Package(*directory, *evidence, *output)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Println(path)
}
