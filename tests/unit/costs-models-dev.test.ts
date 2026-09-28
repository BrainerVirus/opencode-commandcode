import { expect, test, describe } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import {
  applyFreeCosts,
  applyModelsDevCosts,
  applyModelsDevCostTiers,
  applyModelsDevMetadata,
  applyModelsDevModalities,
  isFreeSku,
  parseModelsDev,
  TEXT_ONLY_MODALITIES,
} from "@/src/costs-models-dev.ts";
import type { ModelEntry } from "@/src/catalog.ts";

function model(partial: Partial<ModelEntry> & Pick<ModelEntry, "id" | "name">): ModelEntry {
  return {
    tier: "open-source",
    reasoning: false,
    tool_call: true,
    cost: { input: 0.5, output: 2 },
    limit: { context: 200000, output: 65536 },
    ...partial,
  };
}

describe("isFreeSku", () => {
  test("detects free from name or id suffix", () => {
    expect(isFreeSku({ id: "tencent/Hy3", name: "Tencent Hy3 (Free)" })).toBe(true);
    expect(isFreeSku({ id: "inclusionai/ling-3.0-flash-free", name: "Ling 3.0 Flash" })).toBe(true);
    expect(isFreeSku({ id: "google/gemini-3.5-flash", name: "Gemini 3.5 Flash" })).toBe(false);
  });
});

describe("parseModelsDev + applyModelsDevCosts", () => {
  const rows = parseModelsDev(
    readFileSync(join(import.meta.dir, "../fixtures/models-dev/api.subset.json"), "utf-8"),
  );

  test("fills by exact id and skips already priced models", () => {
    const models = [
      model({
        id: "google/gemini-3.5-flash",
        name: "Gemini 3.5 Flash",
        cost: { input: 0.5, output: 2 },
      }),
      model({ id: "kept", name: "Kept", cost: { input: 3, output: 15 } }),
    ];
    const filled = new Set<string>();
    const n = applyModelsDevCosts(models, rows, new Set(["kept"]), filled);
    expect(n).toBe(1);
    expect(models[0].cost).toEqual({ input: 1.5, output: 9, cache_read: 0.15 });
    expect(models[1].cost).toEqual({ input: 3, output: 15 });
    expect([...filled]).toEqual(["google/gemini-3.5-flash"]);
  });

  test("does not apply models.dev prices to Command Code free SKUs", () => {
    const models = [
      model({
        id: "minimax/minimax-m2.7-free",
        name: "MiniMax M2.7 Free",
        cost: { input: 0.5, output: 2 },
      }),
    ];
    const filled = new Set<string>();
    expect(applyModelsDevCosts(models, rows, new Set(), filled)).toBe(0);
    expect(models[0].cost).toEqual({ input: 0.5, output: 2 });
    expect(filled.size).toBe(0);
  });

  test("matches the last path segment of a catalog id", () => {
    const models = [
      model({ id: "Qwen/Qwen3.6-Plus", name: "Qwen 3.6 Plus", cost: { input: 0.5, output: 2 } }),
    ];
    const filled = new Set<string>();
    expect(applyModelsDevCosts(models, rows, new Set(), filled)).toBe(1);
    expect(models[0].cost).toEqual({ input: 0.5, output: 3, cache_read: 0.1 });
    expect([...filled]).toEqual(["Qwen/Qwen3.6-Plus"]);
  });
});

describe("applyModelsDevModalities", () => {
  const rows = parseModelsDev(
    readFileSync(join(import.meta.dir, "../fixtures/models-dev/api.subset.json"), "utf-8"),
  );

  test("keeps CLI modalities on unmatched SKUs and only enriches extras from models.dev", () => {
    const models = [
      model({
        id: "google/gemini-3.5-flash",
        name: "Gemini 3.5 Flash",
        attachment: true,
        modalities: { input: ["text", "image"], output: ["text"] },
      }),
      model({
        id: "unknown/cli-vision-only",
        name: "CLI Vision Only",
        attachment: true,
        modalities: { input: ["text", "image"], output: ["text"] },
      }),
      model({
        id: "tencent/hy4-preview",
        name: "Tencent Hy4 Preview",
        attachment: false,
        modalities: { input: ["text"], output: ["text"] },
      }),
      model({ id: "no-cli-no-dev", name: "Gap" }),
    ];
    const n = applyModelsDevModalities(models, rows);
    expect(n).toBe(1);
    expect(models[0].modalities).toEqual({
      input: ["text", "image", "video", "audio", "pdf"],
      output: ["text"],
    });
    expect(models[1].attachment).toBe(true);
    expect(models[1].modalities).toEqual({ input: ["text", "image"], output: ["text"] });
    expect(models[2].attachment).toBe(false);
    expect(models[2].modalities).toEqual({ ...TEXT_ONLY_MODALITIES });
    expect(models[3].attachment).toBe(false);
    expect(models[3].modalities).toEqual({ ...TEXT_ONLY_MODALITIES });
  });
});

