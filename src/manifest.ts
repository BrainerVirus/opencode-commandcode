import { writeFileSync } from "fs"

export type CatalogStatus = "healthy" | "degraded" | "broken"
export type CostCatalogBest = "cli" | "docs" | "thirdParty" | "fallback" | "missing"

export type CostSources = {
  cli: number
  officialDocs: number
  thirdParty: number
  fallback: number
  unmatched: number
}

export type CatalogManifest = {
  schemaVersion: 1
  generatedAt: string
  pluginVersion: string
  commandCodeVersion: string
  commandCodeTarball: string
  modelCount: number
  reasoningModelCount: number
  extraction: {
    modelCatalog: "ok" | "failed"
    costCatalog: CostCatalogBest
    costCatalogError: string | null
  }
  costSources: CostSources
  status: CatalogStatus
}

export type BuildManifestInput = {
  pluginVersion: string
  commandCodeVersion: string
  commandCodeTarball: string
  modelCount: number
  reasoningModelCount: number
  modelCatalogOk: boolean
  costSources: CostSources
  generatedAt: string
  costCatalogError?: string | null
}

export function bumpPatch(version: string): string {
  const parts = version.split(".")
  const patch = Number(parts[2] ?? "0")
  return `${parts[0] ?? "0"}.${parts[1] ?? "0"}.${patch + 1}`
}

export function meetsModelCountFloor(modelCount: number, lastSuccessful: number | null): boolean {
  const floor = Math.max(20, Math.floor((lastSuccessful ?? 20) * 0.5))
  // ponytail: when there is no prior catalog, lastSuccessful is null and the floor is 20
  return modelCount >= (lastSuccessful === null ? 20 : floor)
}

export function bestCostCatalog(sources: CostSources): CostCatalogBest {
  if (sources.cli > 0) return "cli"
  if (sources.officialDocs > 0) return "docs"
  if (sources.thirdParty > 0) return "thirdParty"
  if (sources.fallback > 0) return "fallback"
  return "missing"
}

export function catalogStatus(modelCatalogOk: boolean, sources: CostSources): CatalogStatus {
  if (!modelCatalogOk) return "broken"
  if (sources.fallback > 0 || sources.unmatched > 0) return "degraded"
  return "healthy"
}

export function commandCodeTarballUrl(version: string): string {
  return `https://registry.npmjs.org/command-code/-/command-code-${version}.tgz`
}

export function buildManifest(input: BuildManifestInput): CatalogManifest {
  const status = catalogStatus(input.modelCatalogOk, input.costSources)
  return {
    schemaVersion: 1,
    generatedAt: input.generatedAt,
    pluginVersion: input.pluginVersion,
    commandCodeVersion: input.commandCodeVersion,
    commandCodeTarball: input.commandCodeTarball,
    modelCount: input.modelCount,
    reasoningModelCount: input.reasoningModelCount,
    extraction: {
      modelCatalog: input.modelCatalogOk ? "ok" : "failed",
      costCatalog: bestCostCatalog(input.costSources),
      costCatalogError: input.costCatalogError ?? null,
    },
    costSources: { ...input.costSources },
    status,
  }
}

export function writeManifest(path: string, manifest: CatalogManifest): void {
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8")
}

export function lastSuccessfulModelCount(manifest: CatalogManifest | null): number | null {
  if (!manifest) return null
  if (manifest.status === "broken") return null
  return manifest.modelCount
}
