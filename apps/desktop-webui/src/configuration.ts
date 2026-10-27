import type { Configuration } from './models.js';
import { t } from './locale.js';

type PublicConfiguration = Record<string, any>;
function validate(value: unknown): asserts value is PublicConfiguration {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(t('d.config.objectRequired'));
  const raw = value as PublicConfiguration;
  if (raw.skills !== undefined && (!Array.isArray(raw.skills) || raw.skills.some((s: unknown) => typeof s !== 'string'))) throw new Error(t('d.config.skillsShape'));
  if (raw.packages !== undefined && (!Array.isArray(raw.packages) || raw.packages.some((p: any) => !p || typeof p.name !== 'string' || typeof p.enabled !== 'boolean'))) throw new Error(t('d.config.packagesShape'));
  if (raw.agentsMd !== undefined && typeof raw.agentsMd !== 'string') throw new Error(t('d.config.agentsMdText'));
}
/** Advanced text may be temporarily invalid. Commit it before leaving its editor
 * or saving; otherwise the simple forms update the same complete public object. */
export function synchronizeConfiguration(config: Configuration): PublicConfiguration {
  const parsed: unknown = JSON.parse(config.advanced);
  validate(parsed);
  if (config.advancedDirty) {
    config.skills = [...(parsed.skills ?? [])];
    config.packages = (parsed.packages ?? []).map((p: any) => ({ ...p, source: 'Saved Work copy' })); // i18n-exempt: configuration protocol value, not display text
    config.agents = parsed.agentsMd ?? '';
  } else {
    parsed.skills = [...config.skills];
    parsed.packages = config.packages.map(({ source: _source, ...p }) => p);
    parsed.agentsMd = config.agents;
  }
  config.advanced = JSON.stringify(parsed, null, 2);
  config.advancedDirty = false;
  config.validationError = '';
  return parsed;
}
export function editAdvanced(config: Configuration, text: string) {
  config.advanced = text;
  config.advancedDirty = true;
  try { const value: unknown = JSON.parse(text); validate(value); config.validationError = ''; }
  catch (error) { config.validationError = error instanceof Error ? error.message : String(error); }
}