describe("applyModelsDevMetadata", () => {
  test("applies present fields and preserves known values missing from a partial response", () => {
    const rows = parseModelsDev(
      JSON.stringify({
        provider: {
          models: {
            "qwen/qwen3.6-plus": {
              id: "qwen/qwen3.6-plus",
              name: "Qwen 3.6 Plus",
              family: "qwen",
              release_date: "2026-04-02",
              status: "beta",
              limit: { input: 200000 },
            },
            partial: { id: "partial", name: "Partial", family: "new-family" },
            invalid: {
              id: "invalid",
              name: "Invalid",
              family: " ",
              release_date: "not-a-date",
              status: "retired",
              limit: { input: 1.5 },
            },
          },
        },
      }),
    );
    expect(rows.find((row) => row.id === "invalid")).toEqual({ id: "invalid", name: "Invalid" });

    const models = [
      model({
        id: "Qwen/Qwen3.6-Plus",
        name: "Qwen 3.6 Plus",
        family: "old-family",
        release_date: "2025-01-01",
        status: "deprecated",
        limit: { context: 1000000, input: 999999, output: 131072 },
      }),
      model({
        id: "partial",
        name: "Partial",
        family: "qwen",
        release_date: "2025-01-01",
        status: "deprecated",
        limit: { context: 100000, input: 20000, output: 16000 },
      }),
      model({ id: "missing", name: "Missing", family: "keep" }),
    ];
    expect(applyModelsDevMetadata(models, rows)).toBe(2);
    expect(models[0]).toMatchObject({
      family: "qwen",
      release_date: "2026-04-02",
      status: "beta",
      limit: { input: 200000 },
    });
    expect(models[1]).toMatchObject({
      family: "new-family",
      release_date: "2025-01-01",
      status: "deprecated",
      limit: { input: 20000 },
    });
    expect(models[2].family).toBe("keep");
  });
});

describe("applyModelsDevCostTiers", () => {
  test("uses a tier alias only when its base price matches the catalog model", () => {
    const rows = parseModelsDev(
      JSON.stringify({
        a_provider: {
          models: {
            wrong: {
              id: "openai/example",
              name: "Example",
              cost: {
                input: 0.9,
                output: 9,
                tiers: [{ input: 1.8, output: 18, tier: { type: "context", size: 512000 } }],
              },
            },
          },
        },
        b_provider: {
          models: {
            matching: {
              id: "openai/example",
              name: "Example",
              cost: {
                input: 0.5,
                output: 2,
                tiers: [{ input: 1, output: 4, tier: { type: "context", size: 272000 } }],
              },
            },
          },
        },
      }),
    );
    const entry = model({ id: "openai/example", name: "Example" });
    expect(rows).toHaveLength(2);
    expect(applyModelsDevCostTiers([entry], rows)).toBe(1);
    expect(entry.cost.tiers).toEqual([
      { input: 1, output: 4, tier: { type: "context", size: 272000 } },
    ]);

    const mismatched = model({ id: "openai/example", name: "Example" });
    expect(applyModelsDevCostTiers([mismatched], rows.slice(0, 1))).toBe(0);
    expect(mismatched.cost.tiers).toBeUndefined();
  });

  test("preserves context thresholds and the legacy 200K rate", () => {
    const rows = parseModelsDev(
      JSON.stringify({
        provider: {
          models: {
            model: {
              id: "qwen/qwen3.7-flash",
              name: "Qwen3.7 Flash",
              cost: {
                input: 0.1,
                output: 0.4,
                tiers: [
                  {
                    input: 0.2,
                    output: 0.8,
                    tier: { type: "context", size: 200000 },
                  },
                  {
                    input: 0.3,
                    output: 1.2,
                    tier: { type: "context", size: 272000 },
                  },
                ],
                context_over_200k: { input: 0.2, output: 0.8 },
              },
            },
          },
        },
      }),
    );
    const entry = model({
      id: "qwen/qwen3.7-flash",
      name: "Qwen3.7 Flash",
      cost: { input: 0.1, output: 0.4 },
    });
    expect(applyModelsDevCostTiers([entry], rows)).toBe(1);
    expect(entry.cost.tiers).toEqual([
      { input: 0.2, output: 0.8, tier: { type: "context", size: 200000 } },
      { input: 0.3, output: 1.2, tier: { type: "context", size: 272000 } },
    ]);
    expect(entry.cost.context_over_200k).toEqual({ input: 0.2, output: 0.8 });
    expect(applyModelsDevCostTiers([entry], [])).toBe(0);
    expect(entry.cost.tiers).toHaveLength(2);
  });
});

describe("applyFreeCosts", () => {
  test("sets free SKUs to zero and leaves paid models alone", () => {
    const models = [
      model({ id: "tencent/Hy3", name: "Tencent Hy3 (Free)" }),
      model({ id: "google/gemini-3.5-flash", name: "Gemini 3.5 Flash" }),
    ];
    const filled = new Set<string>();
    expect(applyFreeCosts(models, new Set(), filled)).toBe(1);
    expect(models[0].cost).toEqual({ input: 0, output: 0 });
    expect(models[1].cost).toEqual({ input: 0.5, output: 2 });
    expect([...filled]).toEqual(["tencent/Hy3"]);
  });
});
