package main

import (
	"flag"
	"fmt"
	"os"
	"piwork/internal/releaseinfo"
	"strings"
)

func main() {
	version := flag.String("version", "", "Candidate version")
	components := flag.String("components", "core,desktop", "Candidate components")
	required := flag.Bool("require-current", false, "Require exact-version notes")
	flag.Parse()
	if err := releaseinfo.Check(*version, strings.Split(*components, ","), *required); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
