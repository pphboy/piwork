package main

import (
	"os"
	"piwork/internal/consoleapp"
)

func main() { os.Exit(consoleapp.Entry(os.Args[1:], os.Stdout, os.Stderr)) }
