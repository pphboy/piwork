package coreapp

import (
	"database/sql"

	"piwork/internal/contracts"
)

func validateSelectedSkillsTx(tx *sql.Tx, skills contracts.SkillSelection) error {
	if len(skills) > 128 {
		return contracts.NewError("INVALID_REQUEST", "skills")
	}
	seen := make(map[contracts.SkillName]struct{}, len(skills))
	for _, skill := range skills {
		if _, duplicate := seen[skill]; duplicate {
			return contracts.NewError("INVALID_REQUEST", "skills")
		}
		seen[skill] = struct{}{}
		var enabled bool
		if err := tx.QueryRow(`SELECT enabled FROM catalog_entries WHERE kind='skill' AND name=?`, skill).Scan(&enabled); err != nil || !enabled {
			return contracts.NewError("CONFLICT", "skills")
		}
	}
	return nil
}
