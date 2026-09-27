import { isAbsolute, normalize } from "node:path";

export const SNAPSHOT_JOB_LABEL = "piwork.snapshot_job_id";
export interface SnapshotHelperSpec {
  readonly installationId: string;
  readonly jobId: string;
  readonly name: string;
  /** Operator-resolved immutable identity, never taken from a package. */
  readonly imageId: string;
  /** Core-resolved staging directory, never taken from a request. */
  readonly spoolDirectory: string;
  readonly volumeName?: string;
  readonly action: "capture" | "restore" | "restore-context" | "restore-package" | "verify-history" | "restore-history" | "verify-package";
  /** The Core process uid:gid, used only by a no-capabilities upload verifier. */
  readonly spoolUser?: string;
  readonly treeDigest?: string;
  readonly contextKey?: string;
  readonly packageKey?: string;
}

/** Only the trusted helper can receive restoration capabilities; user runtime specs are unchanged. */
export function snapshotHelperCreateArgs(spec: SnapshotHelperSpec): string[] {
  if (!/^sha256:[a-f0-9]{64}$/.test(spec.imageId)) throw new TypeError("Snapshot helper requires a captured image identity");
  for (const value of [spec.name, spec.installationId, spec.jobId, ...(spec.volumeName === undefined ? [] : [spec.volumeName])]) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(value)) throw new TypeError("Invalid helper resource identity");
  }
  if (!isAbsolute(spec.spoolDirectory) || normalize(spec.spoolDirectory) !== spec.spoolDirectory || /[,\x00\r\n]/.test(spec.spoolDirectory) || spec.spoolDirectory === "/") throw new TypeError("Invalid helper staging directory");
  if (!(["capture", "restore", "restore-context", "restore-package", "verify-history", "restore-history", "verify-package"] as readonly string[]).includes(spec.action)
    || (!["restore", "restore-context", "restore-package"].includes(spec.action) && spec.treeDigest !== undefined)
    || (["restore", "restore-context", "restore-package"].includes(spec.action) && !/^[a-f0-9]{64}$/.test(spec.treeDigest ?? ""))
    || (["restore-context", "restore-package"].includes(spec.action) ? !/^[a-z][a-z0-9-]{0,63}$/.test(spec.contextKey ?? "") : spec.contextKey !== undefined)
    || (spec.action === "restore-package" ? !/^[a-f0-9]{64}$/.test(spec.packageKey ?? "") : spec.packageKey !== undefined)) throw new TypeError("Invalid helper action");
  const upload = spec.action === "verify-package";
  const noVolume = upload || spec.action === "restore-context" || spec.action === "restore-package";
  if (noVolume !== (spec.volumeName === undefined)
    || (upload ? !/^[0-9]+:[0-9]+$/.test(spec.spoolUser ?? "") : spec.spoolUser !== undefined)) throw new TypeError("Invalid helper mounts or user");
  const readOnlyVolume = spec.action === "capture" || spec.action === "verify-history";
  return ["create", "--name", spec.name,
    "--label", `piwork.installation_id=${spec.installationId}`, "--label", "piwork.managed=true",
    "--label", `${SNAPSHOT_JOB_LABEL}=${spec.jobId}`, "--label", "piwork.resource_kind=snapshot-helper",
    "--network", "none", "--read-only", "--user", upload ? spec.spoolUser! : "0:0", "--cap-drop", "ALL",
    ...(upload ? [] : ["--cap-add", "CHOWN", "--cap-add", "FOWNER", "--cap-add", "DAC_OVERRIDE", "--cap-add", "DAC_READ_SEARCH"]),
    "--security-opt", "no-new-privileges", "--cpus", "1", "--memory", "512m", "--pids-limit", "64",
    ...(noVolume ? [] : ["--mount", `type=volume,source=${spec.volumeName},target=/snapshot/volume${readOnlyVolume ? ",readonly" : ""}`]),
    "--mount", `type=bind,source=${spec.spoolDirectory},target=/snapshot/spool`,
    "--entrypoint", "node", spec.imageId, "/workspace/apps/snapshot-helper/dist/main.js", spec.action,
    ...(spec.treeDigest === undefined ? [] : [spec.treeDigest]),
    ...(spec.contextKey === undefined ? [] : [spec.contextKey]),
    ...(spec.packageKey === undefined ? [] : [spec.packageKey]),
  ];
}
