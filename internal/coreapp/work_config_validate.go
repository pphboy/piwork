package coreapp

import (
	"context"
	"database/sql"
	"net/url"
	"strings"

	"piwork/internal/contracts"
)

// validateInitialWorkConfig checks relationships that WorkConfigSchema cannot
// express before image preparation or any durable Work state is created.
func (a *Application) validateInitialWorkConfig(ctx context.Context, ownerID string, config contracts.WorkConfig) error {
	return a.validateWorkConfig(ctx, ownerID, "", config)
}

func (a *Application) validateWorkConfig(ctx context.Context, ownerID, workID string, config contracts.WorkConfig) error {
	if len(config.AgentsMd) > 256<<10 {
		return contracts.NewError("INVALID_REQUEST", "agentsMd")
	}
	if config.Resources.AgentCpuMillis > config.Resources.CpuMillis || config.Resources.AgentMemoryBytes > config.Resources.MemoryBytes {
		return contracts.NewError("INVALID_REQUEST", "resources")
	}
	servers := make(map[string]struct{}, len(config.McpServers))
	for _, server := range config.McpServers {
		id := string(server.ServerId)
		if _, exists := servers[id]; exists {
			return contracts.NewError("INVALID_REQUEST", "mcpServers")
		}
		servers[id] = struct{}{}
		if id == "work-services" && (server.Transport != "stdio" || !server.Required || server.Command.Value != "/usr/local/bin/piwork-service-mcp" || server.Args.Present && len(server.Args.Value) != 0 || server.Url.Present || server.SecretRefs.Present && len(server.SecretRefs.Value) != 0 || server.RequiredServiceId.Present) {
			return contracts.NewError("INVALID_REQUEST", "mcpServers")
		}
		if server.RequiredServiceId.Present {
			if workID == "" {
				// A new Work has no accepted services to satisfy a dependency.
				return contracts.NewError("CONFLICT", "mcpServers")
			}
			var available bool
			err := a.Store.Read(ctx, func(tx *sql.Tx) error {
				return tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM service_heads WHERE work_id=? AND service_id=? AND tombstoned_at IS NULL)`, workID, server.RequiredServiceId.Value).Scan(&available)
			})
			if err != nil {
				return err
			}
			if !available {
				return contracts.NewError("CONFLICT", "mcpServers")
			}
		}
		if server.Transport == "stdio" {
			if !server.Command.Present || server.Url.Present {
				return contracts.NewError("INVALID_REQUEST", "mcpServers")
			}
		} else {
			if !server.Url.Present || server.Command.Present || server.Args.Present {
				return contracts.NewError("INVALID_REQUEST", "mcpServers")
			}
			parsed, err := url.Parse(server.Url.Value)
			if err != nil || parsed.Scheme == "" || parsed.Hostname() == "" || parsed.Scheme != "https" && parsed.Hostname() != "127.0.0.1" && parsed.Hostname() != "localhost" {
				return contracts.NewError("INVALID_REQUEST", "mcpServers")
			}
		}
		for _, reference := range server.SecretRefs.Value {
			var secretOwner sql.NullString
			err := a.Store.Read(ctx, func(tx *sql.Tx) error {
				return tx.QueryRowContext(ctx, `SELECT owner_user_id FROM secret_refs WHERE id=?`, reference.SecretId).Scan(&secretOwner)
			})
			if err == sql.ErrNoRows {
				return contracts.NewError("CONFLICT", "mcpServers")
			}
			if err != nil {
				return err
			}
			if secretOwner.Valid && secretOwner.String != ownerID {
				return contracts.NewError("PERMISSION_DENIED", "mcpServers")
			}
		}
	}
	tools := map[string]struct{}{"read": {}, "bash": {}, "edit": {}, "write": {}, "grep": {}, "find": {}, "ls": {}}
	for _, selected := range [][]contracts.WorkToolPolicyKey{config.Tools.Allowed, config.Tools.Denied} {
		for _, tool := range selected {
			name := string(tool)
			if strings.HasPrefix(name, "package:") {
				// Strict WorkToolPolicyKeySchema has already validated the
				// package/name/tool grammar. SDK enforces the selected resources.
				continue
			}
			if _, builtIn := tools[name]; builtIn {
				continue
			}
			prefix, _, qualified := strings.Cut(name, ".")
			if qualified {
				if _, configured := servers[prefix]; configured {
					continue
				}
			}
			return contracts.NewError("INVALID_REQUEST", "tools")
		}
	}
	return nil
}

func validateRequiredServicesTx(tx *sql.Tx, workID string, config contracts.WorkConfig) error {
	for _, server := range config.McpServers {
		if !server.RequiredServiceId.Present {
			continue
		}
		var available bool
		if err := tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM service_heads WHERE work_id=? AND service_id=? AND tombstoned_at IS NULL)`, workID, server.RequiredServiceId.Value).Scan(&available); err != nil {
			return err
		}
		if !available {
			return contracts.NewError("CONFLICT", "mcpServers")
		}
	}
	return nil
}

func validateWorkCapacityTx(tx *sql.Tx, workID string, config contracts.WorkConfig) error {
	var serviceCPU, serviceSlots int64
	err := tx.QueryRow(`SELECT COALESCE(SUM(MAX(desired_cpu_millis,occupied_cpu_millis)),0),
		COALESCE(SUM(service_slots),0)
		FROM quota_reservations WHERE work_id=? AND subject_kind='service'`, workID).Scan(&serviceCPU, &serviceSlots)
	if err != nil {
		return err
	}
	if config.Resources.AgentCpuMillis+serviceCPU > config.Resources.CpuMillis || config.Resources.AgentMemoryBytes > config.Resources.MemoryBytes {
		return contracts.NewError("INVALID_CONFIGURATION", "resources")
	}
	var services, volumes int64
	if err := tx.QueryRow(`SELECT count(*) FROM service_heads WHERE work_id=? AND tombstoned_at IS NULL`, workID).Scan(&services); err != nil {
		return err
	}
	if err := tx.QueryRow(`SELECT count(*) FROM volume_records WHERE work_id=? AND purged_at IS NULL`, workID).Scan(&volumes); err != nil {
		return err
	}
	if services > config.Resources.MaxServices || serviceSlots > config.Resources.MaxServices || volumes > config.Resources.MaxRetainedVolumes {
		return contracts.NewError("INVALID_CONFIGURATION", "resources")
	}
	return nil
}
