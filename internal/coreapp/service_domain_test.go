package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"testing"

	"piwork/internal/contracts"
)

func TestServiceDomainIdentityAndDefaultPortSelection(t *testing.T) {
	a, actor, id := serviceAcceptFixture(t)
	ctx := context.Background()
	before, err := a.Store.Configuration(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	raw := json.RawMessage(`{"name":"notes","image":{"reference":"fixture/app"},"command":"app","workingDirectory":"/","ports":[{"name":"web","containerPort":8000,"protocol":"tcp"},{"name":"udp","containerPort":9000,"protocol":"udp"},{"name":"api","containerPort":8080,"protocol":"tcp"}],"readiness":{"kind":"http","portName":"api","path":"/health"}}`)
	accepted, err := a.acceptServiceDefinition(ctx, actor, id, "", 0, raw, "create")
	if err != nil {
		t.Fatal(err)
	}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		if _, err := tx.Exec(`UPDATE works SET desired_state='running',observed_state='degraded' WHERE id=?`, id); err != nil {
			return err
		}
		_, err := tx.Exec(`UPDATE service_heads SET observed_state='ready' WHERE work_id=?`, id)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	work, err := a.Store.Work(ctx, id, false)
	if err != nil {
		t.Fatal(err)
	}
	service, err := a.Store.Service(ctx, id, accepted.ServiceID, false)
	if err != nil {
		t.Fatal(err)
	}
	resolver := serviceDomainResolver{Store: a.Store, Inspect: func(context.Context, string, string) (bool, error) { return true, nil }}
	access, err := resolver.describe(ctx, work, service)
	if err != nil {
		t.Fatal(err)
	}
	if access.Status != "available" || access.DefaultURL == nil || access.DefaultPortName == nil || *access.DefaultPortName != "api" || !strings.HasPrefix(access.Hostname, "notes.w-") || len(access.Ports) != 2 || access.Ports[0].Port != 8000 {
		t.Fatal(access)
	}
	if port, err := selectedServicePort(service, nil); err != nil || port != 8080 {
		t.Fatal("default port", port, err)
	}
	port80 := int64(80)
	if port, err := selectedServicePort(service, &port80); err != nil || port != 8080 {
		t.Fatal("browser implicit 80", port, err)
	}
	udp := int64(9000)
	if _, err := selectedServicePort(service, &udp); err == nil {
		t.Fatal("UDP exposed as HTTP")
	}
	if _, _, err := resolver.lookup(ctx, strings.ToUpper(access.Hostname)+"."); err != nil {
		t.Fatal("normalized DNS lookup", err)
	}
	for _, invalid := range []string{"127.0.0.1", "http://" + access.Hostname, access.Hostname + ":8080", "notes.w-12345678.work.evil", " notes.w-12345678.work", "notes.w-12345678.work..", "笔记.w-12345678.work"} {
		if _, valid := normalizeServiceHostname(invalid); valid {
			t.Fatal("unsafe hostname", invalid)
		}
	}
	service.Enabled = false
	unavailable, err := resolver.describe(ctx, work, service)
	if err != nil || unavailable.Hostname != access.Hostname || unavailable.DefaultURL == nil || unavailable.Status != "unavailable" {
		t.Fatal("disabled domain changed", unavailable, err)
	}
	after, err := a.Store.Configuration(ctx, id)
	if err != nil || before.DesiredConfigJSON != after.DesiredConfigJSON {
		t.Fatal("Core identity polluted Work configuration", err)
	}
	var definition contracts.ServiceDefinition
	if json.Unmarshal([]byte(service.DefinitionJSON), &definition) != nil {
		t.Fatal("definition")
	}
	definition.Readiness = contracts.Field[contracts.ReadinessProbe]{}
	encoded, _ := json.Marshal(definition)
	service.DefinitionJSON = string(encoded)
	service.Enabled = true
	access, err = resolver.describe(ctx, work, service)
	if err != nil || access.Status != "no-default-port" || access.DefaultURL != nil {
		t.Fatal("ambiguous port invented default", access, err)
	}
	definition.Ports = []contracts.ServicePort{{Name: "datagrams", ContainerPort: 9000, Protocol: "udp"}}
	encoded, _ = json.Marshal(definition)
	service.DefinitionJSON = string(encoded)
	access, err = resolver.describe(ctx, work, service)
	if err != nil || len(access.Ports) != 0 || access.DefaultURL != nil || access.Status != "unavailable" {
		t.Fatal("UDP-only service was exposed as HTTP", access, err)
	}
	definition.Ports = []contracts.ServicePort{}
	encoded, _ = json.Marshal(definition)
	service.DefinitionJSON = string(encoded)
	access, err = resolver.describe(ctx, work, service)
	if err != nil || len(access.Ports) != 0 || access.DefaultURL != nil || access.Status != "unavailable" {
		t.Fatal("empty port service was exposed as HTTP", access, err)
	}
	definition.Ports = append(definition.Ports, contracts.ServicePort{Name: "plain", ContainerPort: 80, Protocol: "tcp"})
	encoded, _ = json.Marshal(definition)
	service.DefinitionJSON = string(encoded)
	port, err := selectedServicePort(service, nil)
	if err != nil || port != 80 {
		t.Fatal("port 80 was not preferred", port, err)
	}
}
