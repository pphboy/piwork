package client

import "piwork/internal/pipackage"

// ParsePackageSource shares the Linux source grammar with package preparation.
func ParsePackageSource(argument string) (pipackage.Source, error) {
	return pipackage.ParseSource(argument)
}
