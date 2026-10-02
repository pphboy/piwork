package workfiles

import (
	"encoding/json"
	"encoding/xml"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"piwork/internal/contracts"
	"piwork/internal/filehelper"
)

const DAV = "DAV:"
const Piwork = "urn:piwork:files"
const xmlnsURI = "http://www.w3.org/2000/xmlns/"
const xmlURI = "http://www.w3.org/XML/1998/namespace"

type QName struct{ URI, Local string }
type PropertyRequest struct {
	Mode       string
	Properties []QName
}
type xmlNode struct {
	QName
	Children []*xmlNode
	Text     string
}

var live = []QName{{DAV, "displayname"}, {DAV, "resourcetype"}, {DAV, "getcontentlength"}, {DAV, "getlastmodified"}, {DAV, "getcontenttype"}, {DAV, "supportedlock"}, {DAV, "lockdiscovery"}, {Piwork, "kind"}}
var mediaXML = regexp.MustCompile(`(?i)^(?:application|text)/xml(?:\s*;\s*charset=(?:utf-8|"utf-8"))?\s*$`)
var declarationEncoding = regexp.MustCompile(`encoding\s*=\s*["']([^"']+)["']`)

func ReadXML(request *http.Request) (string, error) {
	if request.ContentLength > MaxXML {
		return "", fail("FILE_LIMIT_EXCEEDED")
	}
	body, err := io.ReadAll(io.LimitReader(request.Body, MaxXML+1))
	if err != nil {
		return "", fail("FILE_TRANSFER_TIMEOUT")
	}
	if len(body) > MaxXML {
		return "", fail("FILE_LIMIT_EXCEEDED")
	}
	if len(body) == 0 {
		return "", nil
	}
	if value := request.Header.Get("Content-Type"); value != "" && !mediaXML.MatchString(value) {
		return "", fail("FILE_MEDIA_UNSUPPORTED")
	}
	if !utf8.Valid(body) {
		return "", fail("FILE_XML_INVALID")
	}
	return string(body), nil
}

