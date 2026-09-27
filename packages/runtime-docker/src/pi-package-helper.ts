import { isAbsolute, normalize } from "node:path";

export const PI_PACKAGE_JOB_LABEL = "piwork.pi_package_job_id";

export interface PiPackageHelperSpec {
  readonly installationId: string;
  readonly jobId: string;
  readonly name: string;
  readonly imageId: string;
  readonly volumeName: string;
  readonly action: "init" | "prepare" | "capture";
  readonly sourceDirectory?: string;
  readonly spoolDirectory?: string;
  readonly networkName?: string;
}

function validIdentity(value: string): boolean { return /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(value); }
function validBind(path: string | undefined): boolean { return path !== undefined && isAbsolute(path) && normalize(path) === path && path !== "/" && !/[,\x00\r\n]/.test(path); }

/** All mounts and execution limits are Core-authored, never supplied by package metadata. */
export function piPackageHelperCreateArgs(spec: PiPackageHelperSpec): string[] {
  if (!/^sha256:[a-f0-9]{64}$/.test(spec.imageId)) throw new TypeError("Package helper requires immutable image identity");
  if (![spec.name, spec.installationId, spec.jobId, spec.volumeName].every(validIdentity)) throw new TypeError("Invalid package helper identity");
  if (spec.action === "prepare" ? !validBind(spec.sourceDirectory) || spec.spoolDirectory !== undefined || !validIdentity(spec.networkName ?? "")
    : spec.action === "capture" ? !validBind(spec.spoolDirectory) || spec.sourceDirectory !== undefined || spec.networkName !== undefined
    : spec.action === "init" ? spec.sourceDirectory !== undefined || spec.spoolDirectory !== undefined || spec.networkName !== undefined
    : true) throw new TypeError("Invalid package helper action or mounts");
  return ["container", "create", "--name", spec.name,
    "--label", `piwork.installation_id=${spec.installationId}`, "--label", "piwork.managed=true",
    "--label", `${PI_PACKAGE_JOB_LABEL}=${spec.jobId}`, "--label", "piwork.resource_kind=pi-package-helper",
    "--network", spec.action === "prepare" ? spec.networkName! : "none", "--read-only",
    "--user", spec.action === "prepare" ? "10001:10001" : "0:0", "--cap-drop", "ALL",
    ...(spec.action === "init" ? ["--cap-add", "CHOWN"] : spec.action === "capture" ? ["--cap-add", "DAC_OVERRIDE", "--cap-add", "DAC_READ_SEARCH"] : []),
    "--security-opt", "no-new-privileges", "--cpus", spec.action === "prepare" ? "2" : "1",
    "--memory", spec.action === "prepare" ? "2g" : "512m", "--pids-limit", spec.action === "prepare" ? "256" : "64",
    ...(spec.action === "prepare" ? ["--tmpfs", "/tmp:rw,noexec,nosuid,size=256m", "--env", "HOME=/package/work/home", "--env", "NPM_CONFIG_CACHE=/package/work/npm-cache"] : []),
    "--mount", `type=volume,source=${spec.volumeName},target=/package/work${spec.action === "capture" ? ",readonly" : ""}`,
    ...(spec.sourceDirectory === undefined ? [] : ["--mount", `type=bind,source=${spec.sourceDirectory},target=/package/source,readonly`]),
    ...(spec.spoolDirectory === undefined ? [] : ["--mount", `type=bind,source=${spec.spoolDirectory},target=/package/spool`]),
    "--entrypoint", "node", spec.imageId, "/workspace/apps/package-helper/dist/main.js", spec.action];
}
