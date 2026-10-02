package coreassets

import (
	"crypto/sha256"
	"encoding/hex"
	"testing"
)

func TestDeploymentSkillEmbedsCompleteManagedTree(t *testing.T) {
	files, identity, err := DeploymentSkill()
	if err != nil || len(files) != 3 || len(identity) != len("sha256:")+64 {
		t.Fatal("built-in Skill is incomplete", err, len(files), identity)
	}
	expected := map[string]string{
		"SKILL.md":                "a5480767e602fe79cf48d4ee17cb9272b6d2e113b25d43eaf576bfd056a05262",
		"reference.md":            "2ee74e508930f8ee0a784903b526ecb740553bdb3a1ac8715e5f2a595d742b01",
		"examples/python-http.md": "ca7fdcf8c2e1fffb21e80a4a0624eedbb2146c61fe200697b11d70be418b7c51",
	}
	for _, file := range files {
		digest := sha256.Sum256(file.Data)
		if hex.EncodeToString(digest[:]) != expected[file.Path] {
			t.Fatal("Go binary Skill drifted from the accepted product asset", file.Path)
		}
	}
}
