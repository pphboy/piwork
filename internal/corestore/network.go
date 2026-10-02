package corestore

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"regexp"
	"strings"
)

var uuidWorkID = regexp.MustCompile(`(?i)^work-([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})$`)
var dnsLabel = regexp.MustCompile(`^[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$`)
var invalidLabelCharacter = regexp.MustCompile(`[^a-z0-9-]`)

func identityHash(value string) string {
	valueHash := sha256.Sum256([]byte(value))
	return hex.EncodeToString(valueHash[:])
}

// Identity assignments run inside the Work/service acceptance transaction and
// remain reserved after tombstoning. Display names never become DNS authority.
func AssignWorkNetworkName(tx *sql.Tx, workID, now string) (string, error) {
	if err := AssertWorkMutable(tx, workID); err != nil {
		return "", err
	}
	var current string
	err := tx.QueryRow(`SELECT name FROM work_network_names WHERE work_id=?`, workID).Scan(&current)
	if err == nil {
		return current, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return "", err
	}
	suffix := identityHash(workID)
	identity := suffix
	if parts := uuidWorkID.FindStringSubmatch(workID); parts != nil {
		identity = strings.ToLower(strings.Join(parts[1:], ""))
	}
	var candidates []string
	for length := 8; length <= 32; length += 4 {
		candidates = append(candidates, "w-"+identity[:length])
	}
	for length := 4; length <= 28; length += 4 {
		candidates = append(candidates, "w-"+identity[:32]+suffix[:length])
	}
	for _, name := range candidates {
		result, err := tx.Exec(`INSERT INTO work_network_names(work_id,name,created_at) VALUES(?,?,?) ON CONFLICT DO NOTHING`, workID, name, nowTimestamp(now))
		if err != nil {
			return "", err
		}
		count, err := result.RowsAffected()
		if err != nil {
			return "", err
		}
		if count == 1 {
			return name, nil
		}
		if err := tx.QueryRow(`SELECT name FROM work_network_names WHERE work_id=?`, workID).Scan(&current); err == nil {
			return current, nil
		} else if !errors.Is(err, sql.ErrNoRows) {
			return "", err
		}
	}
	return "", ErrStorage
}
func AssignServiceDomainLabel(tx *sql.Tx, workID, serviceID, name, now string) (string, error) {
	if err := AssertWorkMutable(tx, workID); err != nil {
		return "", err
	}
	var current string
	err := tx.QueryRow(`SELECT label FROM service_domain_labels WHERE work_id=? AND service_id=?`, workID, serviceID).Scan(&current)
	if err == nil {
		return current, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return "", err
	}
	normalized := strings.ToLower(name)
	suffix := identityHash(serviceID)
	var candidates []string
	if dnsLabel.MatchString(normalized) {
		candidates = append(candidates, normalized)
	}
	base := strings.TrimLeft(invalidLabelCharacter.ReplaceAllString(strings.TrimRight(normalized, "-"), "-"), "-")
	if base == "" {
		base = "service"
	}
	for length := 8; length <= 64; length += 4 {
		headLength := 62 - length
		if headLength < 0 {
			continue
		}
		head := base
		if len(head) > headLength {
			head = head[:headLength]
		}
		head = strings.TrimRight(head, "-")
		if head == "" {
			head = "s"
		}
		label := head + "-" + suffix[:length]
		if dnsLabel.MatchString(label) {
			candidates = append(candidates, label)
		}
	}
	for _, label := range candidates {
		result, err := tx.Exec(`INSERT INTO service_domain_labels(work_id,service_id,label,created_at) VALUES(?,?,?,?) ON CONFLICT DO NOTHING`, workID, serviceID, label, nowTimestamp(now))
		if err != nil {
			return "", err
		}
		count, err := result.RowsAffected()
		if err != nil {
			return "", err
		}
		if count == 1 {
			return label, nil
		}
		if err := tx.QueryRow(`SELECT label FROM service_domain_labels WHERE work_id=? AND service_id=?`, workID, serviceID).Scan(&current); err == nil {
			return current, nil
		} else if !errors.Is(err, sql.ErrNoRows) {
			return "", err
		}
	}
	return "", ErrStorage
}
