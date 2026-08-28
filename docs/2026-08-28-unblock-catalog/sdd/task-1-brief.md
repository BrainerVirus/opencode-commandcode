# Task 1 brief

### Task 1: Costless bundle catalog load

Read and follow `docs/2026-08-28-unblock-catalog/plan.md` section `### Task 1` verbatim (test source, loadCatalogFromBundle implementation, commit message).

Files: modify src/catalog.ts loadCatalogFromBundle; test tests/unit/catalog.test.ts.

TDD: add test returns models when cost extraction fails; run bun test tests/unit/catalog.test.ts expect FAIL; wrap extractCostData in try/catch; run tests expect PASS; commit.

Do not change extractCostData. Do not touch plugin.ts. Work in-place on feature/2026-08-28-unblock-catalog at /home/cristhofer-pincetti/Documents/projects/personal/opencode-commandcode-provider. No git worktrees.

## Exact test (add inside describe("loadCatalogFromBundle"))

```ts
  test("returns models when cost extraction fails", () => {
    const source = [
      '(Wt={ANTHROPIC:"anthropic",OPENAI:"openai",VERCEL_AI_GATEWAY:"vercel-ai-gateway"});',
      'var Aa="chatComplete",Ba="responses",qt=Vt[0];',
      'var Sn=(Wt=>({',
      'SONNET_4_6:{id:"claude-sonnet-4-6",provider:Wt.ANTHROPIC,spec:Aa,label:"Sonnet",name:"Claude Sonnet 4.6",description:"d",reasoning:!0,reasoningEfforts:["low","medium","high"],contextWindow:2e5}',
      '}))(Wt);',
    ].join("")

    const entries = loadCatalogFromBundle(source)
    const sonnet = entries.find((e) => e.id === "claude-sonnet-4-6")
    expect(sonnet).toBeDefined()
    expect(sonnet!.reasoningEfforts).toEqual(["low", "medium", "high"])
    expect(sonnet!.cost).toEqual({ input: 0.5, output: 2 })
  })
```

## Exact implementation (replace loadCatalogFromBundle in src/catalog.ts)

```ts
export function loadCatalogFromBundle(source: string): ModelEntry[] {
  const models = extractModelCatalog(source)
  let costMap = new Map<string, CostEntry>()
  try {
    costMap = buildCostMap(extractCostData(source))
  } catch {
    // ponytail: CLI cost map is optional; buildModelEntry applies FALLBACK_COSTS / defaults
  }

  const entries: ModelEntry[] = []
  for (const model of Object.values(models)) {
    if (!model || typeof model !== "object" || typeof model.id !== "string") continue
    const entry = buildModelEntry(model, costMap)
    if (entry) entries.push(entry)
  }

  for (const extra of HARDCODED_EXTRAS) {
    if (!entries.some((e) => e.id === extra.id)) {
      const entry = buildModelEntry(extra, costMap)
      if (entry) entries.push(entry)
    }
  }

  return sortModelEntries(entries)
}
```

Commit:

```bash
git add src/catalog.ts tests/unit/catalog.test.ts
git commit -m "$(cat <<'EOF'
fix: load command-code models when cost extraction fails

EOF
)"
```


