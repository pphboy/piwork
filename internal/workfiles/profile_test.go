package workfiles

import (
	"encoding/json"
	"encoding/xml"
	"io"
	"net/http/httptest"
	"strings"
	"testing"

	"piwork/internal/contracts"
	"piwork/internal/fileprotocol"
)

const prefix = "/api/v1/works/work-1234567890123456/files"

func TestRawDAVPathsAndDestinationsCannotNormalizeOutOfWork(t *testing.T) {
	for _, path := range []string{prefix + "/%2e%2e/secret", prefix + "/..", prefix + "//foo", prefix + "/%2fetc", prefix + "/%5c", prefix + "/%ff", prefix + "/%00", prefix + "/%zz", prefix + "/x?query=1", prefix + "/x#f"} {
		if _, err := ParseTarget(path); fileprotocol.Code(err) != "FILE_PATH_INVALID" {
			t.Fatal("unsafe path", path, err)
		}
	}
	path, err := ParseTarget(prefix + "/%E4%B8%AD%E6%96%87/%252F%2B.txt")
	if err != nil || path.Segments[0] != "中文" || path.Segments[1] != "%2F+.txt" || path.EncodedPath != prefix+"/%E4%B8%AD%E6%96%87/%252F%2B.txt" {
		t.Fatal(path, err)
	}
	root, err := ParseTarget(prefix)
	if err != nil || !root.RootWithoutSlash || root.EncodedPath != prefix+"/" {
		t.Fatal(root, err)
	}
	if _, err := ParseTarget(prefix + "/" + strings.Repeat("x/", 128) + "x"); fileprotocol.Code(err) != "FILE_PATH_TOO_LONG" {
		t.Fatal(err)
	}
	request := httptest.NewRequest("COPY", "http://localhost"+prefix+"/source", nil)
	for _, value := range []string{"http://evil.example" + prefix + "/target", "https://localhost" + prefix + "/target", prefix + "/../target", "/api/v1/works/work-foreign123456789/files/target", "http://user@localhost" + prefix + "/target"} {
		request.Header.Set("Destination", value)
		if _, err := Destination(request, "work-1234567890123456"); fileprotocol.Code(err) != "FILE_DESTINATION_DENIED" {
			t.Fatal(value, err)
		}
	}
	request.Header.Set("Destination", "http://localhost"+prefix+"/target")
	if parts, err := Destination(request, "work-1234567890123456"); err != nil || len(parts) != 1 || parts[0] != "target" {
		t.Fatal(parts, err)
	}
}

func TestSingleRangeParsingAndStableHEADFileErrors(t *testing.T) {
	for _, value := range []string{"bytes=0-1,4-5", "bytes=-0", "bytes=3-2", "bytes=a-b", "bytes=9007199254740992-", "", " bytes=0-1"} {
		if _, err := ReadRange(value); fileprotocol.Code(err) != "FILE_RANGE_UNSATISFIABLE" {
			t.Fatal(value, err)
		}
	}
	for _, value := range []string{"bytes=0-1", "bytes=2-", "bytes=-5"} {
		if _, err := ReadRange(value); err != nil {
			t.Fatal(value, err)
		}
	}
	writer := httptest.NewRecorder()
	size := int64(12)
	SendError(writer, fail("FILE_RANGE_UNSATISFIABLE"), true, &size)
	if writer.Code != 416 || writer.Body.Len() != 0 || writer.Header().Get("Content-Range") != "bytes */12" || writer.Header().Get("X-Piwork-File-Error") != "FILE_RANGE_UNSATISFIABLE" {
		t.Fatal(writer)
	}
}

