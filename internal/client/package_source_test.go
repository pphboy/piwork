package client

import (
	"reflect"
	"testing"

	"piwork/internal/pipackage"
)

func TestPackageSourceRetainsRemoteAndLinuxGrammar(t *testing.T) {
	for _, argument := range []string{"npm:@owner/tools@1.0.0", "git:github.com/owner/tools@main", "./包 空格", "../source.zip", "/tmp/source.zip", "tools", "npm:bad spec", "git:http://example.com/owner/repo"} {
		got, err := ParsePackageSource(argument)
		want, originalErr := pipackage.ParseSource(argument)
		if (err == nil) != (originalErr == nil) || !reflect.DeepEqual(got, want) {
			t.Fatal("Linux source grammar changed", argument, err)
		}
	}
}