func parseXML(body string) (*xmlNode, error) {
	invalid := func() (*xmlNode, error) { return nil, fail("FILE_XML_INVALID") }
	if len(body) > MaxXML {
		return nil, fail("FILE_LIMIT_EXCEEDED")
	}
	if !utf8.ValidString(body) || strings.Contains(body, "<![CDATA[") {
		return invalid()
	}
	decoder := xml.NewDecoder(strings.NewReader(strings.TrimPrefix(body, "\ufeff")))
	var stack []*xmlNode
	var namespaces []map[string]string
	var root *xmlNode
	declaration, tokens := false, 0
	resolve := func(name xml.Name, ns map[string]string) (QName, bool) {
		uri, exists := ns[name.Space]
		if name.Space != "" && !exists {
			return QName{}, false
		}
		return QName{uri, name.Local}, true
	}
	for {
		token, err := decoder.RawToken()
		if err == io.EOF {
			break
		}
		if err != nil {
			return invalid()
		}
		tokens++
		switch value := token.(type) {
		case xml.StartElement:
			if len(stack) >= 32 {
				return invalid()
			}
			ns := map[string]string{"xml": xmlURI}
			if len(namespaces) != 0 {
				for prefix, uri := range namespaces[len(namespaces)-1] {
					ns[prefix] = uri
				}
			}
			attrs := map[xml.Name]bool{}
			for _, attr := range value.Attr {
				if attrs[attr.Name] {
					return invalid()
				}
				attrs[attr.Name] = true
				prefix := ""
				if attr.Name.Space == "xmlns" {
					prefix = attr.Name.Local
				} else if attr.Name.Space != "" || attr.Name.Local != "xmlns" {
					return invalid()
				}
				if prefix == "xmlns" || attr.Value == xmlnsURI || prefix == "xml" && attr.Value != xmlURI || prefix != "xml" && attr.Value == xmlURI || prefix != "" && attr.Value == "" {
					return invalid()
				}
				ns[prefix] = attr.Value
			}
			name, ok := resolve(value.Name, ns)
			if !ok {
				return invalid()
			}
			node := &xmlNode{QName: name}
			if len(stack) == 0 {
				if root != nil {
					return invalid()
				}
				root = node
			} else {
				parent := stack[len(stack)-1]
				parent.Children = append(parent.Children, node)
			}
			stack = append(stack, node)
			namespaces = append(namespaces, ns)
		case xml.EndElement:
			if len(stack) == 0 {
				return invalid()
			}
			name, ok := resolve(value.Name, namespaces[len(namespaces)-1])
			if !ok || stack[len(stack)-1].QName != name {
				return invalid()
			}
			stack = stack[:len(stack)-1]
			namespaces = namespaces[:len(namespaces)-1]
		case xml.CharData:
			if len(stack) == 0 {
				if strings.TrimSpace(string(value)) != "" {
					return invalid()
				}
			} else {
				stack[len(stack)-1].Text += string(value)
			}
		case xml.ProcInst:
			if value.Target != "xml" || tokens != 1 || declaration {
				return invalid()
			}
			declaration = true
			if match := declarationEncoding.FindStringSubmatch(string(value.Inst)); match != nil && !strings.EqualFold(match[1], "utf-8") {
				return invalid()
			}
		case xml.Directive:
			return invalid()
		case xml.Comment:
		default:
			return invalid()
		}
	}
	if root == nil || len(stack) != 0 {
		return invalid()
	}
	return root, nil
}
func properties(node *xmlNode, leaf bool) ([]QName, error) {
	if strings.TrimSpace(node.Text) != "" {
		return nil, fail("FILE_XML_INVALID")
	}
	if len(node.Children) > 128 {
		return nil, fail("FILE_LIMIT_EXCEEDED")
	}
	values := []QName{}
	for _, child := range node.Children {
		if leaf && (len(child.Children) != 0 || strings.TrimSpace(child.Text) != "") {
			return nil, fail("FILE_XML_INVALID")
		}
		values = append(values, child.QName)
	}
	return values, nil
}
func ParsePropfind(body string) (PropertyRequest, error) {
	if strings.TrimSpace(body) == "" {
		return PropertyRequest{Mode: "allprop", Properties: []QName{}}, nil
	}
	root, err := parseXML(body)
	if err != nil {
		return PropertyRequest{}, err
	}
	if root.QName != (QName{DAV, "propfind"}) || strings.TrimSpace(root.Text) != "" {
		return PropertyRequest{}, fail("FILE_XML_INVALID")
	}
	var main, include *xmlNode
	for _, node := range root.Children {
		if node.URI != DAV {
			return PropertyRequest{}, fail("FILE_XML_INVALID")
		}
		switch node.Local {
		case "allprop", "propname", "prop":
			if main != nil {
				return PropertyRequest{}, fail("FILE_XML_INVALID")
			}
			main = node
		case "include":
			if include != nil {
				return PropertyRequest{}, fail("FILE_XML_INVALID")
			}
			include = node
		default:
			return PropertyRequest{}, fail("FILE_XML_INVALID")
		}
	}
	if main == nil || include != nil && main.Local != "allprop" {
		return PropertyRequest{}, fail("FILE_XML_INVALID")
	}
	if main.Local == "prop" {
		props, err := properties(main, true)
		return PropertyRequest{Mode: "prop", Properties: props}, err
	}
	if len(main.Children) != 0 || strings.TrimSpace(main.Text) != "" {
		return PropertyRequest{}, fail("FILE_XML_INVALID")
	}
	props := []QName{}
	if include != nil {
		props, err = properties(include, true)
	}
	return PropertyRequest{Mode: main.Local, Properties: props}, err
}
func ParseProppatch(body string) ([]QName, error) {
	root, err := parseXML(body)
	if err != nil {
		return nil, err
	}
	if root.QName != (QName{DAV, "propertyupdate"}) || strings.TrimSpace(root.Text) != "" || len(root.Children) == 0 {
		return nil, fail("FILE_XML_INVALID")
	}
	result := []QName{}
	for _, operation := range root.Children {
		if operation.URI != DAV || operation.Local != "set" && operation.Local != "remove" || strings.TrimSpace(operation.Text) != "" || len(operation.Children) != 1 || operation.Children[0].QName != (QName{DAV, "prop"}) {
			return nil, fail("FILE_XML_INVALID")
		}
		props, err := properties(operation.Children[0], false)
		if err != nil {
			return nil, err
		}
		result = append(result, props...)
		if len(result) > 128 {
			return nil, fail("FILE_LIMIT_EXCEEDED")
		}
	}
	if len(result) == 0 {
		return nil, fail("FILE_XML_INVALID")
	}
	return result, nil
}
func EscapeXML(value string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;", "'", "&apos;").Replace(value)
}
func propertyElement(property QName, value *string) string {
	prefix, namespace := "d", ""
	if property.URI == Piwork {
		prefix = "p"
	} else if property.URI != DAV {
		prefix = "x"
		namespace = ` xmlns:x="` + EscapeXML(property.URI) + `"`
	}
	name := prefix + ":" + property.Local
	if value == nil || *value == "" {
		return "<" + name + namespace + "/>"
	}
	return "<" + name + namespace + ">" + *value + "</" + name + ">"
}
func propertyValue(property QName, entry contracts.FileHelperMeta) *string {
	var value string
	if property.URI == Piwork && property.Local == "kind" {
		value = EscapeXML(entry.Kind)
		return &value
	}
	if property.URI != DAV {
		return nil
	}
	switch property.Local {
	case "displayname":
		value = "/"
		if len(entry.PathSegments) != 0 {
			value = EscapeXML(entry.PathSegments[len(entry.PathSegments)-1])
		}
	case "resourcetype":
		if entry.Kind == "directory" {
			value = "<d:collection/>"
		}
	case "getcontentlength":
		if entry.Kind != "file" {
			return nil
		}
		if string(entry.Size) == "null" {
			value = "0"
		} else {
			value = string(entry.Size)
		}
	case "getlastmodified":
		var ms int64
		if string(entry.ModifiedMs) == "null" || json.Unmarshal(entry.ModifiedMs, &ms) != nil {
			return nil
		}
		value = time.UnixMilli(ms).UTC().Format(http.TimeFormat)
	case "getcontenttype":
		if entry.Kind == "file" {
			value = "application/octet-stream"
		} else if entry.Kind == "directory" {
			value = "httpd/unix-directory"
		} else {
			return nil
		}
	case "supportedlock", "lockdiscovery":
	default:
		return nil
	}
	return &value
}
func multistatus(responses string) (string, error) {
	body := `<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:" xmlns:p="urn:piwork:files">` + responses + `</d:multistatus>`
	if len(body) > MaxMetadata {
		return "", fail("FILE_LIMIT_EXCEEDED")
	}
	return body, nil
}
func RenderPropfind(workID string, entries []contracts.FileHelperMeta, request PropertyRequest) (string, error) {
	var responses strings.Builder
	for _, entry := range entries {
		props := request.Properties
		if request.Mode == "allprop" || request.Mode == "propname" {
			props = []QName{}
			for _, property := range live {
				if propertyValue(property, entry) != nil {
					props = append(props, property)
				}
			}
			if request.Mode == "allprop" {
				props = append(props, request.Properties...)
			}
		}
		var success, missing strings.Builder
		for _, property := range props {
			value := propertyValue(property, entry)
			if value == nil {
				missing.WriteString(propertyElement(property, nil))
			} else {
				if request.Mode == "propname" {
					value = nil
				}
				success.WriteString(propertyElement(property, value))
			}
		}
		responses.WriteString("<d:response><d:href>" + EscapeXML(Href(workID, entry.PathSegments, entry.Kind == "directory")) + "</d:href>")
		for _, state := range []struct {
			body   string
			status string
		}{{success.String(), "200 OK"}, {missing.String(), "404 Not Found"}} {
			if state.body != "" {
				responses.WriteString("<d:propstat><d:prop>" + state.body + "</d:prop><d:status>HTTP/1.1 " + state.status + "</d:status></d:propstat>")
			}
		}
		responses.WriteString("</d:response>")
		if responses.Len() > MaxMetadata {
			return "", fail("FILE_LIMIT_EXCEEDED")
		}
	}
	return multistatus(responses.String())
}
func RenderProppatch(workID string, entry contracts.FileHelperMeta, props []QName) (string, error) {
	var body strings.Builder
	for _, property := range props {
		body.WriteString(propertyElement(property, nil))
	}
	return multistatus("<d:response><d:href>" + EscapeXML(Href(workID, entry.PathSegments, entry.Kind == "directory")) + "</d:href><d:propstat><d:prop>" + body.String() + "</d:prop><d:status>HTTP/1.1 403 Forbidden</d:status></d:propstat></d:response>")
}
func RenderFailures(workID string, roots [][]string, failures []contracts.FileHelperError) (string, error) {
	var body strings.Builder
	for _, failure := range failures {
		var parts []string
		if string(failure.PathSegments) == "null" || json.Unmarshal(failure.PathSegments, &parts) != nil {
			return "", fail("FILE_BACKEND_PROTOCOL_ERROR")
		}
		if filehelper.ValidateSegments(parts) != nil {
			return "", fail("FILE_BACKEND_PROTOCOL_ERROR")
		}
		allowed := false
		for _, root := range roots {
			if len(parts) >= len(root) {
				match := true
				for i, part := range root {
					match = match && parts[i] == part
				}
				allowed = allowed || match
			}
		}
		status, known := Status[failure.Code]
		if !allowed || !known {
			return "", fail("FILE_BACKEND_PROTOCOL_ERROR")
		}
		text := "Error"
		if status == 403 {
			text = "Forbidden"
		} else if status == 404 {
			text = "Not Found"
		}
		body.WriteString("<d:response><d:href>" + EscapeXML(Href(workID, parts, false)) + "</d:href><d:status>HTTP/1.1 " + strconv.Itoa(status) + " " + text + "</d:status><d:error><p:code>" + failure.Code + "</p:code></d:error></d:response>")
		if body.Len() > MaxMetadata {
			return "", fail("FILE_LIMIT_EXCEEDED")
		}
	}
	return multistatus(body.String())
}
