import { expect, test, describe } from "bun:test";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { parseAvailabilityIds } from "@/src/catalog.ts";
import {
  AvailabilityPayloadSchema,
  ManifestSchema,
  ModelEntrySchema,
  PluginFileConfigSchema,
} from "@/src/schemas.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

const minimalEntry = {
  id: "claude-sonnet-4-6",
  name: "Claude Sonnet 4.6",
  tier: "premium",
  reasoning: true,
  tool_call: true,
  cost: { input: 3, output: 15 },
  limit: { context: 200000, output: 16000 },
};

const fullEntry = {
  ...minimalEntry,
  reasoningEfforts: ["low", "medium", "high"],
  cost: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
  attachment: true,
  modalities: { input: ["text", "image"], output: ["text"] },
};

describe("ModelEntrySchema", () => {
  test("accepts minimal and fully-populated entries", () => {
    expect(ModelEntrySchema.safeParse(minimalEntry).success).toBe(true);
    const full = ModelEntrySchema.safeParse(fullEntry);
    expect(full.success).toBe(true);
    expect(full.success && full.data).toEqual(fullEntry);
  });

  test("rejects unknown top-level keys (strict)", () => {
    const parsed = ModelEntrySchema.safeParse({ ...minimalEntry, provider: "anthropic" });
    expect(parsed.success).toBe(false);
  });

  test("rejects unknown nested keys in cost, limit, and modalities (strict)", () => {
    expect(
      ModelEntrySchema.safeParse({
        ...minimalEntry,
        cost: { input: 3, output: 15, cacheWrite5mCost: 3.75 },
      }).success,
    ).toBe(false);
    expect(
      ModelEntrySchema.safeParse({
        ...minimalEntry,
        limit: { context: 200000, output: 16000, extra: 1 },
      }).success,
    ).toBe(false);
    expect(
      ModelEntrySchema.safeParse({
        ...minimalEntry,
        modalities: { input: ["text"], output: ["text"], extra: [] },
      }).success,
    ).toBe(false);
  });

  test("rejects wrong tier, empty id, and non-integer limits", () => {
    expect(ModelEntrySchema.safeParse({ ...minimalEntry, tier: "free" }).success).toBe(false);
    expect(ModelEntrySchema.safeParse({ ...minimalEntry, id: "" }).success).toBe(false);
    const { id: _dropped, ...missingId } = minimalEntry;
    expect(ModelEntrySchema.safeParse(missingId).success).toBe(false);
    expect(
      ModelEntrySchema.safeParse({
        ...minimalEntry,
        limit: { context: 200000.5, output: 16000 },
      }).success,
    ).toBe(false);
  });

  test("validates every bundled models.json entry with zero drops", () => {
    const bundled = JSON.parse(readFileSync(join(repoRoot, "models.json"), "utf-8")) as unknown[];
    expect(bundled.length).toBeGreaterThan(20);
    let dropped = 0;
    for (const entry of bundled) {
      if (!ModelEntrySchema.safeParse(entry).success) dropped++;
    }
    expect(dropped).toBe(0);
  });

  test("mixed array keeps valid entries and counts drops (fail-open degraded signal)", () => {
    const mixed = [
      minimalEntry,
      { ...minimalEntry, id: "extra-field-model", typoField: true },
      { ...minimalEntry, id: "bad-tier-model", tier: "ultra" },
      fullEntry,
    ];
    const retained: unknown[] = [];
    let dropped = 0;
    for (const entry of mixed) {
      const result = ModelEntrySchema.safeParse(entry);
      if (result.success) retained.push(result.data);
      else dropped++;
    }
    expect(retained).toHaveLength(2);
    expect(dropped).toBe(2);
  });
});

describe("ManifestSchema", () => {
  test("accepts the bundled manifest.json", () => {
    const manifest = JSON.parse(readFileSync(join(repoRoot, "manifest.json"), "utf-8")) as unknown;
    expect(ManifestSchema.safeParse(manifest).success).toBe(true);
  });

  test("rejects unknown keys, wrong schemaVersion, and bad status (strict)", () => {
    const manifest = JSON.parse(readFileSync(join(repoRoot, "manifest.json"), "utf-8")) as Record<
      string,
      unknown
    >;
    expect(ManifestSchema.safeParse({ ...manifest, schemaVersion: 2 }).success).toBe(false);
    expect(ManifestSchema.safeParse({ ...manifest, status: "unknown" }).success).toBe(false);
    expect(ManifestSchema.safeParse({ ...manifest, unexpected: true }).success).toBe(false);
  });

  test("invalid manifest parses as missing (null path, no throw)", () => {
    const readManifest = (raw: unknown) => {
      const result = ManifestSchema.safeParse(raw);
      return result.success ? result.data : null;
    };
    expect(readManifest({ schemaVersion: 1 })).toBeNull();
    expect(readManifest(null)).toBeNull();
    expect(readManifest("not-json-shaped")).toBeNull();
  });
});

describe("AvailabilityPayloadSchema / parseAvailabilityIds", () => {
  const ok = (data: unknown[]) => ({ object: "list", data });

  test("returns ids from a valid list response", () => {
    expect(parseAvailabilityIds(ok([{ id: "a" }, { id: "b/c" }]))).toEqual(["a", "b/c"]);
  });

  test("tolerates extra provider fields on items and top level (lenient)", () => {
    expect(
      parseAvailabilityIds({
        object: "list",
        data: [{ id: "a", object: "model", created: 1, owned_by: "x" }],
      }),
    ).toEqual(["a"]);
    expect(AvailabilityPayloadSchema.safeParse(ok([{ id: "a" }])).success).toBe(true);
  });

  test("rejects empty data, blank ids, and non-object items", () => {
    expect(() => parseAvailabilityIds(ok([]))).toThrow();
    expect(() => parseAvailabilityIds(ok([{ id: "" }]))).toThrow();
    expect(() => parseAvailabilityIds(ok([{ nope: 1 }]))).toThrow();
    expect(() => parseAvailabilityIds(null)).toThrow();
    expect(() => parseAvailabilityIds({ object: "other", data: [{ id: "a" }] })).toThrow();
  });

  test("duplicate ids still error", () => {
    expect(() => parseAvailabilityIds(ok([{ id: "a" }, { id: "a" }]))).toThrow(/duplicate/);
  });
});

describe("PluginFileConfigSchema", () => {
  test("applies defaults for a missing/empty config", () => {
    expect(PluginFileConfigSchema.parse({})).toEqual({
      disableModelSync: false,
      commandCodePackagePath: "",
      debugStartupLogs: false,
    });
  });

  test("keeps provided values and strips unknown keys (lenient)", () => {
    expect(
      PluginFileConfigSchema.parse({
        debugStartupLogs: true,
        commandCodePackagePath: "/opt/command-code",
        extraKey: "ignored",
      }),
    ).toEqual({
      disableModelSync: false,
      commandCodePackagePath: "/opt/command-code",
      debugStartupLogs: true,
    });
  });

  test("wrong-typed values fail validation so callers fall back to defaults", () => {
    const raw = { debugStartupLogs: "yes" };
    const parsed = PluginFileConfigSchema.safeParse(raw);
    const config = parsed.success ? parsed.data : PluginFileConfigSchema.parse({});
    expect(config).toEqual({
      disableModelSync: false,
      commandCodePackagePath: "",
      debugStartupLogs: false,
    });
  });
});
