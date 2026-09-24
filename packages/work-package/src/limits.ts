export const WORK_PACKAGE_LIMITS = Object.freeze({
  packageBytes: 100 * 1024 ** 3,
  restoredBytes: 100 * 1024 ** 3,
  metadataBytes: 64 * 1024 ** 2,
  totalMetadataBytes: 256 * 1024 ** 2,
  entries: 1_000_000,
  pathBytes: 4096,
  depth: 128,
  streamChunkBytes: 1024 ** 2,
});
export type WorkPackageLimits = { readonly [K in keyof typeof WORK_PACKAGE_LIMITS]: number };
