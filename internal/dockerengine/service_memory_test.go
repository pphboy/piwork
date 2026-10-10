package dockerengine

import (
	"context"
	"testing"
)

func TestServiceContainerHasNoMemoryLimitWithOriginalIsolation(t *testing.T) {
	runtime, _, release := resourceFixture(t)
	close(release)
	spec := fixtureSpec()
	spec.MemoryBytes = 256 << 20 // Compatible legacy value cannot impose a cap.
	spec.User = "10001:10001"
	spec.CPUMillis = 250
	if _, err := runtime.EnsureContainer(context.Background(), spec); err != nil {
		t.Fatal(err)
	}
	view, err := runtime.InspectContainer(context.Background(), spec.Identity)
	if err != nil {
		t.Fatal(err)
	}
	if view.HostConfig.Memory != 0 || view.HostConfig.MemoryReservation != 0 || !view.HostConfig.ReadonlyRootfs || view.Config.User != spec.User || view.HostConfig.NanoCPUs != 250000000 {
		t.Fatal("Service resources or isolation changed", view.HostConfig, view.Config.User)
	}
	for _, kind := range []string{"agent", "file-helper", "snapshot-helper"} {
		spec.Identity.Kind = kind
		spec.DisplayName = ""
		spec.MemoryBytes = 0
		normalized, err := normalizeContainer(spec)
		if err != nil || normalized.MemoryBytes != 64<<20 {
			t.Fatal(kind, normalized.MemoryBytes, err)
		}
	}
}
