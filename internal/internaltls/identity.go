// Package internaltls owns installation and generation-scoped native TLS.
// PEM files are private platform material, never exported Work content.
package internaltls

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"errors"
	"fmt"
	"math/big"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var ErrMaterial = errors.New("internal TLS material is invalid or unsafe")
var ErrIdentity = errors.New("internal TLS peer identity is not authorized")
var ErrStale = errors.New("internal TLS runtime identity is inactive")
var ErrExpired = errors.New("internal TLS authority has expired")

const (
	AgentServer        = "agent-server"
	CoreClient         = "core-client"
	AgentServiceClient = "agent-service-client"
	CoreServiceServer  = "core-service-server"
)

var identifier = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9-]{0,127}$`)
var workIdentifier = regexp.MustCompile(`^work-[a-zA-Z0-9-]+$`)
var instanceIdentifier = regexp.MustCompile(`^agent-[a-zA-Z0-9-]+$`)

type Scope struct {
	InstallationID string `json:"installationId"`
	WorkID         string `json:"workId,omitempty"`
	Generation     int64  `json:"generation,omitempty"`
	InstanceID     string `json:"instanceId,omitempty"`
}

func (s Scope) valid(runtime bool) bool {
	if !identifier.MatchString(s.InstallationID) {
		return false
	}
	if !runtime {
		return s.WorkID == "" && s.Generation == 0 && s.InstanceID == ""
	}
	return workIdentifier.MatchString(s.WorkID) && len(s.WorkID) <= 128 && instanceIdentifier.MatchString(s.InstanceID) && len(s.InstanceID) <= 128 && s.Generation > 0 && s.Generation <= 9007199254740991
}

func (s Scope) URI(role string) string {
	if role == CoreServiceServer {
		return "spiffe://piwork/installation/" + s.InstallationID + "/role/" + role
	}
	return fmt.Sprintf("spiffe://piwork/installation/%s/work/%s/generation/%d/instance/%s/role/%s", s.InstallationID, s.WorkID, s.Generation, s.InstanceID, role)
}
func (s Scope) commonName(role string) string {
	switch role {
	case AgentServer:
		return fmt.Sprintf("agent.g%d.%s.piwork", s.Generation, s.WorkID)
	case CoreClient:
		return fmt.Sprintf("core.g%d.%s.piwork", s.Generation, s.WorkID)
	case AgentServiceClient:
		return AgentServiceClient
	case CoreServiceServer:
		return "piwork-core"
	default:
		return ""
	}
}

type keyPair struct {
	Certificate string `json:"certificate"`
	PrivateKey  string `json:"privateKey"`
}

func serial() (*big.Int, error) {
	value, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil || value.Sign() <= 0 {
		return nil, ErrMaterial
	}
	return value, nil
}
func makePair(template, parent *x509.Certificate, signer *rsa.PrivateKey) (keyPair, error) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return keyPair{}, ErrMaterial
	}
	if parent == nil {
		parent, signer = template, key
	}
	der, err := x509.CreateCertificate(rand.Reader, template, parent, &key.PublicKey, signer)
	if err != nil {
		return keyPair{}, ErrMaterial
	}
	return keyPair{Certificate: string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})), PrivateKey: string(pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)}))}, nil
}
func issueAuthority(installation string, now time.Time) (keyPair, error) {
	id, err := serial()
	if err != nil {
		return keyPair{}, err
	}
	return makePair(&x509.Certificate{SerialNumber: id, Subject: pkix.Name{CommonName: "piwork-installation-" + installation}, NotBefore: now.Add(-time.Minute), NotAfter: now.Add(3650 * 24 * time.Hour), IsCA: true, BasicConstraintsValid: true, MaxPathLen: 0, MaxPathLenZero: true, KeyUsage: x509.KeyUsageCertSign | x509.KeyUsageCRLSign}, nil, nil)
}
func parsePair(pair keyPair) (*x509.Certificate, *rsa.PrivateKey, error) {
	certBlock, rest := pem.Decode([]byte(pair.Certificate))
	if certBlock == nil || certBlock.Type != "CERTIFICATE" || len(strings.TrimSpace(string(rest))) != 0 {
		return nil, nil, ErrMaterial
	}
	cert, err := x509.ParseCertificate(certBlock.Bytes)
	if err != nil {
		return nil, nil, ErrMaterial
	}
	keyBlock, rest := pem.Decode([]byte(pair.PrivateKey))
	if keyBlock == nil || keyBlock.Type != "RSA PRIVATE KEY" || len(strings.TrimSpace(string(rest))) != 0 {
		return nil, nil, ErrMaterial
	}
	key, err := x509.ParsePKCS1PrivateKey(keyBlock.Bytes)
	if err != nil || key.Validate() != nil || key.N.BitLen() < 2048 {
		return nil, nil, ErrMaterial
	}
	pub, ok := cert.PublicKey.(*rsa.PublicKey)
	if !ok || pub.E != key.E || pub.N.Cmp(key.N) != 0 {
		return nil, nil, ErrMaterial
	}
	return cert, key, nil
}
func validateAuthority(pair keyPair, installation string, now time.Time) (*x509.Certificate, *rsa.PrivateKey, error) {
	cert, key, err := parsePair(pair)
	if err != nil || !cert.IsCA || !cert.BasicConstraintsValid || !cert.MaxPathLenZero || cert.MaxPathLen != 0 || cert.Subject.CommonName != "piwork-installation-"+installation || cert.CheckSignatureFrom(cert) != nil || cert.KeyUsage != x509.KeyUsageCertSign|x509.KeyUsageCRLSign {
		return nil, nil, ErrMaterial
	}
	if now.Before(cert.NotBefore) || !now.Add(time.Minute).Before(cert.NotAfter) {
		return nil, nil, ErrExpired
	}
	return cert, key, nil
}
func issueLeaf(authority keyPair, scope Scope, role string, now time.Time) (keyPair, error) {
	ca, key, err := validateAuthority(authority, scope.InstallationID, now)
	if err != nil {
		return keyPair{}, err
	}
	id, err := serial()
	if err != nil {
		return keyPair{}, err
	}
	uri, _ := url.Parse(scope.URI(role))
	template := &x509.Certificate{SerialNumber: id, Subject: pkix.Name{CommonName: scope.commonName(role)}, NotBefore: now.Add(-time.Minute), NotAfter: now.Add(30 * 24 * time.Hour), BasicConstraintsValid: true, KeyUsage: x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment, URIs: []*url.URL{uri}}
	if template.Subject.CommonName == "" {
		return keyPair{}, ErrIdentity
	}
	if template.NotAfter.After(ca.NotAfter) {
		template.NotAfter = ca.NotAfter
	}
	if role == AgentServer || role == CoreServiceServer {
		template.ExtKeyUsage = []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}
		template.DNSNames = []string{scope.commonName(role)}
	} else {
		template.ExtKeyUsage = []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth}
	}
	// Keep legacy Agent/Core URI SANs while adding the full installation and
	// instance scope required for native peer verification.
	if role == AgentServer || role == CoreClient {
		legacyRole := "agent"
		if role == CoreClient {
			legacyRole = "core"
			template.DNSNames = []string{scope.commonName(role)}
		}
		legacy, _ := url.Parse(fmt.Sprintf("spiffe://piwork/work/%s/generation/%d/%s", scope.WorkID, scope.Generation, legacyRole))
		template.URIs = append(template.URIs, legacy)
	}
	return makePair(template, ca, key)
}

func verifyRole(cert *x509.Certificate, scope Scope, role string) error {
	if cert == nil || cert.IsCA || cert.Subject.CommonName != scope.commonName(role) || scope.commonName(role) == "" {
		return ErrIdentity
	}
	scoped := 0
	for _, uri := range cert.URIs {
		if strings.HasPrefix(uri.String(), "spiffe://piwork/installation/") {
			scoped++
			if uri.String() != scope.URI(role) {
				return ErrIdentity
			}
		}
	}
	if scoped != 1 {
		return ErrIdentity
	}
	if role == AgentServer || role == CoreServiceServer {
		if cert.VerifyHostname(scope.commonName(role)) != nil {
			return ErrIdentity
		}
	}
	return nil
}

// AuthorizeServicePeer is also called on every RPC, so a previously established
// TLS connection loses authorization when its durable runtime becomes stale.
// TLS chain, validity, and clientAuth verification precede this identity check.
func AuthorizeServicePeer(cert *x509.Certificate, installation string, active func(Scope) bool) (Scope, error) {
	if cert == nil || cert.Subject.CommonName != AgentServiceClient {
		return Scope{}, ErrIdentity
	}
	var value string
	for _, uri := range cert.URIs {
		if strings.HasPrefix(uri.String(), "spiffe://piwork/installation/") {
			if value != "" {
				return Scope{}, ErrIdentity
			}
			value = uri.String()
		}
	}
	u, err := url.Parse(value)
	if err != nil || u.Scheme != "spiffe" || u.Host != "piwork" || u.RawQuery != "" || u.Fragment != "" || u.User != nil {
		return Scope{}, ErrIdentity
	}
	parts := strings.Split(strings.TrimPrefix(u.Path, "/"), "/")
	if len(parts) != 10 || parts[0] != "installation" || parts[2] != "work" || parts[4] != "generation" || parts[6] != "instance" || parts[8] != "role" || parts[9] != AgentServiceClient {
		return Scope{}, ErrIdentity
	}
	generation, err := strconv.ParseInt(parts[5], 10, 64)
	scope := Scope{InstallationID: parts[1], WorkID: parts[3], Generation: generation, InstanceID: parts[7]}
	if err != nil || !scope.valid(true) || scope.InstallationID != installation || verifyRole(cert, scope, AgentServiceClient) != nil || scope.URI(AgentServiceClient) != value {
		return Scope{}, ErrIdentity
	}
	if active == nil || !active(scope) {
		return Scope{}, ErrStale
	}
	return scope, nil
}

func certificatePair(pair keyPair) (tls.Certificate, error) {
	cert, err := tls.X509KeyPair([]byte(pair.Certificate), []byte(pair.PrivateKey))
	if err != nil {
		return tls.Certificate{}, ErrMaterial
	}
	return cert, nil
}
