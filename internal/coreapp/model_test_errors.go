package coreapp

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"net"
)

type modelTestFailureInfo struct{ category, message, recovery string }

var modelTestFailures = map[string]modelTestFailureInfo{
	"provider-authentication": {"authentication", "The provider rejected the request's credentials or permissions.", "Check the provider API Key and model access. Your administrator login is still valid."},
	"model-unavailable":       {"model", "The provider could not find the requested model or endpoint.", "Check the exact Model ID and the provider Base URL. You can still save valid configuration."},
	"rate-limited":            {"rate-limit", "The provider limited this request or reported exhausted quota.", "Check provider quota or wait before explicitly testing again."},
	"dns":                     {"network", "The provider hostname could not be resolved.", "Check the Base URL hostname and the Core machine's DNS connection."},
	"tls":                     {"network", "A secure TLS connection to the provider could not be verified or established.", "Check the provider HTTPS address, certificate and the Core machine's trusted certificates."},
	"connection":              {"network", "Core could not connect to the provider.", "Check the Base URL, provider availability and the Core machine's network or firewall."},
	"network":                 {"network", "The provider request could not be completed because of a network error.", "Check provider availability and the Core machine's network, then explicitly test again."},
	"timeout":                 {"timeout", "The provider request exceeded the test time budget.", "Check provider responsiveness and connectivity, then explicitly test again."},
	"provider-error":          {"protocol", "The provider returned an error for this request.", "Check the provider service, API type, Model ID and account status. Saving valid configuration remains available."},
	"protocol-mismatch":       {"protocol", "The provider response was incomplete or did not match the selected API protocol.", "Check that this endpoint supports the selected Responses or Messages API."},
	"empty-reply":             {"protocol", "The provider returned no visible assistant text.", "Check the selected model and API. Reasoning or tool calls alone do not complete this message Test."},
	"response-too-large":      {"response-limit", "The provider response exceeded the Test response size limit.", "Check the model and API endpoint. Test expects a short non-streaming message response."},
}

func modelTestNetworkReason(err error) string {
	var timeout net.Error
	if errors.Is(err, context.DeadlineExceeded) || errors.As(err, &timeout) && timeout.Timeout() {
		return "timeout"
	}
	var dns *net.DNSError
	if errors.As(err, &dns) {
		return "dns"
	}
	var verify *tls.CertificateVerificationError
	var authority x509.UnknownAuthorityError
	var invalid x509.CertificateInvalidError
	var hostname x509.HostnameError
	var record tls.RecordHeaderError
	var alert tls.AlertError
	if errors.As(err, &verify) || errors.As(err, &authority) || errors.As(err, &invalid) || errors.As(err, &hostname) || errors.As(err, &record) || errors.As(err, &alert) {
		return "tls"
	}
	var op *net.OpError
	if errors.As(err, &op) && op.Op == "dial" {
		return "connection"
	}
	return "network"
}

// Interpret only recognized protocol codes; arbitrary provider text is never
// copied into a public error or log, even when it contains a Key or file path.
func modelTestProviderReason(status int, data []byte) string {
	switch status {
	case 401, 403:
		return "provider-authentication"
	case 404:
		return "model-unavailable"
	case 429:
		return "rate-limited"
	}
	var body struct {
		Error *struct{ Code, Type, Param string } `json:"error"`
	}
	if json.Unmarshal(data, &body) == nil && body.Error != nil {
		for _, code := range []string{body.Error.Code, body.Error.Type} {
			switch code {
			case "invalid_api_key", "authentication_error", "permission_error", "permission_denied":
				return "provider-authentication"
			case "model_not_found":
				return "model-unavailable"
			case "rate_limit_error", "rate_limit_exceeded", "insufficient_quota":
				return "rate-limited"
			case "invalid_request_error":
				if body.Error.Param == "model" {
					return "model-unavailable"
				}
			}
		}
		return "provider-error"
	}
	if status < 200 || status >= 300 {
		return "provider-error"
	}
	return ""
}
