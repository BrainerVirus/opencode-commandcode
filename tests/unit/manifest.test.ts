import { expect, test, describe } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import {
  buildManifest,
  bumpPatch,
  countCostSources,
  meetsModelCountFloor,
  writeManifest,
  type CostSources,
} from "../../src/manifest.ts"

const sources = (partial: Partial<CostSources> = {}): CostSources => ({
  cli: 0,
  officialDocs: 0,
  thirdParty: 0,
  fallback: 0,
  unmatched: 0,
  ...partial,
})

describe("bumpPatch", () => {
  test("increments the patch segment", () => {
    expect(bumpPatch("0.5.0")).toBe("0.5.1")
    expect(bumpPatch("1.2.9")).toBe("1.2.10")
  })
})

describe("meetsModelCountFloor", () => {
  test("uses 20 when there is no prior successful catalog", () => {
    expect(meetsModelCountFloor(20, null)).toBe(true)
    expect(meetsModelCountFloor(19, null)).toBe(false)
  })

  test("uses half of the last successful count when that is above 20", () => {
    expect(meetsModelCountFloor(32, 65)).toBe(true)
    expect(meetsModelCountFloor(31, 65)).toBe(false)
  })
})

describe("buildManifest", () => {
  test("marks healthy when every cost came from cli, docs, or third-party", () => {
    const manifest = buildManifest({
      pluginVersion: "0.5.0",
      commandCodeVersion: "1.38.1",
      commandCodeTarball: "https://registry.npmjs.org/command-code/-/command-code-1.38.1.tgz",
      modelCount: 65,
      reasoningModelCount: 54,
      modelCatalogOk: true,
      costSources: sources({ cli: 5, officialDocs: 60 }),
      generatedAt: "2026-08-28T17:00:00.000Z",
    })
    expect(manifest.status).toBe("healthy")
    expect(manifest.extraction.modelCatalog).toBe("ok")
    expect(manifest.extraction.costCatalog).toBe("cli")
    expect(manifest.schemaVersion).toBe(1)
    expect(manifest.gitCommit).toBeUndefined()
  })

  test("marks degraded when any model used fallback or unmatched costs", () => {
    const manifest = buildManifest({
      pluginVersion: "0.5.0",
      commandCodeVersion: "1.38.1",
      commandCodeTarball: "https://registry.npmjs.org/command-code/-/command-code-1.38.1.tgz",
      modelCount: 65,
      reasoningModelCount: 54,
      modelCatalogOk: true,
      costSources: sources({ officialDocs: 60, fallback: 3, unmatched: 2 }),
      generatedAt: "2026-08-28T17:00:00.000Z",
    })
    expect(manifest.status).toBe("degraded")
    expect(manifest.extraction.costCatalog).toBe("docs")
  })

  test("marks broken when the model catalog failed", () => {
    const manifest = buildManifest({
      pluginVersion: "0.5.0",
      commandCodeVersion: "1.38.1",
      commandCodeTarball: "https://registry.npmjs.org/command-code/-/command-code-1.38.1.tgz",
      modelCount: 0,
      reasoningModelCount: 0,
      modelCatalogOk: false,
      costSources: sources(),
      generatedAt: "2026-08-28T17:00:00.000Z",
      costCatalogError: "Could not evaluate model catalog",
    })
    expect(manifest.status).toBe("broken")
    expect(manifest.extraction.modelCatalog).toBe("failed")
  })
})

describe("writeManifest", () => {
  test("round-trips JSON with a trailing newline", () => {
    const dir = mkdtempSync(join(tmpdir(), "cc-manifest-"))
    try {
      const manifest = buildManifest({
        pluginVersion: "0.5.0",
        commandCodeVersion: "1.38.1",
        commandCodeTarball: "https://registry.npmjs.org/command-code/-/command-code-1.38.1.tgz",
        modelCount: 65,
        reasoningModelCount: 54,
        modelCatalogOk: true,
        costSources: sources({ officialDocs: 65 }),
        generatedAt: "2026-08-28T17:00:00.000Z",
      })
      const path = join(dir, "manifest.json")
      writeManifest(path, manifest)
      expect(JSON.parse(readFileSync(path, "utf-8"))).toEqual(manifest)
      expect(readFileSync(path, "utf-8").endsWith("\n")).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("countCostSources", () => {
  test("classifies first-hit cli then docs then fallback then unmatched", () => {
    const counted = countCostSources({
      modelIds: ["a", "b", "c", "d"],
      cliIds: new Set(["a"]),
      officialDocIds: new Set(["b"]),
      thirdPartyIds: new Set(),
      fallbackIds: new Set(["c"]),
    })
    expect(counted).toEqual({
      cli: 1,
      officialDocs: 1,
      thirdParty: 0,
      fallback: 1,
      unmatched: 1,
    })
  })
})
