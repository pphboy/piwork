package coreapp

import (
	"context"
	"database/sql"
	"strings"
	"testing"
	"time"

	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/identity"
)

func TestInitialWorkConfigurationRejectsUnsafeRelationships(t *testing.T) {
	a, _, _ := appFixture(t, Options{})
	baseline := func() contracts.WorkConfig { return defaultWorkConfiguration(RuntimeProfile{Revision: 1}) }
	if err := a.validateInitialWorkConfig(context.Background(), "owner", baseline()); err != nil {
		t.Fatal("built-in configuration should be valid", err)
	}
	checks := []struct {
		name   string
		change func(*contracts.WorkConfig)
	}{
		{"agents byte limit", func(c *contracts.WorkConfig) { c.AgentsMd = strings.Repeat("中", 100_000) }},
		{"agent CPU budget", func(c *contracts.WorkConfig) { c.Resources.AgentCpuMillis = c.Resources.CpuMillis + 1 }},
		{"agent memory budget", func(c *contracts.WorkConfig) { c.Resources.AgentMemoryBytes = c.Resources.MemoryBytes + 1 }},
		{"duplicate MCP identity", func(c *contracts.WorkConfig) { c.McpServers = append(c.McpServers, c.McpServers[0]) }},
		{"reserved MCP substitution", func(c *contracts.WorkConfig) { c.McpServers[0].Command = contracts.Supplied("/bin/other") }},
		{"missing service dependency", func(c *contracts.WorkConfig) {
			c.McpServers[0].RequiredServiceId = contracts.Supplied(contracts.ResourceId("service-future"))
		}},
		{"unknown tool", func(c *contracts.WorkConfig) { c.Tools.Allowed = []contracts.WorkToolPolicyKey{"unknown"} }},
	}
	for _, check := range checks {
		t.Run(check.name, func(t *testing.T) {
			config := baseline()
			config.McpServers = append([]contracts.McpServer{}, config.McpServers...)
			check.change(&config)
			if err := a.validateInitialWorkConfig(context.Background(), "owner", config); err == nil {
				t.Fatal("invalid Work configuration passed relation validation")
			}
		})
	}
}

func TestSavedWorkConfigurationCanReferenceExistingService(t *testing.T) {
	a, _, _ := appFixture(t, Options{})
	ctx := context.Background()
	owner, err := a.Identity.CreateUser(ctx, identity.OperatorPrincipal(), "service-owner", "development-fixture-pass", "user")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		return corestore.InsertWork(tx, corestore.WorkRecord{ID: "work-service-dependency", OwnerUserID: string(owner.Id), Name: "Dependencies", DesiredState: "stopped", ObservedState: "stopped", DesiredRevision: 1, ControlVersion: 1, CreatedAt: now, UpdatedAt: now})
	}); err != nil {
		t.Fatal(err)
	}
	config := defaultWorkConfiguration(RuntimeProfile{Revision: 1})
	config.McpServers = append(config.McpServers, contracts.McpServer{ServerId: "custom", Transport: "stdio", Command: contracts.Supplied("/bin/custom"), RequiredServiceId: contracts.Supplied(contracts.ResourceId("service-dependency"))})
	if err := a.validateWorkConfig(ctx, string(owner.Id), "work-service-dependency", config); err == nil {
		t.Fatal("missing service dependency was accepted")
	}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec(`INSERT INTO service_heads(work_id,service_id,name,desired_revision,enabled,observed_state) VALUES(?,?,?,1,0,'stopped')`, "work-service-dependency", "service-dependency", "dependency")
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if err := a.validateWorkConfig(ctx, string(owner.Id), "work-service-dependency", config); err != nil {
		t.Fatal("accepted service dependency was rejected", err)
	}
	substituted := config
	substituted.McpServers = append([]contracts.McpServer{}, config.McpServers...)
	substituted.McpServers[0].RequiredServiceId = contracts.Supplied(contracts.ResourceId("service-dependency"))
	if err := a.validateWorkConfig(ctx, string(owner.Id), "work-service-dependency", substituted); err == nil {
		t.Fatal("built-in service MCP accepted a requiredServiceId once that service existed")
	}
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error { return validateRequiredServicesTx(tx, "work-service-dependency", config) }); err != nil {
		t.Fatal("transaction check rejected existing service", err)
	}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec(`UPDATE service_heads SET tombstoned_at=? WHERE work_id=? AND service_id=?`, now, "work-service-dependency", "service-dependency")
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error { return validateRequiredServicesTx(tx, "work-service-dependency", config) }); err == nil {
		t.Fatal("removed service dependency was accepted")
	}
}
