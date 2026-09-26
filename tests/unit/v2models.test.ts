import { expect, test } from "bun:test";
import { generateV2Models, toV2Model } from "@/src/v2models.ts";
import { toConfigKey, type ModelEntry } from "@/src/catalog.ts";

const base: ModelEntry = {
  id: "anthropic/claude-sonnet-4-6",
  name: "Claude Sonnet 4.6",
  tier: "premium",
  reasoning: true,
  reasoningEfforts: ["low", "high"],
  tool_call: true,
  cost: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
  limit: { context: 200000, output: 16000 },
  attachment: true,
  modalities: { input: ["text", "image"], output: ["text"] },
};

test("toV2Model maps V1 entry to V2 capabilities/cost/limit", () => {
  const m = toV2Model(base);
  expect(m.id).toBe(toConfigKey(base.id));
  expect(m.modelID).toBe(toConfigKey(base.id));
  expect(m.providerID).toBe("commandcode");
  expect(m.name).toBe(base.name);
  expect(m.capabilities).toEqual({ tools: true, input: ["text", "image"], output: ["text"] });
  expect(m.cost).toEqual([{ input: 3, output: 15, cache: { read: 0.3, write: 3.75 } }]);
  expect(m.limit).toEqual({ context: 200000, output: 16000 });
  expect(m.variants).toEqual([
    { id: "low", settings: { reasoningEffort: "low" } },
    { id: "high", settings: { reasoningEffort: "high" } },
  ]);
  expect(m.status).toBe("active");
  expect(m.enabled).toBe(true);
});

test("toV2Model defaults to text-only when no modality metadata", () => {
  const m = toV2Model({
    ...base,
    attachment: undefined,
    modalities: undefined,
    tool_call: false,
    reasoningEfforts: undefined,
    cost: { input: 1, output: 2 },
  });
  expect(m.capabilities).toEqual({ tools: false, input: ["text"], output: ["text"] });
  expect(m.cost[0].cache).toEqual({ read: 0, write: 0 });
  expect(m.variants).toEqual([]);
});

test("toV2Model derives image input from attachment flag", () => {
  const m = toV2Model({ ...base, modalities: undefined, attachment: true });
  expect(m.capabilities.input).toEqual(["text", "image"]);
});

test("generateV2Models maps every entry", () => {
  const out = generateV2Models([base, { ...base, id: "openai/gpt-5.5" }]);
  expect(out.length).toBe(2);
  expect(out.map((m) => m.id)).toEqual(["claude-sonnet-4-6", "gpt-5.5"]);
});
