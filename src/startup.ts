import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { ModelEntry } from "./catalog.js";
import { liveEnv, resolveStateDir, type EnvDeps } from "./env.js";
import { causeMessage, errResult, okResult, type LoadResult } from "./load-result.js";

export type { ModelEntry } from "./catalog.js";

export type StartupSummary = {
  catalogSource: "bundled" | "cache" | "opt-in-local";
  commandCodeVersion: string | null;
  modelCount: number;
  reasoningModelCount: number;
  degraded: boolean;
  degradedReason: string | null;
};

export function pluginStateDir(deps: EnvDeps = liveEnv): string {
  return resolveStateDir(deps);
}

/**
 * Explicit cache read: hit yields the models, anything else yields the
 * reason (missing file, empty/invalid content, unreadable JSON).
 */
export function readCatalogCacheResult(
  dir?: string,
  deps: EnvDeps = liveEnv,
): LoadResult<ModelEntry[]> {
  const cacheDir = dir ?? resolveStateDir(deps);
  const path = join(cacheDir, "catalog-cache.json");
  if (!existsSync(path)) return errResult("catalog cache missing");
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
  } catch (error) {
    return errResult(`catalog cache unreadable: ${causeMessage(error)}`);
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return errResult("catalog cache empty");
  return okResult(parsed as ModelEntry[]);
}

/** Compat wrapper: explicit-dir callers that only need value-or-null. */
export function readCatalogCache(dir?: string, deps: EnvDeps = liveEnv): ModelEntry[] | null {
  const result = readCatalogCacheResult(dir, deps);
  return result.ok ? result.value : null;
}

export function writeCatalogCache(dir: string, models: ModelEntry[]): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "catalog-cache.json"), JSON.stringify(models) + "\n", "utf-8");
}

export function writeStartupSummary(dir: string, summary: StartupSummary): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "startup.json"), JSON.stringify(summary) + "\n", "utf-8");
}
