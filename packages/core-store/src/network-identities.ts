import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

const uuidWorkId = /^work-([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})$/i;
const dnsLabel = /^[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function uniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/.test(error.message);
}

/** Called inside the caller's write transaction. Identity rows intentionally survive tombstones. */
export function assignWorkNetworkName(database: DatabaseSync, workId: string, now: string): string {
  const existing = database.prepare("SELECT name FROM work_network_names WHERE work_id = ?").get(workId) as { name: string } | undefined;
  if (existing) return existing.name;
  const uuid = uuidWorkId.exec(workId);
  const identity = uuid ? uuid.slice(1).join("").toLowerCase() : hash(workId);
  const suffix = hash(workId);
  const candidates: string[] = [];
  for (let length = 8; length <= 32; length += 4) candidates.push(`w-${identity.slice(0, length)}`);
  for (let length = 4; length <= 28; length += 4) candidates.push(`w-${identity.slice(0, 32)}${suffix.slice(0, length)}`);
  for (const name of candidates) {
    try {
      database.prepare("INSERT INTO work_network_names(work_id, name, created_at) VALUES (?, ?, ?)").run(workId, name, now);
      return name;
    } catch (error) {
      if (!uniqueViolation(error)) throw error;
      const previous = database.prepare("SELECT name FROM work_network_names WHERE work_id = ?").get(workId) as { name: string } | undefined;
      if (previous) return previous.name;
    }
  }
  throw new Error(`No unique network name can be assigned to Work ${workId}`);
}

/** Called inside the caller's write transaction. Never changes a previously assigned label. */
export function assignServiceDomainLabel(database: DatabaseSync, workId: string, serviceId: string, name: string, now: string): string {
  const existing = database.prepare("SELECT label FROM service_domain_labels WHERE work_id = ? AND service_id = ?")
    .get(workId, serviceId) as { label: string } | undefined;
  if (existing) return existing.label;
  const normalized = name.toLowerCase();
  const suffix = hash(serviceId);
  const candidates = dnsLabel.test(normalized) && normalized.length <= 63 ? [normalized] : [];
  const base = normalized.replace(/-+$/, "").replace(/[^a-z0-9-]/g, "-").replace(/^-+/, "") || "service";
  for (let length = 8; length <= 64; length += 4) {
    const tail = suffix.slice(0, length);
    const head = base.slice(0, 62 - tail.length).replace(/-+$/, "") || "s";
    candidates.push(`${head}-${tail}`);
  }
  for (const label of candidates) {
    if (!dnsLabel.test(label) || label.length > 63) continue;
    try {
      database.prepare("INSERT INTO service_domain_labels(work_id, service_id, label, created_at) VALUES (?, ?, ?, ?)")
        .run(workId, serviceId, label, now);
      return label;
    } catch (error) {
      if (!uniqueViolation(error)) throw error;
      const previous = database.prepare("SELECT label FROM service_domain_labels WHERE work_id = ? AND service_id = ?")
        .get(workId, serviceId) as { label: string } | undefined;
      if (previous) return previous.label;
    }
  }
  throw new Error(`No unique domain label can be assigned to service ${serviceId}`);
}
