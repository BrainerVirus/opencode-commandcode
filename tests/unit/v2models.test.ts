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
  expect(m.modelID).toBe(base.id);
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

test("toV2Model keeps short UI id and full Command Code wire modelID", () => {
  const m = toV2Model({ ...base, id: "deepseek/deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash" });
  expect(m.id).toBe("deepseek-v4.1-flash");
  expect(m.modelID).toBe("deepseek/deepseek-v4.1-flash");
  expect(m.name).toBe("DeepSeek V4.1 Flash");
  expect(m.package).toBeUndefined();
});

test("Claude catalog models use the Anthropic Messages package", () => {
  const ids = [
    "claude-sonnet-5",
    "claude-sonnet-4-6",
    "claude-fable-5",
    "claude-fable-5-1",
    "claude-opus-5-5",
    "claude-opus-5",
    "claude-opus-4-8",
    "claude-opus-4-7",
    "claude-haiku-4-5-20251001",
  ];
  const models = generateV2Models(ids.map((id) => ({ ...base, id })));
  expect(models.map((model) => model.package)).toEqual(ids.map(() => "aisdk:@ai-sdk/anthropic"));
});

test("V2 maps advertised Responses and Messages packages", () => {
  expect(
    toV2Model({
      ...base,
      id: "deepseek/deepseek-v4-flash",
      supported_endpoints: ["/provider/v1/responses"],
    }).package,
  ).toBe("aisdk:@ai-sdk/openai");
  expect(
    toV2Model({
      ...base,
      id: "vendor/messages-model",
      supported_endpoints: ["/v1/messages"],
    }).package,
  ).toBe("aisdk:@ai-sdk/anthropic");
});

test("V2 maps models.dev release and catalog metadata", () => {
  const model = toV2Model({
    ...base,
    family: "claude-sonnet",
    release_date: "2026-02-17",
    status: "beta",
    limit: { context: 200000, input: 195000, output: 16000 },
  });
  expect(model.family).toBe("claude-sonnet");
  expect(model.time.released).toBe(Date.UTC(2026, 1, 17));
  expect(model.status).toBe("beta");
  expect(model.limit).toEqual({ context: 200000, input: 195000, output: 16000 });
});

test("V2 emits context cost tiers and avoids duplicating the 200K legacy tier", () => {
  const model = toV2Model({
    ...base,
    cost: {
      input: 5,
      output: 25,
      cache_read: 0.5,
      context_over_200k: { input: 10, output: 37.5, cache_read: 1 },
      tiers: [
        {
          input: 10,
          output: 37.5,
          cache_read: 1,
          tier: { type: "context", size: 200000 },
        },
        {
          input: 12,
          output: 45,
          cache_read: 1.2,
          tier: { type: "context", size: 272000 },
        },
      ],
    },
  });
  expect(model.cost).toEqual([
    { input: 5, output: 25, cache: { read: 0.5, write: 0 } },
    {
      input: 10,
      output: 37.5,
      cache: { read: 1, write: 0 },
      tier: { type: "context", size: 200000 },
    },
    {
      input: 12,
      output: 45,
      cache: { read: 1.2, write: 0 },
      tier: { type: "context", size: 272000 },
    },
  ]);

  const legacy = toV2Model({
    ...base,
    cost: { input: 3, output: 15, context_over_200k: { input: 6, output: 30 } },
  });
  expect(legacy.cost[1]).toEqual({
    input: 6,
    output: 30,
    cache: { read: 0, write: 0 },
    tier: { type: "context", size: 200000 },
  });
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
  expect(out.map((m) => m.modelID)).toEqual(["anthropic/claude-sonnet-4-6", "openai/gpt-5.5"]);
});
