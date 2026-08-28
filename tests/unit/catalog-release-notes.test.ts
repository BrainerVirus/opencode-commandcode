import { expect, test, describe } from "bun:test"
import { renderCatalogReleaseNotes, type CatalogReleaseInput } from "../../src/catalog-release-notes.ts"

const fallbackCosts = {
  "google/gemini-3.5-flash": { input: 1.5, output: 9 },
}

function input(partial: Partial<CatalogReleaseInput> = {}): CatalogReleaseInput {
  return {
    pluginVersion: "0.5.0",
    commandCodeVersion: "1.38.1",
    modelCount: 3,
    reasoningModelCount: 2,
    status: "degraded",
    costSources: { cli: 0, officialDocs: 1, thirdParty: 0, fallback: 1, unmatched: 1 },
    models: [
      { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", cost: { input: 3, output: 15 } },
      { id: "google/gemini-3.5-flash", name: "Gemini 3.5 Flash", cost: { input: 1.5, output: 9 } },
      { id: "tencent/Hy3", name: "Tencent Hy3 (Free)", cost: { input: 0.5, output: 2 } },
    ],
    fallbackCosts,
    ...partial,
  }
}

describe("renderCatalogReleaseNotes", () => {
  test("leads with a usable headline and hides the raw status word", () => {
    const md = renderCatalogReleaseNotes(input())
    expect(md).toContain("Safe to use")
    expect(md).not.toMatch(/^#.*degraded/m)
    expect(md.startsWith("degraded")).toBe(false)
  })

  test("puts counts in a compact table", () => {
    const md = renderCatalogReleaseNotes(input())
    expect(md).toContain("| Command Code | 1.38.1 |")
    expect(md).toContain("| Models | 3 (2 with reasoning) |")
    expect(md).toContain("1 official docs")
    expect(md).toContain("1 known fallback")
    expect(md).toContain("1 no listed price")
  })

  test("collapses fallback and unmatched model lists", () => {
    const md = renderCatalogReleaseNotes(input())
    expect(md).toContain("<details>")
    expect(md).toContain("<summary>1 model with a known fallback price</summary>")
    expect(md).toContain("<summary>1 model with no official price ($0.50 / $2)</summary>")
    expect(md).toContain("Gemini 3.5 Flash")
    expect(md).toContain("Tencent Hy3 (Free)")
    expect(md).toContain("tencent/Hy3")
  })

  test("healthy catalog skips the extra lists", () => {
    const md = renderCatalogReleaseNotes(
      input({
        status: "healthy",
        costSources: { cli: 0, officialDocs: 3, thirdParty: 0, fallback: 0, unmatched: 0 },
        models: [
          { id: "a", name: "A", cost: { input: 1, output: 2 } },
          { id: "b", name: "B", cost: { input: 1, output: 2 } },
          { id: "c", name: "C", cost: { input: 1, output: 2 } },
        ],
      }),
    )
    expect(md).toContain("All listed prices come from Command Code or official docs")
    expect(md).not.toContain("known fallback")
    expect(md).not.toContain("no official price")
  })

  test("broken catalog is explicit", () => {
    const md = renderCatalogReleaseNotes(
      input({
        status: "broken",
        modelCount: 0,
        reasoningModelCount: 0,
        models: [],
        costSources: { cli: 0, officialDocs: 0, thirdParty: 0, fallback: 0, unmatched: 0 },
      }),
    )
    expect(md).toContain("Do not use this catalog")
  })

  test("includes a collapsed machine-readable block for agents", () => {
    const md = renderCatalogReleaseNotes(input())
    expect(md).toContain("<summary>Machine-readable catalog</summary>")
    expect(md).toContain('"status": "degraded"')
    expect(md).toContain('"unmatched": 1')
  })
})
