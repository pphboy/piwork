package coreassets

import (
	"bytes"
	"embed"
	"io"
	"io/fs"
	"strings"

	"piwork/internal/contracts"
)

const DeploymentSkillName = "deploy-work-service"

//go:embed deploy-work-service
var deploymentSkill embed.FS

type SkillFile struct {
	Path string
	Data []byte
}

// DeploymentSkill is the complete managed deployment Skill, packaged into the
// native Core binary. There is no runtime dependency on the TS source tree.
func DeploymentSkill() ([]SkillFile, string, error) {
	files := make([]SkillFile, 0, 3)
	err := fs.WalkDir(deploymentSkill, DeploymentSkillName, func(name string, item fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if item.IsDir() {
			return nil
		}
		raw, err := deploymentSkill.ReadFile(name)
		if err != nil {
			return err
		}
		files = append(files, SkillFile{Path: strings.TrimPrefix(name, DeploymentSkillName+"/"), Data: raw})
		return nil
	})
	if err != nil {
		return nil, "", err
	}
	entries := make([]contracts.DigestEntry, 0, len(files))
	for _, file := range files {
		data := file.Data
		entries = append(entries, contracts.DigestEntry{Path: file.Path, Type: "file", Size: int64(len(data)), Open: func() (io.ReadCloser, error) { return io.NopCloser(bytes.NewReader(data)), nil }})
	}
	identity, err := contracts.SkillDigest(entries)
	if err != nil {
		return nil, "", err
	}
	return files, identity, nil
}
