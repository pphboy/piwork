import type { ModelApi, RunModelSnapshot, ThinkingLevel, ThinkingProfile } from "@piwork/contracts";

export function thinkingApi(model: RunModelSnapshot): ModelApi | undefined {
  return model.api ?? (model.provider === "openai" ? "openai-responses" : model.provider === "anthropic" ? "anthropic-messages" : undefined);
}

// Versioned profiles describe requests, not confirmed model capabilities.
export const THINKING_PROFILES = {
  "responses-effort-v1": { api: "openai-responses", levels: ["off", "minimal", "low", "medium", "high", "xhigh", "max"] },
  "messages-adaptive-v1": { api: "anthropic-messages", levels: ["off", "low", "medium", "high", "xhigh", "max"] },
  "messages-budget-v1": { api: "anthropic-messages", levels: ["off", "minimal", "low", "medium", "high"], budgets: { minimal: 1024, low: 2048, medium: 4096, high: 6144 } },
} as const satisfies Record<ThinkingProfile, { api: ModelApi; levels: readonly ThinkingLevel[]; budgets?: Partial<Record<ThinkingLevel, number>> }>;

export function compatibleThinkingProfiles(api: ModelApi | undefined) {
  return (Object.entries(THINKING_PROFILES) as [ThinkingProfile, typeof THINKING_PROFILES[ThinkingProfile]][])
    .filter(([, value]) => value.api === api)
    .map(([profile, value]) => ({ profile, levels: [...value.levels], ...("budgets" in value ? { budgets: { ...value.budgets } } : {}) }));
}

export function validThinkingSelection(
  api: ModelApi | undefined, levels: readonly ThinkingLevel[], level: ThinkingLevel | null,
  profile?: ThinkingProfile, allowSavedProfile = false,
): boolean {
  if (profile !== undefined) {
    const definition = THINKING_PROFILES[profile];
    return !!definition && definition.api === api && level !== null &&
      (levels.length === 0 || allowSavedProfile) && (definition.levels as readonly ThinkingLevel[]).includes(level);
  }
  return level === null ? levels.length === 0 : levels.includes(level);
}
