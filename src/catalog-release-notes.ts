import type { CatalogManifest, CatalogStatus, CostSources } from "./manifest.js"

export type PricedModel = {
  id: string
  name: string
  cost: { input: number; output: number }
}

export type CatalogReleaseInput = {
  pluginVersion: string
  commandCodeVersion: string
  modelCount: number
  reasoningModelCount: number
  status: CatalogStatus
  costSources: CostSources
  models: PricedModel[]
  fallbackCosts: Record<string, { input: number; output: number }>
}

const DEFAULT_COST = { input: 0.5, output: 2 }

export function partitionPrices(
  models: PricedModel[],
  fallbackCosts: Record<string, { input: number; output: number }>,
): { official: PricedModel[]; fallback: PricedModel[]; unmatched: PricedModel[] } {
  const official: PricedModel[] = []
  const fallback: PricedModel[] = []
  const unmatched: PricedModel[] = []
  for (const model of models) {
    const known = fallbackCosts[model.id]
    if (known && known.input === model.cost.input && known.output === model.cost.output) {
      fallback.push(model)
    } else if (model.cost.input === DEFAULT_COST.input && model.cost.output === DEFAULT_COST.output) {
      unmatched.push(model)
    } else {
      official.push(model)
    }
  }
  return { official, fallback, unmatched }
}

function n(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

function headline(status: CatalogStatus): string {
  if (status === "healthy") {
    return "**Catalog is complete.** All listed prices come from Command Code or official docs."
  }
  if (status === "broken") {
    return "**Do not use this catalog.** Model extraction failed; OpenCode would not get a current model list."
  }
  return "**Safe to use.** Every model is listed. Some prices are estimates — expand the sections below to review them."
}

function priceSummary(sources: CostSources): string {
  const parts: string[] = []
  if (sources.cli > 0) parts.push(`${sources.cli} CLI`)
  if (sources.officialDocs > 0) parts.push(`${sources.officialDocs} official docs`)
  if (sources.thirdParty > 0) parts.push(`${sources.thirdParty} third-party`)
  if (sources.fallback > 0) parts.push(`${sources.fallback} known fallback${sources.fallback === 1 ? "" : "s"}`)
  if (sources.unmatched > 0) parts.push(`${sources.unmatched} no listed price`)
  return parts.join(" · ") || "none"
}

function money(n: number): string {
  return `$${n}`
}

function modelTable(models: PricedModel[]): string {
  const rows = models
    .map((m) => `| ${m.name} | \`${m.id}\` | ${money(m.cost.input)} / ${money(m.cost.output)} |`)
    .join("\n")
  return `| Model | Id | In / out per 1M |\n| --- | --- | --- |\n${rows}`
}

function details(summary: string, body: string): string {
  return `<details>\n<summary>${summary}</summary>\n\n${body}\n\n</details>`
}

export function renderCatalogReleaseNotes(input: CatalogReleaseInput): string {
  const { fallback, unmatched } = partitionPrices(input.models, input.fallbackCosts)
  const sections = [
    headline(input.status),
    "",
    "| | |",
    "| --- | --- |",
    `| Plugin | ${input.pluginVersion} |`,
    `| Command Code | ${input.commandCodeVersion} |`,
    `| Models | ${input.modelCount} (${input.reasoningModelCount} with reasoning) |`,
    `| Prices | ${priceSummary(input.costSources)} |`,
  ]

  if (fallback.length > 0) {
    sections.push(
      "",
      details(
        n(fallback.length, "model with a known fallback price", "models with known fallback prices"),
        modelTable(fallback),
      ),
    )
  }
  if (unmatched.length > 0) {
    sections.push(
      "",
      details(
        n(unmatched.length, "model with no official price ($0.50 / $2)", "models with no official price ($0.50 / $2)"),
        modelTable(unmatched),
      ),
    )
  }

  sections.push(
    "",
    details(
      "Machine-readable catalog",
      "```json\n" +
        JSON.stringify(
          {
            status: input.status,
            pluginVersion: input.pluginVersion,
            commandCodeVersion: input.commandCodeVersion,
            modelCount: input.modelCount,
            reasoningModelCount: input.reasoningModelCount,
            costSources: input.costSources,
          },
          null,
          2,
        ) +
        "\n```",
    ),
  )

  return sections.join("\n") + "\n"
}

export function catalogReleaseNotesFromFiles(input: {
  manifest: CatalogManifest
  models: PricedModel[]
  fallbackCosts: Record<string, { input: number; output: number }>
}): string {
  return renderCatalogReleaseNotes({
    pluginVersion: input.manifest.pluginVersion,
    commandCodeVersion: input.manifest.commandCodeVersion,
    modelCount: input.manifest.modelCount,
    reasoningModelCount: input.manifest.reasoningModelCount,
    status: input.manifest.status,
    costSources: input.manifest.costSources,
    models: input.models,
    fallbackCosts: input.fallbackCosts,
  })
}
