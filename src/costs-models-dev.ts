import type { ModelEntry } from "./catalog.js";

export const MODELS_DEV_URL = "https://models.dev/api.json";
export const FREE_COST = { input: 0, output: 0 } as const;
export const TEXT_ONLY_MODALITIES = { input: ["text"], output: ["text"] } as const;

export type ModelsDevPrice = {
  input: number;
  output: number;
  cache_read?: number;
  cache_write?: number;
};

export type ModelsDevContextTier = ModelsDevPrice & {
  tier: { type: "context"; size: number };
};

export type ModelsDevCost = ModelsDevPrice & {
  context_over_200k?: ModelsDevPrice;
  tiers?: ModelsDevContextTier[];
};

export type ModelsDevRow = {
  id: string;
  name: string;
  cost?: ModelsDevCost;
  attachment?: boolean;
  modalities?: { input: string[]; output: string[] };
  family?: string;
  release_date?: string;
  status?: "beta" | "deprecated";
  limit?: { input?: number };
};

type ModelsDevPriceInput = Partial<ModelsDevPrice>;

type ModelsDevModel = {
  id?: string;
  name?: string;
  cost?: ModelsDevPriceInput & {
    context_over_200k?: ModelsDevPriceInput;
    tiers?: Array<ModelsDevPriceInput & { tier?: { type?: string; size?: number } }>;
  };
  attachment?: boolean;
  modalities?: { input?: string[]; output?: string[] };
  family?: string;
  release_date?: string;
  status?: string;
  limit?: { input?: number };
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
  for (const provider of Object.keys(data).sort()) {
    const models = data[provider]?.models ?? {};
    for (const model of Object.values(models)) {
      if (!model?.id) continue;
      const row: ModelsDevRow = { id: model.id, name: model.name ?? model.id };
      const baseCost = parsePrice(model.cost);
      if (baseCost) {
        const cost: ModelsDevCost = baseCost;
        const over = parsePrice(model.cost?.context_over_200k);
        if (over) cost.context_over_200k = over;
        const tiers = model.cost?.tiers?.flatMap((item) => {
          if (
            item.tier?.type !== "context" ||
            !Number.isInteger(item.tier.size) ||
            !item.tier.size
          ) {
            return [];
          }
          const price = parsePrice(item);
          return price
            ? [{ ...price, tier: { type: "context" as const, size: item.tier.size! } }]
            : [];
        });
        if (tiers?.length) cost.tiers = tiers;
        row.cost = cost;
      }
      if (typeof model.attachment === "boolean") row.attachment = model.attachment;
      const input = model.modalities?.input?.filter((x) => typeof x === "string");
      const output = model.modalities?.output?.filter((x) => typeof x === "string");
      if (input?.length || output?.length) {
        row.modalities = {
          input: input?.length ? input : [...TEXT_ONLY_MODALITIES.input],
          output: output?.length ? output : [...TEXT_ONLY_MODALITIES.output],
        };
      }
      if (typeof model.family === "string" && model.family.trim()) row.family = model.family;
      if (
        typeof model.release_date === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(model.release_date)
      ) {
        const date = new Date(`${model.release_date}T00:00:00.000Z`);
        if (!Number.isNaN(date.valueOf()) && date.toISOString().startsWith(model.release_date)) {
          row.release_date = model.release_date;
        }
      }
      if (model.status === "beta" || model.status === "deprecated") row.status = model.status;
      if (
        typeof model.limit?.input === "number" &&
        Number.isInteger(model.limit.input) &&
        model.limit.input > 0
      ) {
        row.limit = { input: model.limit.input };
      }
      rows.push(row);
    }
  }
  return rows;
}

function parsePrice(value: ModelsDevPriceInput | undefined): ModelsDevPrice | undefined {
  if (
    !value ||
    typeof value.input !== "number" ||
    !Number.isFinite(value.input) ||
    typeof value.output !== "number" ||
    !Number.isFinite(value.output)
  ) {
    return undefined;
  }
  const price: ModelsDevPrice = { input: value.input, output: value.output };
  if (typeof value.cache_read === "number" && Number.isFinite(value.cache_read)) {
    price.cache_read = value.cache_read;
  }
  if (typeof value.cache_write === "number" && Number.isFinite(value.cache_write)) {
    price.cache_write = value.cache_write;
  }
  return price;
}

