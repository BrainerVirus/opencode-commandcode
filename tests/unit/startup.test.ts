import { expect, test, describe } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  pluginStateDir,
  readCatalogCache,
  readCatalogCacheResult,
  writeCatalogCache,
  writeStartupSummary,
  type ModelEntry,
} from "@/src/startup.ts";
import type { EnvDeps } from "@/src/env.ts";

const sample: ModelEntry[] = [
  {
    id: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    tier: "premium",
    reasoning: true,
    tool_call: true,
    cost: { input: 3, output: 15 },
    limit: { context: 200000, output: 16000 },
  },
];

/** Injected env: no process.env reads, no homedir touches. */
const fakeEnv = (overrides: Record<string, string> = {}): EnvDeps => ({
  homedir: () => "/fake/home",
  getEnv: (key) => overrides[key],
});

describe("pluginStateDir", () => {
  test("defaults under the injected homedir", () => {
    expect(pluginStateDir(fakeEnv())).toBe("/fake/home/.local/state/opencode/commandcode-provider");
  });

  test("honors the injected COMMANDCODE_PROVIDER_STATE_DIR", () => {
    const dir = mkdtempSync(join(tmpdir(), "cc-state-"));
    try {
      expect(pluginStateDir(fakeEnv({ COMMANDCODE_PROVIDER_STATE_DIR: dir }))).toBe(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("catalog cache", () => {
  test("round-trips models and returns null for missing file (compat wrapper)", () => {
    const dir = mkdtempSync(join(tmpdir(), "cc-cache-"));
    try {
      expect(readCatalogCache(dir)).toBeNull();
      writeCatalogCache(dir, sample);
      expect(readCatalogCache(dir)).toEqual(sample);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("Result reports a missing cache with a reason", () => {
    const dir = mkdtempSync(join(tmpdir(), "cc-cache-miss-"));
    try {
      const result = readCatalogCacheResult(dir, fakeEnv());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain("missing");
      else throw new Error("unreachable");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("Result reports a corrupt cache with a reason", () => {
    const dir = mkdtempSync(join(tmpdir(), "cc-cache-bad-"));
    try {
      writeFileSync(join(dir, "catalog-cache.json"), "{not json", "utf-8");
      const result = readCatalogCacheResult(dir, fakeEnv());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain("unreadable");
      else throw new Error("unreachable");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("Result reports an empty cache with a reason", () => {
    const dir = mkdtempSync(join(tmpdir(), "cc-cache-empty-"));
    try {
      writeFileSync(join(dir, "catalog-cache.json"), "[]", "utf-8");
      const result = readCatalogCacheResult(dir, fakeEnv());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain("empty");
      else throw new Error("unreachable");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("Result resolves the default dir from injected deps", () => {
    // /fake/home does not exist: proves the default dir came from the fake,
    // with no process.env involvement.
    const result = readCatalogCacheResult(undefined, fakeEnv());
    expect(result.ok).toBe(false);
  });
});

describe("startup summary", () => {
  test("writes startup.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "cc-sum-"));
    try {
      writeStartupSummary(dir, {
        catalogSource: "bundled",
        commandCodeVersion: "1.38.0",
        modelCount: 1,
        reasoningModelCount: 1,
        degraded: false,
        degradedReason: null,
      });
      const parsed = JSON.parse(readFileSync(join(dir, "startup.json"), "utf-8"));
      expect(parsed.catalogSource).toBe("bundled");
      expect(parsed.modelCount).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
