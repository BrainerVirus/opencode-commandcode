import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, statSync } from "fs";
import { join } from "path";
import { homedir, tmpdir } from "os";
import { execSync } from "child_process";
import {
  NPM_PACKAGE,
  MODELS_API_URL,
  extractCostData,
  buildCostMap,
  filterCatalogByAvailability,
  generateOpencodeModels,
  loadCatalogFromBundle,
  loadCatalogFromLocalCommandCode,
  parseAvailabilityIds,
  type ModelEntry,
} from "../src/catalog.js";
import { applyDocCosts, fetchOfficialModelsMarkdown, parseModelsTable } from "../src/costs-docs.js";
import {
  applyFreeCosts,
  applyModelsDevCosts,
  applyModelsDevModalities,
  fetchModelsDevJson,
  parseModelsDev,
} from "../src/costs-models-dev.js";
import {
  buildManifest,
  commandCodeTarballUrl,
  countCostSources,
  lastSuccessfulModelCount,
  meetsModelCountFloor,
  withUnavailableIds,
  writeManifest,
  type CatalogManifest,
} from "../src/manifest.js";

export type SyncArtifacts = {
  models: ModelEntry[];
  version: string;
  manifest: CatalogManifest;
};

function readPriorManifest(): CatalogManifest | null {
  if (!existsSync(MANIFEST_PATH)) return null;
  try {
    return JSON.parse(readFileSync(MANIFEST_PATH, "utf-8")) as CatalogManifest;
  } catch {
    return null;
  }
}

async function fetchAvailabilityIds(): Promise<string[]> {
  const resp = await fetch(MODELS_API_URL);
  if (!resp.ok) throw new Error(`models endpoint returned ${resp.status}`);
  let payload: unknown;
  try {
    payload = await resp.json();
  } catch {
    throw new Error("models endpoint returned invalid JSON");
  }
  return parseAvailabilityIds(payload);
}

/** Build all model, version, and manifest contents before the first write. */
export function buildSyncArtifacts(input: {
  candidates: ModelEntry[];
  version: string;
  sourceLabel: string;
  pluginVersion: string;
  availableIds: string[];
  priorManifest: CatalogManifest | null;
  cliIds: Set<string>;
  docIds: Set<string>;
  thirdPartyIds: Set<string>;
  freeIds: Set<string>;
  generatedAt: string;
}): SyncArtifacts {
  const { retained, unavailable } = filterCatalogByAvailability(
    input.candidates,
    input.availableIds,
  );
  const last = lastSuccessfulModelCount(input.priorManifest);
  if (!meetsModelCountFloor(retained.length, last)) {
    throw new Error(`filtered model count ${retained.length} below floor (lastSuccessful=${last})`);
  }
  const costSources = countCostSources({
    modelIds: retained.map((e) => e.id),
    cliIds: input.cliIds,
    officialDocIds: input.docIds,
    thirdPartyIds: input.thirdPartyIds,
    freeIds: input.freeIds,
  });
  const unmatchedIds = retained
    .filter(
      (e) =>
        !input.cliIds.has(e.id) &&
        !input.docIds.has(e.id) &&
        !input.freeIds.has(e.id) &&
        !input.thirdPartyIds.has(e.id),
    )
    .map((e) => e.id);
  const manifest = buildManifest({
    pluginVersion: input.pluginVersion,
    commandCodeVersion: input.version,
    commandCodeTarball: commandCodeTarballUrl(input.version),
    modelCount: retained.length,
    reasoningModelCount: retained.filter((e) => e.reasoning).length,
    modelCatalogOk: true,
    costSources,
    review: withUnavailableIds(
      {
        thirdParty: [...input.thirdPartyIds],
        free: [...input.freeIds],
        unmatched: unmatchedIds,
      },
      unavailable,
    ),
    generatedAt: input.generatedAt,
  });
  return { models: retained, version: input.version, manifest };
}

function cliCostIds(source: string): Set<string> {
  try {
    return new Set(buildCostMap(extractCostData(source)).keys());
  } catch {
    return new Set();
  }
}

const PROJECT_ROOT = join(import.meta.dir, "..");
const MODELS_JSON = join(PROJECT_ROOT, "models.json");
const VERSION_PATH = join(PROJECT_ROOT, "_version.txt");
const MANIFEST_PATH = join(PROJECT_ROOT, "manifest.json");
const PACKAGE_JSON = join(PROJECT_ROOT, "package.json");
const GLOBAL_CONFIG = join(homedir(), ".config", "opencode", "opencode.jsonc");
const TMP_DIR = join(tmpdir(), "cc-model-sync");

