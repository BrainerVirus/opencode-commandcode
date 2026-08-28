import type { ModelEntry } from "./catalog.js";

export const MODELS_DEV_URL = "https://models.dev/api.json";
export const FREE_COST = { input: 0, output: 0 } as const;

export type ModelsDevRow = {
  id: string;
  name: string;
  cost: { input: number; output: number; cache_read?: number; cache_write?: number };
};

type ModelsDevModel = {
  id?: string;
  name?: string;
  cost?: { input?: number; output?: number; cache_read?: number; cache_write?: number };
};

type ModelsDevProvider = { models?: Record<string, ModelsDevModel> };

function lastSegment(id: string): string {
  const i = id.lastIndexOf("/");
  return i >= 0 ? id.slice(i + 1) : id;
}

export function isFreeSku(model: { id: string; name: string }): boolean {
  if (/-free$/i.test(model.id)) return true;
  return /\bfree\b/i.test(`${model.id} ${model.name}`);
}

export function parseModelsDev(json: string): ModelsDevRow[] {
  const data = JSON.parse(json) as Record<string, ModelsDevProvider>;
  const rows: ModelsDevRow[] = [];
  const seen = new Set<string>();
  for (const provider of Object.keys(data).sort()) {
    const models = data[provider]?.models ?? {};
    for (const model of Object.values(models)) {
      if (!model?.id || model.cost?.input === undefined || model.cost?.output === undefined)
        continue;
      const key = model.id.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const cost: ModelsDevRow["cost"] = { input: model.cost.input, output: model.cost.output };
      if (model.cost.cache_read !== undefined) cost.cache_read = model.cost.cache_read;
      if (model.cost.cache_write !== undefined) cost.cache_write = model.cost.cache_write;
      rows.push({ id: model.id, name: model.name ?? model.id, cost });
    }
  }
  return rows;
}

function indexRows(rows: ModelsDevRow[]) {
  const byId = new Map<string, ModelsDevRow>();
  const bySegment = new Map<string, ModelsDevRow>();
  const byName = new Map<string, ModelsDevRow>();
  for (const row of rows) {
    const idKey = row.id.toLowerCase();
    if (!byId.has(idKey)) byId.set(idKey, row);
    const segment = lastSegment(row.id).toLowerCase();
    if (!bySegment.has(segment)) bySegment.set(segment, row);
    const nameKey = row.name.toLowerCase();
    if (!byName.has(nameKey)) byName.set(nameKey, row);
  }
  return { byId, bySegment, byName };
}

function findRow(model: ModelEntry, index: ReturnType<typeof indexRows>): ModelsDevRow | undefined {
  return (
    index.byId.get(model.id.toLowerCase()) ??
    index.bySegment.get(lastSegment(model.id).toLowerCase()) ??
    index.byName.get(model.name.toLowerCase())
  );
}

export function applyFreeCosts(
  models: ModelEntry[],
  skipIds: Set<string>,
  filledIds?: Set<string>,
): number {
  let filled = 0;
  for (const model of models) {
    if (skipIds.has(model.id) || !isFreeSku(model)) continue;
    model.cost = { ...FREE_COST };
    filledIds?.add(model.id);
    filled++;
  }
  return filled;
}

export function applyModelsDevCosts(
  models: ModelEntry[],
  rows: ModelsDevRow[],
  skipIds: Set<string>,
  filledIds?: Set<string>,
): number {
  const index = indexRows(rows);
  let filled = 0;
  for (const model of models) {
    if (skipIds.has(model.id) || isFreeSku(model)) continue;
    const row = findRow(model, index);
    if (!row) continue;
    model.cost = { input: row.cost.input, output: row.cost.output };
    if (row.cost.cache_read !== undefined) model.cost.cache_read = row.cost.cache_read;
    if (row.cost.cache_write !== undefined) model.cost.cache_write = row.cost.cache_write;
    filledIds?.add(model.id);
    filled++;
  }
  return filled;
}

export async function fetchModelsDevJson(): Promise<string> {
  const resp = await fetch(MODELS_DEV_URL, {
    headers: {
      // ponytail: models.dev returns 403 without a browser-like UA; upgrade if they add a real API token
      "User-Agent":
        "Mozilla/5.0 (compatible; commandcode-go-opencode-provider/0.5; +https://github.com/BrainerVirus/opencode-commandcode-provider)",
      Accept: "application/json",
    },
  });
  if (!resp.ok) throw new Error(`models.dev returned ${resp.status}`);
  return resp.text();
}
