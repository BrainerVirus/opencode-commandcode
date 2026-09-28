import { toConfigKey, usesAnthropicMessagesApi, type ModelEntry } from "./catalog.js";

/** Minimal V2 model shape (structural subset of Model.Info). */
export interface V2Model {
  id: string;
  modelID: string;
  providerID: string;
  package?: string;
  name: string;
  family?: string;
  capabilities: { tools: boolean; input: string[]; output: string[] };
  cost: Array<{
    input: number;
    output: number;
    cache: { read: number; write: number };
    tier?: { type: "context"; size: number };
  }>;
  limit: { context: number; input?: number; output: number };
  variants: Array<{ id: string; settings: Record<string, unknown> }>;
  status: "active" | "beta" | "deprecated";
  enabled: boolean;
  time: { released: number };
}

function v2Input(entry: ModelEntry): string[] {
  if (entry.modalities?.input && entry.modalities.input.length > 0)
    return [...entry.modalities.input];
  if (entry.attachment === true) return ["text", "image"];
  return ["text"];
}

function v2Output(entry: ModelEntry): string[] {
  if (entry.modalities?.output && entry.modalities.output.length > 0)
    return [...entry.modalities.output];
  return ["text"];
}

export function toV2Model(entry: ModelEntry): V2Model {
  // UI / OpenCode selection key stays short (commandcode/deepseek-v4.1-flash).
  // modelID is the Command Code wire id — bare names 400 as unsupported_model.
  const id = toConfigKey(entry.id);
  const costTiers = [...(entry.cost.tiers ?? [])];
  if (
    entry.cost.context_over_200k &&
    !costTiers.some((tier) => tier.tier.type === "context" && tier.tier.size === 200000)
  ) {
    costTiers.push({
      ...entry.cost.context_over_200k,
      tier: { type: "context", size: 200000 },
    });
  }
  const model: V2Model = {
    id,
    modelID: entry.id,
    providerID: "commandcode",
    name: entry.name,
    ...(entry.family !== undefined ? { family: entry.family } : {}),
    capabilities: {
      tools: entry.tool_call,
      input: v2Input(entry),
      output: v2Output(entry),
    },
    cost: [
      {
        input: entry.cost.input,
        output: entry.cost.output,
        cache: {
          read: entry.cost.cache_read ?? 0,
          write: entry.cost.cache_write ?? 0,
        },
      },
      ...costTiers.map((tier) => ({
        input: tier.input,
        output: tier.output,
        cache: { read: tier.cache_read ?? 0, write: tier.cache_write ?? 0 },
        tier: { ...tier.tier },
      })),
    ],
    limit: {
      context: entry.limit.context,
      ...(entry.limit.input !== undefined ? { input: entry.limit.input } : {}),
      output: entry.limit.output,
    },
    variants: (entry.reasoningEfforts ?? []).map((effort) => ({
      id: effort,
      settings: { reasoningEffort: effort },
    })),
    status: entry.status ?? "active",
    enabled: true,
    time: {
      released: entry.release_date ? Date.parse(`${entry.release_date}T00:00:00.000Z`) : 0,
    },
  };
  if (usesAnthropicMessagesApi(entry.id)) model.package = "aisdk:@ai-sdk/anthropic";
  return model;
}

export function generateV2Models(entries: ModelEntry[]): V2Model[] {
  return entries.map(toV2Model);
}
