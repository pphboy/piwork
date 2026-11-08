package workpackage

import "testing"

func TestExportFilename(t *testing.T) {
	for _, test := range []struct{ name, want string }{
		{"我的项目 Demo", "我的项目 Demo.work"},
		{"  保留 空格", "  保留 空格.work"},
		{"项目🚀", "项目🚀.work"},
		{"研发/实验:1", "研发_实验_1.work"},
		{`<>:"/\|?*`, "_________.work"},
		{"a\x00\t\r\n\x7f\u0085b", "a______b.work"},
		{"项目. . ", "项目.work"},
		{"", "work.work"},
		{"...", "work.work"},
		{".hidden", ".hidden.work"},
		{"demo.work", "demo.work.work"},
		{"CON", "_CON.work"},
		{"prn", "_prn.work"},
		{"Aux.txt", "_Aux.txt.work"},
		{"NUL", "_NUL.work"},
		{"com1", "_com1.work"},
		{"LPT9", "_LPT9.work"},
		{"COM0", "COM0.work"},
		{"COM10", "COM10.work"},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := ExportFilename(test.name); got != test.want {
				t.Fatalf("ExportFilename(%q) = %q, want %q", test.name, got, test.want)
			}
		})
	}
}
