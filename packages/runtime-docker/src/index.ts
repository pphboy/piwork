export interface RuntimeResourceIdentity {
  readonly installationId: string;
  readonly workId: string;
  readonly kind: "agent" | "service" | "network" | "volume";
}

export * from "./docker.js";

export {
  INSTALLATION_LABEL,
  assertTestInstallationId,
  installationLabel,
  installationLabelFilter,
} from "./testing.js";
