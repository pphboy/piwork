package client

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestCredentialPathPriorityAndLazyAbsoluteResolution(t *testing.T) {
	base := t.TempDir()
	for _, test := range []struct {
		name, explicit, xdg, home, appdata, want string
		fail                                     bool
	}{
		{name: "explicit", explicit: filepath.Join(base, "自定义 空格", "client.json"), xdg: filepath.Join(base, "xdg"), home: base, appdata: base, want: filepath.Join(base, "自定义 空格", "client.json")},
		{name: "relative-explicit", explicit: filepath.Join("相对 空格", "client.json"), xdg: base, home: base, appdata: base, want: filepath.Join("相对 空格", "client.json")},
		{name: "xdg", xdg: filepath.Join(base, "XDG 配置"), home: base, appdata: base, want: filepath.Join(base, "XDG 配置", "piwork", "client.json")},
		{name: "relative-xdg", xdg: "relative-xdg", home: base, appdata: base, want: filepath.Join("relative-xdg", "piwork", "client.json")},
		{name: "default", home: filepath.Join(base, "主目录"), appdata: filepath.Join(base, "用户配置")},
		{name: "missing-default", fail: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Setenv("PIWORK_CONFIG_PATH", test.explicit)
			t.Setenv("XDG_CONFIG_HOME", test.xdg)
			t.Setenv("HOME", test.home)
			t.Setenv("APPDATA", test.appdata)
			want := test.want
			if test.name == "default" {
				want = filepath.Join(test.home, ".config", "piwork", "client.json")
				if runtime.GOOS == "windows" {
					want = filepath.Join(test.appdata, "piwork", "client.json")
				}
			}
			got, err := CredentialPath()
			if test.fail {
				if err == nil || got != "" {
					t.Fatal("missing default unexpectedly resolved", got, err)
				}
				return
			}
			absolute, absErr := filepath.Abs(want)
			if absErr != nil || err != nil || got != absolute {
				t.Fatal("credential path", got, absolute, err, absErr)
			}
			if _, err := os.Stat(got); !os.IsNotExist(err) {
				t.Fatal("path resolution accessed or created state", err)
			}
		})
	}
}
