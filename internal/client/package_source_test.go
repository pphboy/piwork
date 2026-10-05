package client

import (
	"reflect"
	"testing"

	"piwork/internal/pipackage"
)

func TestPackageSourceRetainsRemoteAndLinuxGrammar(t *testing.T) {
	for _, argument := range []string{"npm:@owner/tools@1.0.0", "git:github.com/owner/tools@main", "./包 空格", "../source.zip", "/tmp/source.zip", "tools", "npm:bad spec", "git:http://example.com/owner/repo"} {
		got, err := parsePackageSource(argument, false)
		want, originalErr := pipackage.ParseSource(argument)
		if (err == nil) != (originalErr == nil) || !reflect.DeepEqual(got, want) {
			t.Fatal("Linux source grammar changed", argument, err)
		}
		if len(argument) >= 4 && (argument[:4] == "npm:" || argument[:4] == "git:") {
			got, err = parsePackageSource(argument, true)
			if (err == nil) != (originalErr == nil) || !reflect.DeepEqual(got, want) {
				t.Fatal("Windows remote grammar changed", argument, err)
			}
		}
	}
}

func TestPackageSourceWindowsPathsAreExplicitAndUnambiguous(t *testing.T) {
	for _, test := range []struct{ input, kind, name string }{
		{`.\包 空格`, "local", "包 空格"},
		{`..\目录\source.zip`, "zip", "source.zip"},
		{`C:\包 空格\source.ZIP`, "zip", "source.ZIP"},
		{`C:/包 空格/目录`, "local", "目录"},
		{`\\server\share\包 空格\source.zip`, "zip", "source.zip"},
		{`//server/share/包 空格`, "local", "包 空格"},
		{"./包目录", "local", "包目录"},
	} {
		got, err := parsePackageSource(test.input, true)
		if err != nil || got.Kind != test.kind || got.Path != test.input || got.DisplayName != test.name {
			t.Fatal("Windows source", test.input, got, err)
		}
	}
	for _, input := range []string{`C:source.zip`, `C:`, `C:\`, `\\?\C:\source.zip`, `\\.\C:\source.zip`, `\??\C:\source.zip`, `//?/C:/source.zip`, `.\file.zip:secret`, `C:\file:stream`, `\\server\share`, `\\server\\file`, `.\trailing.`, `.\bad*name`, `bare-name`, "./bad\x00name"} {
		if _, err := parsePackageSource(input, true); err == nil {
			t.Fatalf("dangerous or ambiguous source accepted: %q", input)
		}
	}
}
