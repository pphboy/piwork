import { randomUUID } from "node:crypto";
import { mkdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CoreStore, type CatalogEntryRecord, type CatalogKind } from "@piwork/core-store";
import type { UserPrincipal } from "../work-access/policy.js";

export class CatalogAdministrationError extends Error {
  constructor() {
    super("administrator permission is required");
    this.name = "CatalogAdministrationError";
  }
}

export class CatalogConflictError extends Error {
  constructor() {
    super("catalog or secret identifier already exists");
    this.name = "CatalogConflictError";
  }
}

export class CatalogSelectionError extends Error {
  constructor() {
    super("catalog entry is unavailable");
    this.name = "CatalogSelectionError";
  }
}

export interface PublicCatalogEntry {
  readonly id: string;
  readonly kind: CatalogKind;
  readonly name: string;
  readonly mutableReference: string | null;
  readonly resolvedDigest: string | null;
  readonly metadata: unknown;
  readonly enabled: boolean;
}

export interface PublicSecretReference {
  readonly id: string;
  readonly name: string;
  readonly available: boolean;
}

export class CatalogService {
  constructor(
    private readonly store: CoreStore,
    private readonly secretDirectory: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    mkdirSync(secretDirectory, { recursive: true, mode: 0o700 });
  }

  createCatalogEntry(
    principal: UserPrincipal,
    input: {
      readonly id?: string;
      readonly kind: CatalogKind;
      readonly name: string;
      readonly mutableReference?: string;
      readonly resolvedDigest?: string;
      readonly metadata?: unknown;
      readonly enabled?: boolean;
    },
  ): PublicCatalogEntry {
    assertAdmin(principal);
    const now = this.now().toISOString();
    const record: CatalogEntryRecord = {
      id: input.id ?? `${input.kind}-${randomUUID()}`,
      kind: input.kind,
      name: input.name,
      mutableReference: input.mutableReference ?? null,
      resolvedDigest: input.resolvedDigest ?? null,
      metadataJson: JSON.stringify(input.metadata ?? {}),
      enabled: input.enabled ?? true,
      createdAt: now,
      updatedAt: now,
    };
    try {
      this.store.createCatalogEntry(record);
    } catch (error) {
      if (error instanceof Error && /UNIQUE constraint failed/.test(error.message)) throw new CatalogConflictError();
      throw error;
    }
    return publicCatalogEntry(record);
  }

  listCatalog(principal: UserPrincipal): PublicCatalogEntry[] {
    return this.store.listCatalogEntries(principal.role !== "admin").map(publicCatalogEntry);
  }

  selectCatalogEntry(principal: UserPrincipal, id: string, expectedKind: CatalogKind): PublicCatalogEntry {
    const record = this.store.getCatalogEntry(id);
    if (record === undefined || record.kind !== expectedKind || (!record.enabled && principal.role !== "admin")) {
      throw new CatalogSelectionError();
    }
    return publicCatalogEntry(record);
  }

  createSecret(
    principal: UserPrincipal,
    input: { readonly name: string; readonly value: string; readonly ownerUserId?: string | null },
  ): PublicSecretReference {
    assertAdmin(principal);
    if (input.value.length === 0) throw new Error("secret value must not be empty");
    const id = `secret-${randomUUID()}`;
    const storagePath = join(this.secretDirectory, `${id}.secret`);
    writeFileSync(storagePath, input.value, { encoding: "utf8", flag: "wx", mode: 0o600 });
    try {
      this.store.createSecretReference({
        id,
        ownerUserId: input.ownerUserId ?? null,
        name: input.name,
        storagePath,
        now: this.now().toISOString(),
      });
    } catch (error) {
      unlinkSync(storagePath);
      if (error instanceof Error && /UNIQUE constraint failed/.test(error.message)) throw new CatalogConflictError();
      throw error;
    }
    return { id, name: input.name, available: statSync(storagePath).isFile() };
  }

  listSecrets(principal: UserPrincipal): PublicSecretReference[] {
    assertAdmin(principal);
    return this.store.listSecretReferences().map((record) => ({
      id: record.id,
      name: record.name,
      available: safeIsFile(record.storagePath),
    }));
  }
}

function publicCatalogEntry(record: CatalogEntryRecord): PublicCatalogEntry {
  return {
    id: record.id,
    kind: record.kind,
    name: record.name,
    mutableReference: record.mutableReference,
    resolvedDigest: record.resolvedDigest,
    metadata: JSON.parse(record.metadataJson) as unknown,
    enabled: record.enabled,
  };
}

function safeIsFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function assertAdmin(principal: UserPrincipal): void {
  if (principal.role !== "admin") throw new CatalogAdministrationError();
}
