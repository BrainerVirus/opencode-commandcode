import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { z } from "zod";
import {
  generateOpencodeModels,
  loadCatalogFromLocalCommandCodeResult,
  type ModelEntry,
} from "./src/catalog.js";
import { readCatalogCacheResult, writeCatalogCache, writeStartupSummary } from "./src/startup.js";
import { liveEnv, resolveStateDir, type EnvDeps } from "./src/env.js";
import { causeMessage, errResult, okResult, type LoadResult } from "./src/load-result.js";
import type { CatalogManifest } from "./src/manifest.js";
import { generateV2Models } from "./src/v2models.js";
import { catalogPaths } from "./src/paths.js";
import { ManifestSchema, ModelEntrySchema, PluginFileConfigSchema } from "./src/schemas.js";

const { models: MODELS_PATH, manifest: MANIFEST_PATH, version: VERSION_PATH } = catalogPaths();

type PluginFileConfig = z.infer<typeof PluginFileConfigSchema>;

function loadPluginConfig(deps: EnvDeps = liveEnv): PluginFileConfig {
  const dir = join(deps.homedir(), ".config", "opencode");
  const configPath = [
    join(dir, "opencode-commandcode.json"),
    join(dir, "commandcode-go-opencode-provider.json"),
  ].find((p) => existsSync(p));
  if (!configPath) return PluginFileConfigSchema.parse({});
  let raw: unknown = {};
  try {
    raw = JSON.parse(readFileSync(configPath, "utf-8")) as unknown;
  } catch {
    raw = {};
  }
  const parsed = PluginFileConfigSchema.safeParse(raw);
  return parsed.success ? parsed.data : PluginFileConfigSchema.parse({});
}

export type { ModelEntry };

type BundledModels = { models: ModelEntry[]; dropped: number; dropReasons: string[] };

