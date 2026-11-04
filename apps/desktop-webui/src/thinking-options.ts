import type { RunModel } from './models.js';

export interface ThinkingOption {
  level: string | null;
  profile?: string;
}

// Ordering only: selectable values and request mappings come from the Agent.
const order = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

export function thinkingOptions(model: RunModel | undefined, capability: number, retained?: ThinkingOption): ThinkingOption[] {
  if (!model || capability < 1) return [];
  const options = new Map<string | null, ThinkingOption>();
  if (model.thinkingAvailability === 'unknown') options.set(null, { level: null });
  for (const level of model.thinkingLevels ?? []) options.set(level, { level });
  if (capability >= 5 || capability === 4 && model.thinkingAvailability === 'unknown') {
    for (const mapping of model.compatibleThinkingProfiles ?? []) {
      for (const level of mapping.levels) {
        if (!options.has(level)) options.set(level, { level, profile: mapping.profile });
      }
    }
  }
  if (retained && !options.has(retained.level)) options.set(retained.level, { ...retained });
  return [...options.values()].sort((a, b) => {
    const rank = (level: string | null) => level === null ? -1 : order.indexOf(level) < 0 ? order.length : order.indexOf(level);
    return rank(a.level) - rank(b.level);
  });
}
