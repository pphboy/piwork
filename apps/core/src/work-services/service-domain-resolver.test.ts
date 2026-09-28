import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CoreStore } from "@piwork/core-store";
import { normalizeServiceHostname, ServiceAccessError, ServiceDomainResolver } from "./service-domain-resolver.js";

const now = "2026-09-20T00:00:00Z", workId = "work-a1b2c3d4-0000-4000-8000-000000000001";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "piwork-domain-"));
  const store = CoreStore.open({ databasePath: join(root, "core.sqlite") });
  store.exec(`INSERT INTO users VALUES ('owner','owner','digest','user',1,'${now}','${now}');
    INSERT INTO works(id,owner_user_id,name,desired_state,observed_state,desired_revision,control_version,created_at,updated_at)
    VALUES ('${workId}','owner','笔记项目','running','ready',1,1,'${now}','${now}')`);
  store.assignWorkNetworkName(workId, now);
  const resolver = new ServiceDomainResolver(store, async () => ({ exists: true, running: true }));
  const add = (serviceId: string, name: string, ports: unknown[], readiness?: unknown) => {
    const definition = JSON.stringify({ name, ports, readiness });
    store.exec(`INSERT INTO service_heads VALUES ('${workId}','${serviceId}','${name}',1,1,1,'ready',NULL,NULL);
      INSERT INTO service_revisions VALUES ('${workId}','${serviceId}',1,'${definition.replace(/'/g, "''")}',NULL,'${now}')`);
    store.assignServiceDomainLabel(workId, serviceId, name, now);
  };
  return { store, resolver, add, close() { store.close(); rmSync(root, { recursive: true, force: true }); } };
}

test("default domain uses TCP 80 before HTTP readiness and retains explicit candidates", async () => {
  const f = fixture();
  try {
    f.add("service-1", "notes", [
      { name: "web", containerPort: 8000, protocol: "tcp" },
      { name: "home", containerPort: 80, protocol: "tcp" },
      { name: "dns", containerPort: 53, protocol: "udp" },
    ], { kind: "http", portName: "web", path: "/health" });
    const access = await f.resolver.describe(workId, "service-1");
    assert.equal(access.hostname, "notes.w-a1b2c3d4.work");
    assert.equal(access.defaultUrl, "http://notes.w-a1b2c3d4.work/");
    assert.equal(access.defaultPortName, "home");
    assert.equal(access.status, "available");
    assert.deepEqual(access.ports.map((item) => item.port), [80, 8000]);
    assert.equal((await f.resolver.resolveTarget(access.hostname, 80)).port, 80);
    assert.equal((await f.resolver.resolveTarget(access.hostname, 8000)).port, 8000);
    assert.equal(normalizeServiceHostname("NOTES.W-A1B2C3D4.WORK."), access.hostname);
    await assert.rejects(f.resolver.resolveTarget("notes.w-a1b2c3d4.work.evil", 80), (error) => error instanceof ServiceAccessError && error.code === "NOT_FOUND");
  } finally { f.close(); }
});

test("HTTP readiness supplies virtual 80; no default requires explicit TCP port", async () => {
  const f = fixture();
  try {
    f.add("service-1", "demo-", [{ name: "web", containerPort: 8000, protocol: "tcp" }], { kind: "http", portName: "web", path: "/health" });
    const first = await f.resolver.describe(workId, "service-1");
    assert.match(first.hostname, /^demo-[a-f0-9]{8}\.w-a1b2c3d4\.work$/);
    assert.equal(first.defaultPortName, "web");
    assert.equal((await f.resolver.resolveTarget(first.hostname, 80)).port, 8000);
    f.add("service-2", "api", [{ name: "api", containerPort: 9000, protocol: "tcp" }, { name: "dns", containerPort: 53, protocol: "udp" }]);
    const second = await f.resolver.describe(workId, "service-2");
    assert.equal(second.defaultUrl, null);
    assert.equal(second.status, "no-default-port");
    await assert.rejects(f.resolver.resolveTarget(second.hostname, 80), (error) => error instanceof ServiceAccessError && error.code === "PORT_REQUIRED");
    assert.equal((await f.resolver.resolveTarget(second.hostname, 9000)).port, 9000);
    f.add("service-3", "udp", [{ name: "dns", containerPort: 53, protocol: "udp" }]);
    const third = await f.resolver.describe(workId, "service-3");
    assert.deepEqual(third.ports, []);
    await assert.rejects(f.resolver.resolveTarget(third.hostname, 53), (error) => error instanceof ServiceAccessError && error.code === "PORT_NOT_DECLARED");
  } finally { f.close(); }
});
