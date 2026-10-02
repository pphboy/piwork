package internaltls

import (
	"crypto/tls"
	"crypto/x509"
	"encoding/pem"
	"strings"
)

// ServiceClientFromPEM uses only the fixed read-only files mounted into an
// Agent. The client identity determines its installation; no Work ID, role or
// alternate trust root may be selected by an MCP caller.
func ServiceClientFromPEM(caPEM, certificatePEM, keyPEM []byte) (*tls.Config, error) {
	block, rest := pem.Decode(caPEM)
	if block == nil || block.Type != "CERTIFICATE" || strings.TrimSpace(string(rest)) != "" {
		return nil, ErrMaterial
	}
	ca, err := x509.ParseCertificate(block.Bytes)
	if err != nil || !ca.IsCA || !strings.HasPrefix(ca.Subject.CommonName, "piwork-installation-") {
		return nil, ErrMaterial
	}
	installation := strings.TrimPrefix(ca.Subject.CommonName, "piwork-installation-")
	if !(Scope{InstallationID: installation}).valid(false) {
		return nil, ErrIdentity
	}
	certificate, err := tls.X509KeyPair(certificatePEM, keyPEM)
	if err != nil || len(certificate.Certificate) != 1 {
		return nil, ErrMaterial
	}
	leaf, err := x509.ParseCertificate(certificate.Certificate[0])
	if err != nil {
		return nil, ErrMaterial
	}
	pool := x509.NewCertPool()
	pool.AddCert(ca)
	if _, err := leaf.Verify(x509.VerifyOptions{Roots: pool, KeyUsages: []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth}}); err != nil {
		return nil, ErrIdentity
	}
	if _, err := AuthorizeServicePeer(leaf, installation, func(Scope) bool { return true }); err != nil {
		return nil, err
	}
	return &tls.Config{MinVersion: tls.VersionTLS12, ServerName: "piwork-core", RootCAs: pool, Certificates: []tls.Certificate{certificate}, VerifyConnection: func(state tls.ConnectionState) error {
		if len(state.VerifiedChains) == 0 || len(state.PeerCertificates) == 0 {
			return ErrIdentity
		}
		return verifyRole(state.PeerCertificates[0], Scope{InstallationID: installation}, CoreServiceServer)
	}}, nil
}