function indexRows(rows: ModelsDevRow[]) {
  const byId = new Map<string, ModelsDevRow>();
  const bySegment = new Map<string, ModelsDevRow>();
  const byName = new Map<string, ModelsDevRow>();
  const tiersById = new Map<string, ModelsDevRow[]>();
  const tiersBySegment = new Map<string, ModelsDevRow[]>();
  const tiersByName = new Map<string, ModelsDevRow[]>();
  const add = (index: Map<string, ModelsDevRow[]>, key: string, row: ModelsDevRow) => {
    const matches = index.get(key);
    if (matches) matches.push(row);
    else index.set(key, [row]);
  };
  for (const row of rows) {
    const idKey = row.id.toLowerCase();
    if (!byId.has(idKey)) byId.set(idKey, row);
    const segment = lastSegment(row.id).toLowerCase();
    if (!bySegment.has(segment)) bySegment.set(segment, row);
    const nameKey = row.name.toLowerCase();
    if (!byName.has(nameKey)) byName.set(nameKey, row);
    if (row.cost?.tiers?.length || row.cost?.context_over_200k) {
      add(tiersById, idKey, row);
      add(tiersBySegment, segment, row);
      add(tiersByName, nameKey, row);
    }
  }
  return { byId, bySegment, byName, tiersById, tiersBySegment, tiersByName };
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

function textOnly(): { input: string[]; output: string[] } {
  return { input: [...TEXT_ONLY_MODALITIES.input], output: [...TEXT_ONLY_MODALITIES.output] };
}

export function applyModelsDevModalities(models: ModelEntry[], rows: ModelsDevRow[]): number {
  const index = indexRows(rows);
  let filled = 0;
  for (const model of models) {
    const row = findRow(model, index);
    const current = model.modalities;
    if (current && model.attachment !== undefined) {
      const extra = row?.modalities?.input?.filter((x) => !current.input.includes(x)) ?? [];
      if (extra.length > 0) {
        model.modalities = {
          input: [...current.input, ...extra],
          output: [...current.output],
        };
        if (model.modalities.input.includes("image")) model.attachment = true;
        filled++;
      }
      continue;
    }
    if (row && (row.modalities || row.attachment !== undefined)) {
      const modalities = row.modalities
        ? { input: [...row.modalities.input], output: [...row.modalities.output] }
        : textOnly();
      model.modalities = modalities;
      model.attachment = row.attachment ?? modalities.input.includes("image");
      filled++;
    } else {
      model.attachment = false;
      model.modalities = textOnly();
    }
  }
  return filled;
}

export function applyModelsDevMetadata(models: ModelEntry[], rows: ModelsDevRow[]): number {
  const index = indexRows(rows);
  let filled = 0;
  for (const model of models) {
    const row = findRow(model, index);
    if (!row) continue;
    let changed = false;
    if (row.family !== undefined) {
      model.family = row.family;
      changed = true;
    }
    if (row.release_date !== undefined) {
      model.release_date = row.release_date;
      changed = true;
    }
    if (row.status !== undefined) {
      model.status = row.status;
      changed = true;
    }
    if (row.limit?.input !== undefined) {
      model.limit.input = row.limit.input;
      changed = true;
    }
    if (changed) filled++;
  }
  return filled;
}

export function applyModelsDevCostTiers(models: ModelEntry[], rows: ModelsDevRow[]): number {
  const index = indexRows(rows);
  let filled = 0;
  for (const model of models) {
    const sameBasePrice = (row: ModelsDevRow) =>
      row.cost?.input === model.cost.input && row.cost.output === model.cost.output;
    const costRow =
      index.tiersById.get(model.id.toLowerCase())?.find(sameBasePrice) ??
      index.tiersBySegment.get(lastSegment(model.id).toLowerCase())?.find(sameBasePrice) ??
      index.tiersByName.get(model.name.toLowerCase())?.find(sameBasePrice);
    const cost = costRow?.cost;
    if (!cost) continue;
    let changed = false;
    if (cost.tiers?.length) {
      model.cost.tiers = cost.tiers.map((tier) => ({ ...tier, tier: { ...tier.tier } }));
      changed = true;
    }
    if (cost.context_over_200k) {
      model.cost.context_over_200k = { ...cost.context_over_200k };
      changed = true;
    }
    if (changed) filled++;
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
    if (!row?.cost) continue;
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
        "Mozilla/5.0 (compatible; opencode-commandcode/0.5; +https://github.com/BrainerVirus/opencode-commandcode)",
      Accept: "application/json",
    },
  });
  if (!resp.ok) throw new Error(`models.dev returned ${resp.status}`);
  return resp.text();
}
