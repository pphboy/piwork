import { t } from './locale.js';

/** Display a confirmed Thinking level in the current interface language. */
export function thinkingName(level: string | null): string {
  if (level === null) return t('thinking.normal');
  if (!level) return t('thinking.unavailable');
  const keys: Record<string, string> = {
    off: 'thinking.off',
    minimal: 'thinking.minimal',
    low: 'thinking.low',
    medium: 'thinking.medium',
    high: 'thinking.high',
    xhigh: 'thinking.xhigh',
    max: 'thinking.max',
  };
  return keys[level] ? t(keys[level]!) : level[0]!.toUpperCase() + level.slice(1);
}
