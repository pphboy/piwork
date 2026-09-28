export interface RuntimeResourceIdentity {
  readonly installationId: string;
  readonly workId: string;
  readonly kind: "agent" | "service" | "network" | "volume";
}

export * from "./docker.js";
export * from "./stream.js";
export * from "./snapshot-helper.js";
export * from "./file-helper.js";
export * from "./pi-package-helper.js";

export {
  INSTALLATION_LABEL,
  assertTestInstallationId,
  installationLabel,
  installationLabelFilter,
} from "./testing.js";