async function fetchLatestBundle(): Promise<{ source: string; version: string }> {
  console.log(`Fetching latest ${NPM_PACKAGE} metadata...`);
  const metaResp = await fetch(`https://registry.npmjs.org/${NPM_PACKAGE}/latest`);
  if (!metaResp.ok) throw new Error(`npm registry returned ${metaResp.status}`);
  const meta = await metaResp.json();
  const version = meta.version as string;
  const tarball = meta.dist.tarball as string;
  console.log(`  Latest version: ${version}`);
  console.log(`  Tarball: ${tarball}`);

  mkdirSync(TMP_DIR, { recursive: true });
  const tgzPath = join(TMP_DIR, `${NPM_PACKAGE}.tgz`);

  console.log("Downloading tarball...");
  const tarballResp = await fetch(tarball);
  if (!tarballResp.ok) throw new Error(`tarball download returned ${tarballResp.status}`);
  const buffer = Buffer.from(await tarballResp.arrayBuffer());
  writeFileSync(tgzPath, buffer);

  console.log("Extracting...");
  execSync(`tar -xzf "${tgzPath}" -C "${TMP_DIR}"`, { stdio: "pipe" });

  const pkgRoot = join(TMP_DIR, "package");
  const candidates = [join(pkgRoot, "dist", "cli.mjs"), join(pkgRoot, "dist", "index.mjs")];
  const bundlePath =
    candidates.find((p) => existsSync(p) && statSync(p).size >= 4096) ??
    candidates.find((p) => existsSync(p));
  if (!bundlePath) throw new Error(`Bundle not found under ${pkgRoot}/dist`);

  const source = readFileSync(bundlePath, "utf-8");

  rmSync(TMP_DIR, { recursive: true, force: true });

  return { source, version };
}

function stripJsonc(input: string): string {
  let out = "";
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (ch === '"') {
      const start = i;
      i++;
      while (i < input.length && input[i] !== '"') {
        if (input[i] === "\\") i++;
        i++;
      }
      i++;
      out += input.slice(start, i);
    } else if (ch === "/" && input[i + 1] === "/") {
      while (i < input.length && input[i] !== "\n") i++;
    } else if (ch === "/" && input[i + 1] === "*") {
      i += 2;
      while (i < input.length && !(input[i] === "*" && input[i + 1] === "/")) i++;
      i += 2;
    } else {
      out += ch;
      i++;
    }
  }
  return out.replace(/,\s*([}\]])/g, "$1");
}

function updateGlobalConfig(modelsObj: Record<string, unknown>) {
  if (!existsSync(GLOBAL_CONFIG)) {
    console.log(`  Global config not found at ${GLOBAL_CONFIG}, skipping`);
    return;
  }

  const raw = readFileSync(GLOBAL_CONFIG, "utf-8");
  const jsonStr = stripJsonc(raw);

  let config: any;
  try {
    config = JSON.parse(jsonStr);
  } catch {
    console.error("  Failed to parse global config as JSON after stripping comments");
    return;
  }

  if (!config.provider) config.provider = {};
  if (!config.provider.commandcode) {
    config.provider.commandcode = {
      npm: "commandcode-go-opencode-provider",
      name: "Command Code",
      env: ["COMMANDCODE_API_KEY"],
    };
  }
  config.provider.commandcode.models = modelsObj;

  const output = JSON.stringify(config, null, 2) + "\n";
  writeFileSync(GLOBAL_CONFIG, output, "utf-8");
  console.log(`  Updated ${GLOBAL_CONFIG}`);
}

