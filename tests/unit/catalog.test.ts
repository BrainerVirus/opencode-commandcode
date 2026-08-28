import { expect, test, describe } from "bun:test"
import {
  buildModelEntry,
  disambiguateModelNames,
  generateOpencodeModels,
  loadCatalogFromBundle,
  resolveCommandCodePackage,
  type CostEntry,
  type SnEntry,
} from "../../src/catalog.ts"

function costMapOf(entries: CostEntry[]): Map<string, CostEntry> {
  const map = new Map<string, CostEntry>()
  for (const entry of entries) {
    const colonIdx = entry.id.indexOf(":")
    const bareId = colonIdx >= 0 ? entry.id.slice(colonIdx + 1) : entry.id
    map.set(bareId, entry)
  }
  return map
}

const sampleCost: CostEntry = {
  id: "anthropic:claude-sonnet-4-6",
  provider: "anthropic",
  category: "premium",
  promptCost: 3,
  completionCost: 15,
  cacheWrite5mCost: 3.75,
  cacheWrite1hCost: 6,
  cacheHitCost: 0.3,
}

describe("buildModelEntry", () => {
  test("preserves reasoningEfforts and sets reasoning true", () => {
    const sn: SnEntry = {
      id: "claude-sonnet-4-6",
      provider: "anthropic",
      spec: "chatComplete",
      label: "Sonnet",
      name: "Claude Sonnet 4.6",
      description: "test",
      reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
    }
    const entry = buildModelEntry(sn, costMapOf([sampleCost]))
    expect(entry).not.toBeNull()
    expect(entry!.reasoning).toBe(true)
    expect(entry!.reasoningEfforts).toEqual(["low", "medium", "high", "xhigh", "max"])
    expect(entry!.tier).toBe("premium")
  })

  test("omits reasoningEfforts when absent and reasoning false", () => {
    const sn: SnEntry = {
      id: "claude-sonnet-4-6",
      provider: "anthropic",
      spec: "chatComplete",
      label: "Sonnet",
      name: "Claude Sonnet 4.6",
      description: "test",
    }
    const entry = buildModelEntry(sn, costMapOf([sampleCost]))
    expect(entry).not.toBeNull()
    expect(entry!.reasoning).toBe(false)
    expect(entry!.reasoningEfforts).toBeUndefined()
  })

  test("sets reasoning true from explicit flag without efforts", () => {
    const sn: SnEntry = {
      id: "claude-sonnet-4-6",
      provider: "anthropic",
      spec: "chatComplete",
      label: "Sonnet",
      name: "Claude Sonnet 4.6",
      description: "test",
      reasoning: true,
    }
    const entry = buildModelEntry(sn, costMapOf([sampleCost]))
    expect(entry!.reasoning).toBe(true)
    expect(entry!.reasoningEfforts).toBeUndefined()
  })

  test("keeps models without cost data using default cost", () => {
    const sn: SnEntry = {
      id: "new-provider/new-reasoning-model",
      provider: "openrouter",
      spec: "chatComplete",
      label: "X",
      name: "X",
      description: "x",
      reasoningEfforts: ["low", "high"],
    }
    const entry = buildModelEntry(sn, new Map())
    expect(entry).not.toBeNull()
    expect(entry!.reasoning).toBe(true)
    expect(entry!.reasoningEfforts).toEqual(["low", "high"])
    expect(entry!.cost).toEqual({ input: 0.5, output: 2 })
  })
})

describe("disambiguateModelNames", () => {
  test("distinguishes models with the same upstream display name", () => {
    const entries = [
      {
        id: "MiniMaxAI/MiniMax-M3-Free",
        name: "MiniMax M3",
        tier: "open-source" as const,
        reasoning: true,
        tool_call: true,
        cost: { input: 0.5, output: 2 },
        limit: { context: 1000000, output: 65536 },
      },
      {
        id: "MiniMaxAI/MiniMax-M3",
        name: "MiniMax M3",
        tier: "open-source" as const,
        reasoning: true,
        tool_call: true,
        cost: { input: 0.5, output: 2 },
        limit: { context: 1000000, output: 65536 },
      },
    ]

    disambiguateModelNames(entries)
    expect(entries.map((entry) => entry.name).sort()).toEqual(["MiniMax M3", "MiniMax M3 Free"])
  })
})

describe("generateOpencodeModels", () => {
  test("emits variants from reasoningEfforts", () => {
    const models = generateOpencodeModels([
      {
        id: "claude-sonnet-4-6",
        name: "Claude Sonnet 4.6",
        tier: "premium",
        reasoning: true,
        reasoningEfforts: ["low", "high"],
        tool_call: true,
        cost: { input: 3, output: 15 },
        limit: { context: 200000, output: 16000 },
      },
    ])
    const entry = models["claude-sonnet-4-6"] as Record<string, unknown>
    expect(entry.reasoningEfforts).toEqual(["low", "high"])
    expect(entry.variants).toEqual({
      low: { reasoningEffort: "low" },
      high: { reasoningEffort: "high" },
    })
  })
})

