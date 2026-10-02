package main

import (
	"os"
	"piwork/internal/cli"
)

func main() { os.Exit(cli.Entry("piwork-console", os.Args[1:], os.Stdout, os.Stderr)) }