/** Explicit bundled read: parsed models plus the reason when unavailable. */
function loadBundledModels(): LoadResult<BundledModels> {
  let raw: string;
  try {
    raw = readFileSync(MODELS_PATH, "utf-8");
  } catch (error) {
    return errResult(`bundled models.json unreadable: ${causeMessage(error)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    return errResult(`bundled models.json invalid JSON: ${causeMessage(error)}`);
  }
  if (!Array.isArray(parsed)) return errResult("bundled models.json is not an array");
  const models: ModelEntry[] = [];
  const dropReasons: string[] = [];
  for (let index = 0; index < parsed.length; index++) {
    const result = ModelEntrySchema.safeParse(parsed[index]);
    if (result.success) models.push(result.data);
    else if (dropReasons.length < 3) {
      const detail = result.error.issues.map((issue) => issue.message).join("; ");
      dropReasons.push(`entry ${index}: ${detail}`);
    }
  }
  return okResult({ models, dropped: parsed.length - models.length, dropReasons });
}

/** Explicit manifest read: `ok(null)` is a missing file (version falls back). */
function readBundledManifest(): LoadResult<CatalogManifest | null> {
  if (!existsSync(MANIFEST_PATH)) return okResult(null);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8")) as unknown;
  } catch (error) {
    return errResult(`bundled manifest.json unreadable: ${causeMessage(error)}`);
  }
  const result = ManifestSchema.safeParse(parsed);
  if (!result.success) {
    const detail = result.error.issues.map((issue) => issue.message).join("; ");
    return errResult(`bundled manifest.json invalid: ${detail}`);
  }
  return okResult(result.data);
}

/** Explicit version read: manifest first, `_version.txt` fallback, else a reason. */
function readBundledVersion(): LoadResult<string | null> {
  const manifest = readBundledManifest();
  if (manifest.ok && manifest.value?.commandCodeVersion) {
    return okResult(manifest.value.commandCodeVersion);
  }
  if (!existsSync(VERSION_PATH)) return errResult("version file missing");
  try {
    const first = readFileSync(VERSION_PATH, "utf-8").split("\n")[0]?.trim();
    if (!first) return errResult("version file empty");
    return okResult(first);
  } catch (error) {
    return errResult(`version file unreadable: ${causeMessage(error)}`);
  }
}

export type CatalogLoad = {
  models: ModelEntry[];
  catalogSource: "bundled" | "cache" | "opt-in-local";
  commandCodeVersion: string | null;
  degraded: boolean;
  degradedReason: string | null;
};

export function loadCatalogEntries(deps: EnvDeps = liveEnv): CatalogLoad {
  const pluginCfg = loadPluginConfig(deps);
  const override =
    pluginCfg.commandCodePackagePath?.trim() ||
    deps.getEnv("COMMANDCODE_PACKAGE_PATH")?.trim() ||
    "";

  let models: ModelEntry[] = [];
  let catalogSource: CatalogLoad["catalogSource"] = "bundled";
  let commandCodeVersion: string | null = null;
  let degraded = false;
  const reasons: string[] = [];

  if (override) {
    const local = loadCatalogFromLocalCommandCodeResult({ packagePath: override }, deps);
    if (local.ok && local.value && local.value.models.length > 0) {
      models = local.value.models;
      catalogSource = "opt-in-local";
      commandCodeVersion = local.value.version;
    } else if (!local.ok) {
      reasons.push(`local override failed (${local.reason})`);
    } else {
      reasons.push("local override produced no models");
    }
  }

  if (models.length === 0) {
    const bundled = loadBundledModels();
    if (bundled.ok) {
      models = bundled.value.models;
      catalogSource = "bundled";
      const version = readBundledVersion();
      commandCodeVersion = version.ok ? version.value : null;
      const manifest = readBundledManifest();
      if (
        manifest.ok &&
        manifest.value &&
        (manifest.value.status === "degraded" || manifest.value.status === "broken")
      ) {
        degraded = true;
        reasons.push(
          manifest.value.status === "broken"
            ? "bundled catalog marked broken"
            : "bundled catalog has models with no listed price",
        );
      }
      if (bundled.value.dropped > 0) {
        degraded = true;
        const details =
          bundled.value.dropReasons.length > 0 ? `: ${bundled.value.dropReasons.join("; ")}` : "";
        reasons.push(
          `dropped ${bundled.value.dropped} invalid bundled model ${bundled.value.dropped === 1 ? "entry" : "entries"}${details}`,
        );
      }
    } else {
      const cached = readCatalogCacheResult(undefined, deps);
      if (cached.ok) {
        models = cached.value;
        catalogSource = "cache";
        degraded = true;
        reasons.push(`bundled models.json failed (${bundled.reason}); using last-good cache`);
      } else {
        degraded = true;
        reasons.push(`no bundled catalog (${bundled.reason}) and no cache (${cached.reason})`);
      }
    }
  }

  // Override notes only sharpen an already-degraded report; a healthy
  // bundled load stays non-degraded exactly as before.
  return {
    models,
    catalogSource,
    commandCodeVersion,
    degraded,
    degradedReason: degraded ? reasons.join("; ") : null,
  };
}

function persistCatalogSideEffects(
  load: CatalogLoad,
  debug: boolean,
  deps: EnvDeps = liveEnv,
): void {
  if (load.models.length > 0) {
    try {
      writeCatalogCache(resolveStateDir(deps), load.models);
    } catch {
      // ignore cache write
    }
  }

  const summary = {
    catalogSource: load.catalogSource,
    commandCodeVersion: load.commandCodeVersion,
    modelCount: load.models.length,
    reasoningModelCount: load.models.filter((m) => m.reasoning).length,
    degraded: load.degraded,
    degradedReason: load.degradedReason,
  };
  try {
    writeStartupSummary(resolveStateDir(deps), summary);
  } catch {
    // ignore
  }
  if (debug) {
    console.warn("[commandcode]", JSON.stringify(summary));
  }
}

/** V1 entrypoint (OpenCode 1.18.29+ also accepts it via `server`). */
export async function server() {
  return {
    config: async (config: Record<string, unknown>) => {
      if (!(config as Record<string, unknown>).provider) {
        (config as Record<string, unknown>).provider = { commandcode: {} };
      }
      const cc = (
        (config as Record<string, unknown>).provider as Record<string, Record<string, unknown>>
      )?.commandcode as Record<string, unknown> | undefined;
      if (!cc) return;

      const pluginCfg = loadPluginConfig();
      const debug = pluginCfg.debugStartupLogs === true;

      if (!cc.npm) cc.npm = "commandcode-go-opencode-provider";
      if (!cc.name) cc.name = "Command Code";
      if (!cc.env) cc.env = ["COMMANDCODE_API_KEY"];

      if (cc.models) return;

      const load = loadCatalogEntries();
      persistCatalogSideEffects(load, debug);
      cc.models = generateOpencodeModels(load.models);
    },

    auth: {
      provider: "commandcode",
      methods: [
        {
          type: "api",
          label: "API Key",
          authorize: async (inputs: Record<string, unknown> | undefined) => {
            const rawKey = inputs?.key;
            if (typeof rawKey !== "string") return { type: "failed" as const };
            const key = rawKey.trim();
            if (!key) return { type: "failed" as const };
            return { type: "success" as const, key };
          },
        },
      ],
      loader: async (getAuth: () => Promise<{ type: string; key?: string } | null>) => {
        try {
          const auth = await getAuth();
          if (!auth) return {};
          if (auth.type === "api" && auth.key) return { apiKey: auth.key };
          return {};
        } catch {
          return {};
        }
      },
    },
  };
}

/** V2 setup: provider inventory + models through transforms. Auth stays V1-only for now. */
async function setup(ctx: any): Promise<void> {
  const pluginCfg = loadPluginConfig();
  const debug = pluginCfg.debugStartupLogs === true;
  const load = loadCatalogEntries();
  persistCatalogSideEffects(load, debug);
  const v2models = generateV2Models(load.models);

  await ctx.provider.transform((editor: any) => {
    const existing = editor.get("commandcode");
    if (!existing) {
      editor.add({
        info: {
          id: "commandcode",
          name: "Command Code",
          activation: "enabled",
          package: "aisdk:@ai-sdk/openai-compatible",
          settings: {
            baseURL: "https://api.commandcode.ai/provider/v1",
            apiKey: "{env:COMMANDCODE_API_KEY}",
          },
        },
        models: v2models,
      });
      return;
    }
    editor.update("commandcode", (provider: any) => {
      provider.name = provider.name ?? "Command Code";
      provider.settings = provider.settings ?? {};
      if (typeof provider.settings === "object") {
        if (!provider.settings.baseURL)
          provider.settings.baseURL = "https://api.commandcode.ai/provider/v1";
        if (!provider.settings.apiKey) provider.settings.apiKey = "{env:COMMANDCODE_API_KEY}";
      }
    });
    editor.models.set("commandcode", v2models);
  });
}

const definition = { id: "commandcode", setup };

// Dual entry: V2 reads default.id/setup, V1 (>=1.18.29) calls default.server().
export default { ...definition, server };
