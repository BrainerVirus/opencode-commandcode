import { toConfigKey, type ModelEntry } from "./catalog.js";

/** Minimal V2 model shape (structural subset of Model.Info). */
export interface V2Model {
  id: string;
  modelID: string;
  providerID: string;
  name: string;
  capabilities: { tools: boolean; input: string[]; output: string[] };
  cost: Array<{ input: number; output: number; cache: { read: number; write: number } }>;
  limit: { context: number; output: number };
  variants: Array<{ id: string; settings: Record<string, unknown> }>;
  status: "active";
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
  const id = toConfigKey(entry.id);
  return {
    id,
    modelID: id,
    providerID: "commandcode",
    name: entry.name,
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
    ],
    limit: { context: entry.limit.context, output: entry.limit.output },
    variants: (entry.reasoningEfforts ?? []).map((effort) => ({
      id: effort,
      settings: { reasoningEffort: effort },
    })),
    status: "active",
    enabled: true,
    time: { released: 0 },
  };
}

export function generateV2Models(entries: ModelEntry[]): V2Model[] {
  return entries.map(toV2Model);
}
