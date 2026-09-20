export const INSTALLATION_LABEL = "piwork.installation_id";

const TEST_INSTALLATION_ID = /^piwork-test-[0-9a-f]{8}-[0-9a-f-]{27}$/i;

export function assertTestInstallationId(value: string): string {
  if (!TEST_INSTALLATION_ID.test(value)) {
    throw new Error(`refusing Docker test operation outside a generated installation_id: ${value}`);
  }
  return value;
}

export function installationLabel(installationId: string): Readonly<Record<string, string>> {
  return { [INSTALLATION_LABEL]: assertTestInstallationId(installationId) };
}

export function installationLabelFilter(installationId: string): string {
  return `label=${INSTALLATION_LABEL}=${assertTestInstallationId(installationId)}`;
}