describe("loadCatalogFromBundle", () => {
  test("extracts models and reasoningEfforts from minified-like fixture", () => {
    // Mirrors command-code bundle shape: (Wt={...}), spec consts, (e=>({CATALOG})), costs
    const source = [
      '(Wt={ANTHROPIC:"anthropic",OPENAI:"openai",VERCEL_AI_GATEWAY:"vercel-ai-gateway"});',
      'var Aa="chatComplete",Ba="responses",qt=Vt[0];',
      'var Sn=(Wt=>({',
      'SONNET_4_6:{id:"claude-sonnet-4-6",provider:Wt.ANTHROPIC,spec:Aa,label:"Sonnet",name:"Claude Sonnet 4.6",description:"d",reasoning:!0,reasoningEfforts:["low","medium","high"],contextWindow:2e5},',
      'GPT_X:{id:"gpt-5.5",provider:Wt.OPENAI,spec:Ba,label:"GPT",name:"GPT-5.5",description:"d",reasoningEfforts:["low","high"],contextWindow:256000}',
      '}))(Wt);',
      'var costs={anthropic:[{id:"anthropic:claude-sonnet-4-6",provider:"anthropic",category:"p",promptCost:3,completionCost:15,cacheWrite5mCost:3.75,cacheWrite1hCost:6,cacheHitCost:.3}],openai:[{id:"openai:gpt-5.5",provider:"openai",category:"p",promptCost:1,completionCost:2,cacheWrite5mCost:0,cacheWrite1hCost:0,cacheHitCost:0}]};',
    ].join("")

    const entries = loadCatalogFromBundle(source)
    expect(entries.length).toBeGreaterThanOrEqual(2)

    const sonnet = entries.find((e) => e.id === "claude-sonnet-4-6")
    expect(sonnet).toBeDefined()
    expect(sonnet!.reasoning).toBe(true)
    expect(sonnet!.reasoningEfforts).toEqual(["low", "medium", "high"])
    expect(sonnet!.tier).toBe("premium")
    expect(sonnet!.limit.context).toBe(200000)

    const gpt = entries.find((e) => e.id === "gpt-5.5")
    expect(gpt).toBeDefined()
    expect(gpt!.reasoning).toBe(true)
    expect(gpt!.reasoningEfforts).toEqual(["low", "high"])
  })

  test("returns models when cost extraction fails", () => {
    const source = [
      '(Wt={ANTHROPIC:"anthropic",OPENAI:"openai",VERCEL_AI_GATEWAY:"vercel-ai-gateway"});',
      'var Aa="chatComplete",Ba="responses",qt=Vt[0];',
      'var Sn=(Wt=>({',
      'SONNET_4_6:{id:"claude-sonnet-4-6",provider:Wt.ANTHROPIC,spec:Aa,label:"Sonnet",name:"Claude Sonnet 4.6",description:"d",reasoning:!0,reasoningEfforts:["low","medium","high"],contextWindow:2e5},',
      'GPT_X:{id:"gpt-5.5",provider:Wt.OPENAI,spec:Ba,label:"GPT",name:"GPT-5.5",description:"d",reasoningEfforts:["low","high"],contextWindow:256000}',
      '}))(Wt);',
    ].join("")

    const entries = loadCatalogFromBundle(source)
    const sonnet = entries.find((e) => e.id === "claude-sonnet-4-6")
    expect(sonnet).toBeDefined()
    expect(sonnet!.reasoningEfforts).toEqual(["low", "medium", "high"])
    expect(sonnet!.cost).toEqual({ input: 0.5, output: 2 })
  })
})

describe("resolveCommandCodePackage", () => {
  test("returns null for missing explicit path without throwing", () => {
    const prev = process.env.COMMANDCODE_PACKAGE_PATH
    delete process.env.COMMANDCODE_PACKAGE_PATH
    try {
      const result = resolveCommandCodePackage({
        packagePath: "D:\\definitely-not-a-real-command-code-path-xyz",
      })
      // May still find a global install; explicit bad path alone is ignored after fail
      // and resolution continues. Ensure no throw and shape is valid when present.
      if (result) {
        expect(result.root).toBeTruthy()
        expect(result.bundlePath).toBeTruthy()
        expect(result.version).toBeTruthy()
      } else {
        expect(result).toBeNull()
      }
    } finally {
      if (prev !== undefined) process.env.COMMANDCODE_PACKAGE_PATH = prev
    }
  })

  test("resolves explicit package root when valid", () => {
    // If command-code is installed globally/locally, resolve it and re-resolve via path
    const found = resolveCommandCodePackage()
    if (!found) {
      expect(found).toBeNull()
      return
    }
    const again = resolveCommandCodePackage({ packagePath: found.root })
    expect(again).not.toBeNull()
    expect(again!.root).toBe(found.root)
    expect(again!.bundlePath).toBe(found.bundlePath)
  })
})
