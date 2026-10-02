package cli

import (
	"errors"
	"strings"
)

type workCreateOptions struct {
	name, baseImage, agentsPath, configPath, key string
	skills, packages                             []string
	skillsPresent, packagesPresent, wait         bool
}

func parseWorkCreateOptions(args []string) (workCreateOptions, error) {
	invalid := errors.New("invalid work create arguments; run piwork-cli --help")
	cmd := workCreateOptions{}
	seen := map[string]bool{}
	skillNames, packageNames := map[string]bool{}, map[string]bool{}
	for i := 0; i < len(args); i++ {
		flag := args[i]
		if flag == "--wait" || flag == "--no-skills" || flag == "--no-packages" {
			if seen[flag] {
				return cmd, invalid
			}
			seen[flag] = true
			switch flag {
			case "--wait":
				cmd.wait = true
			case "--no-skills":
				if len(cmd.skills) > 0 {
					return cmd, invalid
				}
				cmd.skillsPresent = true
				cmd.skills = []string{}
			case "--no-packages":
				if len(cmd.packages) > 0 {
					return cmd, invalid
				}
				cmd.packagesPresent = true
				cmd.packages = []string{}
			}
			continue
		}
		if flag != "--name" && flag != "--base-image" && flag != "--agents-md-file" && flag != "--config" && flag != "--idempotency-key" && flag != "--skill" && flag != "--package" {
			return cmd, invalid
		}
		if flag != "--skill" && flag != "--package" && seen[flag] {
			return cmd, invalid
		}
		if i+1 >= len(args) || args[i+1] == "" || strings.HasPrefix(args[i+1], "--") {
			return cmd, invalid
		}
		seen[flag] = true
		i++
		value := args[i]
		switch flag {
		case "--name":
			cmd.name = value
		case "--base-image":
			cmd.baseImage = value
		case "--agents-md-file":
			cmd.agentsPath = value
		case "--config":
			cmd.configPath = value
		case "--idempotency-key":
			cmd.key = value
		case "--skill":
			if seen["--no-skills"] || skillNames[value] || len(cmd.skills) >= 64 {
				return cmd, invalid
			}
			skillNames[value] = true
			cmd.skillsPresent = true
			cmd.skills = append(cmd.skills, value)
		case "--package":
			if seen["--no-packages"] || packageNames[value] || len(cmd.packages) >= 64 || len(value) > 214 || !packageNamePattern.MatchString(value) {
				return cmd, invalid
			}
			packageNames[value] = true
			cmd.packagesPresent = true
			cmd.packages = append(cmd.packages, value)
		}
	}
	if cmd.name == "" || seen["--no-skills"] && len(cmd.skills) > 0 || seen["--no-packages"] && len(cmd.packages) > 0 {
		return cmd, invalid
	}
	return cmd, nil
}
