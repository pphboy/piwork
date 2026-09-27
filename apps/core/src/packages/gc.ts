import { lstat, readdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { CoreStore } from "@piwork/core-store";

/** Remove expired, unleased source ZIPs while retaining upload tombstones for safe errors. */
export async function collectPiPackageUploadGarbage(store: CoreStore, dataDirectory: string, now = new Date()): Promise<void> {
  store.packages.expireUploads(now.toISOString());
  const directory = join(dataDirectory, "pi-packages", "uploads");
  for (const upload of store.packages.listExpiredUploads()) {
    await rm(join(directory, `${upload.id}.zip`), { force: true });
  }
}

/** Run during Core recovery, before admitting new work, so filesystem deletion cannot race publication. */
export async function collectPiPackageArtifactGarbage(store: CoreStore, dataDirectory: string, now = new Date()): Promise<void> {
  if (store.packages.listJobs(true).length > 0) return;
  const directory = resolve(dataDirectory, "pi-packages", "artifacts");
  const cutoffMs = now.getTime() - 24 * 60 * 60 * 1000;
  const paths = store.packages.retireUnreferencedCoreArtifacts(new Date(cutoffMs).toISOString());
  for (const path of paths) if (dirname(resolve(path)) === directory) await rm(path, { recursive: true, force: true });
  const referenced = new Set(store.packages.listCoreArtifactStoragePaths().map((path) => resolve(path)));
  let names: string[];
  try { names = await readdir(directory); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  for (const name of names) {
    if (!/^[a-f0-9]{64}(?:\.stage-[A-Za-z0-9-]+)?$/.test(name)) continue;
    const path = join(directory, name);
    if (referenced.has(path)) continue;
    const info = await lstat(path);
    if (info.mtimeMs <= cutoffMs) await rm(path, { recursive: true, force: true });
  }
}
