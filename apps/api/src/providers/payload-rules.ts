import type { PayloadRewriteRule, ProviderSummary } from "@codex-web/protocol";

type ProviderRecord = ProviderSummary & { apiKey?: string };

export function sanitizePayloadRewriteRules(value: unknown): PayloadRewriteRule[] {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => {
    const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const rawProviderKind = record.providerKind;
    const providerKind: PayloadRewriteRule["providerKind"] = rawProviderKind === "openai-compatible-chat" || rawProviderKind === "openai-responses" || rawProviderKind === "local" || rawProviderKind === "all"
      ? rawProviderKind
      : "all";
    return {
      id: typeof record.id === "string" && record.id ? record.id : `payload-rule-${index + 1}`,
      enabled: record.enabled !== false,
      providerKind,
      modelPattern: typeof record.modelPattern === "string" ? record.modelPattern.trim() : "",
      removeParams: Array.isArray(record.removeParams) ? record.removeParams.map(String).map((param) => param.trim()).filter(Boolean) : [],
      setParamsJson: typeof record.setParamsJson === "string" ? record.setParamsJson.trim() : "",
    };
  }).filter((rule) => rule.modelPattern);
}

export function applyPayloadRewriteRules(provider: ProviderRecord, payload: Record<string, unknown>, rules: PayloadRewriteRule[] = []) {
  const model = typeof payload.model === "string" ? payload.model : provider.defaultModel;
  const next = { ...payload };
  for (const rule of sanitizePayloadRewriteRules(rules)) {
    if (rule.enabled === false) continue;
    if (rule.providerKind && rule.providerKind !== "all" && rule.providerKind !== provider.kind) continue;
    let matched = false;
    try {
      matched = new RegExp(rule.modelPattern).test(model);
    } catch {
      continue;
    }
    if (!matched) continue;
    for (const key of rule.removeParams ?? []) delete next[key];
    if (rule.setParamsJson?.trim()) {
      try {
        const parsed = JSON.parse(rule.setParamsJson) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) Object.assign(next, parsed);
      } catch {
        continue;
      }
    }
  }
  return next;
}
