import { createHash } from "node:crypto";
import type { WorkConfig } from "@piwork/contracts";
import { CoreStore, type ArtifactBindingRecord, type CatalogEntryRecord } from "@piwork/core-store";

export class ArtifactPreparationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArtifactPreparationError";
  }
}

export interface ResolvedImage {
  readonly digest: string;
  readonly entrypoint: readonly string[];
}

export interface ArtifactResolver {
  resolveImage(reference: string): Promise<ResolvedImage>;
  readSkill(reference: string): Promise<Uint8Array>;
}

export interface PreparedArtifacts {
  readonly workId: string;
  readonly revision: number;
  readonly image: ArtifactBindingRecord;
  readonly skills: readonly ArtifactBindingRecord[];
}

export class ArtifactPreparationService {
  constructor(
    private readonly store: CoreStore,
    private readonly resolver: ArtifactResolver,
  ) {}

  async prepare(workId: string, revision: number): Promise<PreparedArtifacts> {
    const existing = this.store.listWorkConfigArtifactBindings(workId, revision);
    if (existing.length > 0) return prepared(workId, revision, existing);

    const revisionRecord = this.store.getWorkConfigRevision(workId, revision);
    if (revisionRecord === undefined) throw new ArtifactPreparationError(`Work configuration ${workId}@${revision} was not found`);
    const config = JSON.parse(revisionRecord.configJson) as WorkConfig;

    const imageCatalog = this.requiredCatalog(config.agentImage.catalogId, "agent_image");
    const imageReference = imageCatalog.mutableReference ?? imageCatalog.resolvedDigest;
    if (imageReference === null) throw new ArtifactPreparationError(`agent image ${imageCatalog.id} has no source reference`);
    const image = await this.resolver.resolveImage(imageReference);
    validateDigest(image.digest, `agent image ${imageCatalog.id}`);
    if (image.entrypoint[0] !== "piwork-agentd") {
      throw new ArtifactPreparationError(`agent image ${imageCatalog.id} has incompatible entrypoint`);
    }

    const skills: Array<{ catalogId: string; digest: string }> = [];
    for (const reference of config.skills) {
      const catalog = this.requiredCatalog(reference.catalogId, "skill");
      const expected = reference.digest ?? catalog.resolvedDigest;
      if (expected === null || expected === undefined) {
        throw new ArtifactPreparationError(`Skill ${catalog.id} has no fixed digest`);
      }
      const source = catalog.mutableReference ?? catalog.resolvedDigest;
      if (source === null) throw new ArtifactPreparationError(`Skill ${catalog.id} has no source reference`);
      const bytes = await this.resolver.readSkill(source);
      const actual = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
      if (actual !== expected) {
        throw new ArtifactPreparationError(`Skill ${catalog.id} digest mismatch: expected ${expected}, actual ${actual}`);
      }
      skills.push({ catalogId: catalog.id, digest: actual });
    }

    return prepared(
      workId,
      revision,
      this.store.bindWorkConfigArtifacts(
        workId,
        revision,
        { catalogId: imageCatalog.id, digest: image.digest },
        skills,
      ),
    );
  }

  private requiredCatalog(id: string, kind: CatalogEntryRecord["kind"]): CatalogEntryRecord {
    const catalog = this.store.getCatalogEntry(id);
    if (catalog === undefined || !catalog.enabled || catalog.kind !== kind) {
      throw new ArtifactPreparationError(`${kind} catalog entry ${id} is unavailable`);
    }
    return catalog;
  }
}

function prepared(workId: string, revision: number, bindings: readonly ArtifactBindingRecord[]): PreparedArtifacts {
  const image = bindings.find((binding) => binding.kind === "agent_image");
  if (image === undefined) throw new ArtifactPreparationError(`Work configuration ${workId}@${revision} has no image binding`);
  return {
    workId,
    revision,
    image,
    skills: bindings.filter((binding) => binding.kind === "skill").sort((a, b) => a.ordinal - b.ordinal),
  };
}

function validateDigest(digest: string, subject: string): void {
  if (!/^sha256:[a-f0-9]{64}$/.test(digest)) throw new ArtifactPreparationError(`${subject} returned an invalid digest`);
}
