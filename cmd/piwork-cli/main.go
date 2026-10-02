package main

import (
	"os"
	"piwork/internal/cli"
)

func main() { os.Exit(cli.Entry("piwork-cli", os.Args[1:], os.Stdout, os.Stderr)) }
