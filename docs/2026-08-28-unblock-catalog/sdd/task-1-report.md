# Task 1 Report: Costless bundle catalog load

## Status

DONE_WITH_CONCERNS

## Summary

Wrapped `extractCostData` in `loadCatalogFromBundle` with try/catch so cost extraction failures no longer abort catalog loading. Models receive default costs via `buildModelEntry` (`FALLBACK_COSTS` or `{ input: 0.5, output: 2 }`).

## TDD Evidence

### RED

1. Added test `returns models when cost extraction fails`.
2. First run with the brief's exact 1-model fixture **before** implementation:

```
(fail) loadCatalogFromBundle > returns models when cost extraction fails
error: Could not evaluate model catalog
      at extractModelCatalog (src/catalog.ts:406)
      at loadCatalogFromBundle (src/catalog.ts:542)
```

Root cause: `isModelCatalog` requires ≥2 model entries; the brief's 1-model fixture never reaches cost extraction.

3. With a 2-model fixture (happy-path shape, no cost block) **before** try/catch, `extractModelCatalog` succeeds but `loadCatalogFromBundle` would throw:

```
cost Could not find cost data anchor
```

This matches the plan's expected RED failure mode.

### GREEN

After wrapping `buildCostMap(extractCostData(source))` in try/catch:

```
bun test tests/unit/catalog.test.ts
 10 pass
 0 fail
```

New test assertions pass:
- `sonnet` defined with `reasoningEfforts: ["low", "medium", "high"]`
- `sonnet.cost` equals `{ input: 0.5, output: 2 }` (default via empty cost map)

Existing costful fixture still extracts numeric CLI costs (sonnet input 3, output 15).

## Files Changed

| File | Change |
| --- | --- |
| `src/catalog.ts` | `loadCatalogFromBundle`: optional cost map via try/catch |
| `tests/unit/catalog.test.ts` | New test for costless load |

## Commit

```
fd990b7 fix: load command-code models when cost extraction fails
```

## Self-Review

- **Correctness:** Production bundles have many models; catalog extraction succeeds, cost may throw — try/catch handles the real failure path (`command-code@1.38.0`).
- **Scope:** Did not change `extractCostData` or `plugin.ts`. No extra files added.
- **Regression:** Happy-path test unchanged and passing.
- **`loadCatalogFromLocalCommandCode`:** Already calls `loadCatalogFromBundle`; will stop returning `null` on cost-only failure (outer try/catch no longer needed for that case, but unchanged this task).

## Concerns

1. **Test fixture deviation:** The brief's exact 1-model source cannot pass `isModelCatalog` (requires ≥2 entries). The committed test adds a second model (`GPT_X`) with no cost block so RED fails on cost extraction as intended. Assertions still target Sonnet only.
2. **Plan RED expectation:** Plan Step 2 expected cost-anchor failure; verbatim 1-model fixture fails earlier at catalog extraction. Consider updating the plan/brief fixture or relaxing `isModelCatalog` in a follow-up if single-model test coverage is desired (CA-01).