func TestDAVXMLRejectsEntitiesUnknownNamespacesAndUnboundedStructures(t *testing.T) {
	for _, body := range []string{
		`<!DOCTYPE propfind [<!ENTITY x SYSTEM "file:///etc/passwd">]><propfind xmlns="DAV:"><allprop/></propfind>`,
		`<propfind xmlns="DAV:"><allprop><![CDATA[x]]></allprop></propfind>`,
		`<?other x?><propfind xmlns="DAV:"><allprop/></propfind>`,
		`<d:propfind><d:allprop/></d:propfind>`,
		`<propfind xmlns="DAV:" attr="x"><allprop/></propfind>`,
		`<propfind xmlns="DAV:"><allprop/><allprop/></propfind>`,
		`<propfind xmlns="DAV:"><propname/><include/></propfind>`,
		`<propfind xmlns="DAV:"><prop><displayname>x</displayname></prop></propfind>`,
		`<?xml version="1.0" encoding="iso-8859-1"?><propfind xmlns="DAV:"><allprop/></propfind>`,
		strings.Repeat(`<x xmlns="DAV:">`, 33) + strings.Repeat(`</x>`, 33),
	} {
		if _, err := ParsePropfind(body); fileprotocol.Code(err) != "FILE_XML_INVALID" {
			t.Fatal("unsafe XML accepted", body, err)
		}
	}
	if _, err := ParsePropfind(`<propfind xmlns="DAV:"><prop>` + strings.Repeat(`<displayname/>`, 129) + `</prop></propfind>`); fileprotocol.Code(err) != "FILE_LIMIT_EXCEEDED" {
		t.Fatal(err)
	}
	request := httptest.NewRequest("PROPFIND", "http://localhost/", strings.NewReader(string([]byte{255})))
	request.Header.Set("Content-Type", "application/xml")
	if _, err := ReadXML(request); fileprotocol.Code(err) != "FILE_XML_INVALID" {
		t.Fatal(err)
	}
	request = httptest.NewRequest("PROPFIND", "http://localhost/", strings.NewReader(`<propfind/>`))
	request.Header.Set("Content-Type", "application/xml; charset=utf-16")
	if _, err := ReadXML(request); fileprotocol.Code(err) != "FILE_MEDIA_UNSUPPORTED" {
		t.Fatal(err)
	}
}

func TestDAVPartialPropertiesAndProtectedProppatchRenderValidNamespaces(t *testing.T) {
	body := `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:x="urn:custom"><d:prop><d:displayname/><x:unknown/></d:prop></d:propfind>`
	request, err := ParsePropfind(body)
	if err != nil {
		t.Fatal(err)
	}
	entry := contracts.FileHelperMeta{PathSegments: []string{"中文 & file"}, Kind: "file", Size: json.RawMessage(`3`), ModifiedMs: json.RawMessage(`0`)}
	output, err := RenderPropfind("work-1234567890123456", []contracts.FileHelperMeta{entry}, request)
	if err != nil || !strings.Contains(output, "200 OK") || !strings.Contains(output, "404 Not Found") || !strings.Contains(output, "中文 &amp; file") {
		t.Fatal(output, err)
	}
	decoder := xml.NewDecoder(strings.NewReader(output))
	for {
		_, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(output, err)
		}
	}
	props, err := ParseProppatch(`<d:propertyupdate xmlns:d="DAV:" xmlns:x="urn:custom"><d:set><d:prop><x:property><x:child>value</x:child></x:property></d:prop></d:set></d:propertyupdate>`)
	if err != nil || len(props) != 1 {
		t.Fatal(props, err)
	}
	output, err = RenderProppatch("work-1234567890123456", entry, props)
	if err != nil || !strings.Contains(output, "403 Forbidden") {
		t.Fatal(output, err)
	}
	if _, err := RenderFailures("work-1234567890123456", [][]string{{"safe"}}, []contracts.FileHelperError{{Code: "FILE_NOT_FOUND", PathSegments: json.RawMessage(`["other"]`)}}); fileprotocol.Code(err) != "FILE_BACKEND_PROTOCOL_ERROR" {
		t.Fatal(err)
	}
	output, err = RenderFailures("work-1234567890123456", [][]string{{"safe"}}, []contracts.FileHelperError{{Code: "FILE_PERMISSION_DENIED", PathSegments: json.RawMessage(`["safe","中文 &"]`)}, {Code: "FILE_NOT_FOUND", PathSegments: json.RawMessage(`["safe","missing"]`)}})
	if err != nil || !strings.Contains(output, "403 Forbidden") || !strings.Contains(output, "404 Not Found") || !strings.Contains(output, "%E4%B8%AD%E6%96%87") {
		t.Fatal(output, err)
	}
	if _, err := RenderFailures("work-1234567890123456", [][]string{{"safe"}}, []contracts.FileHelperError{{Code: "FILE_NOT_FOUND", PathSegments: json.RawMessage(`["safe",".."]`)}}); fileprotocol.Code(err) != "FILE_BACKEND_PROTOCOL_ERROR" {
		t.Fatal(err)
	}
}