async function main() {
  const args = process.argv.slice(2);
  const shouldUpdateGlobal = args.includes("--update-global");
  const forceRemote = args.includes("--remote");

  let version: string;
  let sourceLabel: string;
  let bundleSource: string | null = null;

  const local = !forceRemote ? loadCatalogFromLocalCommandCode() : null;
  let candidates: ModelEntry[];
  if (local) {
    candidates = local.models;
    version = local.version;
    bundleSource = local.bundleSource;
    sourceLabel = `local ${local.root}`;
    console.log(`Loaded catalog from local command-code@${version}`);
    console.log(`  Path: ${local.root}`);
    console.log(`  Models: ${candidates.length}`);
  } else {
    const bundle = await fetchLatestBundle();
    version = bundle.version;
    bundleSource = bundle.source;
    sourceLabel = `npm tarball v${version}`;
    console.log(`Read CLI bundle v${version} (${(bundle.source.length / 1024).toFixed(0)} KB)`);
    console.log("Extracting model catalog...");
    candidates = loadCatalogFromBundle(bundle.source);
    console.log(`  Found ${candidates.length} models`);
  }

  const priorManifest = readPriorManifest();
  console.log("Fetching callable model availability...");
  const availableIds = await fetchAvailabilityIds();
  console.log(`  Callable models: ${availableIds.length}`);
  const { retained, unavailable } = filterCatalogByAvailability(candidates, availableIds);
  console.log(`  Retained ${retained.length}, excluded ${unavailable.length} unavailable`);
  const last = lastSuccessfulModelCount(priorManifest);
  if (!meetsModelCountFloor(retained.length, last)) {
    throw new Error(
      `filtered model count ${retained.length} below floor (lastSuccessful=${last}); leaving generated artifacts unchanged`,
    );
  }
  const entries = retained;

  const cliIds = bundleSource ? cliCostIds(bundleSource) : new Set<string>();
  const docIds = new Set<string>();
  const docsMd = await fetchOfficialModelsMarkdown();
  if (docsMd) {
    const filled = applyDocCosts(entries, parseModelsTable(docsMd), cliIds, docIds);
    console.log(
      `  Applied official-docs costs to ${filled} models (${cliIds.size} kept CLI costs)`,
    );
  } else {
    console.log("  Official docs returned no parseable cost table; keeping CLI costs");
  }

  const priced = new Set([...cliIds, ...docIds]);
  const freeIds = new Set<string>();
  const freeFilled = applyFreeCosts(entries, priced, freeIds);
  console.log(`  Applied free SKU $0 to ${freeFilled} models`);

  const thirdPartyIds = new Set<string>();
  const skipAfterFree = new Set([...priced, ...freeIds]);
  let modelsDevRows: ReturnType<typeof parseModelsDev> = [];
  try {
    const modelsDevJson = await fetchModelsDevJson();
    modelsDevRows = parseModelsDev(modelsDevJson);
    const filled = applyModelsDevCosts(entries, modelsDevRows, skipAfterFree, thirdPartyIds);
    console.log(`  Applied models.dev costs to ${filled} models`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`  models.dev fill skipped: ${message}`);
  }
  const modalityFilled = applyModelsDevModalities(entries, modelsDevRows);
  console.log(`  Applied models.dev modalities to ${modalityFilled} models`);

  console.log(`\nWriting ${MODELS_JSON} with ${entries.length} models from ${sourceLabel}...`);
  writeFileSync(MODELS_JSON, JSON.stringify(entries, null, 2) + "\n", "utf-8");
  writeFileSync(VERSION_PATH, `${version}\n`, "utf-8");

  const pluginVersion = (JSON.parse(readFileSync(PACKAGE_JSON, "utf-8")) as { version: string })
    .version;
  const unmatchedIds = entries
    .filter(
      (e) =>
        !cliIds.has(e.id) && !docIds.has(e.id) && !freeIds.has(e.id) && !thirdPartyIds.has(e.id),
    )
    .map((e) => e.id);
  const costSources = countCostSources({
    modelIds: entries.map((e) => e.id),
    cliIds,
    officialDocIds: docIds,
    thirdPartyIds,
    freeIds,
  });
  writeManifest(
    MANIFEST_PATH,
    buildManifest({
      pluginVersion,
      commandCodeVersion: version,
      commandCodeTarball: commandCodeTarballUrl(version),
      modelCount: entries.length,
      reasoningModelCount: entries.filter((e) => e.reasoning).length,
      modelCatalogOk: true,
      costSources,
      review: withUnavailableIds(
        {
          thirdParty: [...thirdPartyIds],
          free: [...freeIds],
          unmatched: unmatchedIds,
        },
        unavailable,
      ),
      generatedAt: new Date().toISOString(),
    }),
  );

  const modelsObj = generateOpencodeModels(entries);

  if (shouldUpdateGlobal) {
    console.log("Updating global config...");
    updateGlobalConfig(modelsObj);
  }

  console.log("\nModel list:");
  for (const entry of entries) {
    const cost = `$${entry.cost.input}/$${entry.cost.output}`;
    const efforts = entry.reasoningEfforts?.length
      ? ` efforts=[${entry.reasoningEfforts.join(",")}]`
      : "";
    console.log(
      `  ${entry.tier.padEnd(12)} ${entry.id.padEnd(35)} ${entry.name.padEnd(25)} ${cost}${efforts}`,
    );
  }

  if (!shouldUpdateGlobal) {
    console.log(`\nRun with --update-global to update ${GLOBAL_CONFIG}`);
  }

  console.log("\nDone.");
}

main();
