package coreapp

import (
	"testing"

	"piwork/internal/contracts"
)

func TestAdminDefaultPatchPreservesPackageOrder(t *testing.T) {
	patch := adminDefaultPatch(contracts.AdminDefaultWorkPatch{
		Packages: contracts.Supplied([]contracts.PiPackageName{"pkg-c", "pkg-a", "pkg-b"}),
	})
	if !patch.Packages.Present || len(patch.Packages.Value) != 3 {
		t.Fatal("packages were not supplied", patch.Packages)
	}
	for index, name := range []string{"pkg-c", "pkg-a", "pkg-b"} {
		entry := patch.Packages.Value[index]
		if entry.Name != contracts.PiPackageName(name) || !entry.Enabled {
			t.Fatal("default package order changed", index, entry)
		}
	}
}
