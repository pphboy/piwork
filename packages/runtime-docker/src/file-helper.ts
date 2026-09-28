export const FILE_JOB_LABEL = "piwork.file_job_id";
export const FILE_EPOCH_LABEL = "piwork.file_epoch";
export const FILE_ATTEMPT_LABEL = "piwork.file_attempt_id";

export interface FileHelperSpec {
  readonly installationId: string;
  readonly workId: string;
  readonly jobId: string;
  readonly attemptId: string;
  readonly epoch: number;
  readonly name: string;
  readonly imageId: string;
  readonly volumeName: string;
  readonly readOnly: boolean;
}

function validIdentity(value: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(value);
}

/** No user-selectable bind, network, image, entrypoint or extra volume is accepted. */
export function fileHelperCreateArgs(spec: FileHelperSpec): string[] {
  if (![spec.installationId, spec.workId, spec.jobId, spec.attemptId, spec.name, spec.volumeName].every(validIdentity)
    || !/^sha256:[a-f0-9]{64}$/.test(spec.imageId)
    || !Number.isSafeInteger(spec.epoch) || spec.epoch < 1) throw new TypeError("Invalid file helper identity");
  return ["container", "create", "--interactive", "--name", spec.name,
    "--label", `piwork.installation_id=${spec.installationId}`,
    "--label", "piwork.managed=true",
    "--label", `piwork.work_id=${spec.workId}`,
    "--label", "piwork.resource_kind=file-helper",
    "--label", `${FILE_JOB_LABEL}=${spec.jobId}`,
    "--label", `${FILE_EPOCH_LABEL}=${spec.epoch}`,
    "--label", `${FILE_ATTEMPT_LABEL}=${spec.attemptId}`,
    "--network", "none", "--read-only", "--user", "10001:10001", "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges", "--cpus", "0.5", "--memory", "128m", "--pids-limit", "32",
    "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=16m,mode=1777",
    "--mount", `type=volume,source=${spec.volumeName},target=/workspace${spec.readOnly ? ",readonly" : ""}`,
    "--entrypoint", "python3", spec.imageId,
    "-B", "/opt/piwork/file-helper/main.py",
    "--job-id", spec.jobId, "--work-id", spec.workId, "--epoch", String(spec.epoch)];
}
