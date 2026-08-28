# Task 3 Report: Official-docs costs and refresh bundled catalog

## Status

**DONE_WITH_CONCERNS**

## Branch

`feature/2026-08-28-unblock-catalog` (in-place, no worktrees)

## Summary

Added official-docs cost fill (`src/costs-docs.ts`) and wired `bun run sync --remote` to refresh the committed catalog from the latest `command-code` npm tarball. CLI cost ids win when extract succeeds; docs fill remaining rows by exact id then exact name; `buildModelEntry` fallback is last. Empty docs parse does not fail sync.

Live `/models` is an HTML table with extra columns (`Intelligence`, `Tok/s`, `Caps`), not the markdown fixture shape. Parser uses header names (not guessed indexes) and HTML `<tr>`/`<td>` after a real snippet fixture.

## TDD Evidence

### RED

1. `tests/unit/costs-docs.test.ts` + `tests/fixtures/command-code/models-page.md` before `src/costs-docs.ts`:

```
error: Cannot find module '../../src/costs-docs.ts'
 0 pass, 1 fail
```

2. After markdown parser green, live HTML fixture test (header names, extra columns):

```
expect(sonnet).toEqual({...})
+ undefined
(fail) parseModelsTable > parses live HTML using header names not column indexes
```

### GREEN

```
bun test tests/unit/costs-docs.test.ts
 4 pass, 0 fail, 17 expect() calls
```

### Refresh

```
bun run sync --remote
  Latest version: 1.38.1
  Found 65 models
  Applied official-docs costs to 60 models (0 kept CLI costs)
```

`_version.txt` is `1.38.1` (not `1.1.0`). CA-06 met.

## Files Changed

| File | Change |
| --- | --- |
| `src/costs-docs.ts` | Created — `parseMoneyCell`, `parseModelsTable` (pipe + HTML, header-named columns), `applyDocCosts`, `fetchOfficialModelsMarkdown` |
| `src/catalog.ts` | `LocalCatalogResult.bundleSource` for CLI cost-id tracking |
| `scripts/sync-models.ts` | After catalog load: `cliCostIds` + official-docs fill; console.log allowed |
| `tests/unit/costs-docs.test.ts` | Fixture + live HTML tests |
| `tests/fixtures/command-code/models-page.md` | Plan markdown fixture |
| `tests/fixtures/command-code/models-page.live.md` | Real `/models` table snippet (header + representative rows) |
| `models.json` | Regenerated, 65 models from command-code@1.38.1 |
| `_version.txt` | `1.38.1` |

## Commit

```
c26d6fc feat: fill catalog costs from official docs and refresh bundled models
```

## Spec coverage (this task)

| Requirement | Result |
|---|---|
| CA-06: `_version.txt` is not 1.1.0 after sync | `1.38.1` |
| CA-07: docs costs applied when CLI costs missing | 60/65 filled; 0 CLI ids (extract failed on 1.38.1 bundle) |
| Exact id then exact name | `applyDocCosts`: `byId` then `byName`, both case-insensitive |
| Do not fail sync if docs parse empty | `fetchOfficialModelsMarkdown` returns `""`; sync still writes |
| Plugin startup stays quiet | `plugin.ts` unchanged |

## Test results

```
bun test tests/unit/costs-docs.test.ts tests/unit/catalog.test.ts tests/unit/plugin.test.ts tests/unit/startup.test.ts
  all pass (plugin `withVariants` still holds; 31 models have reasoningEfforts)
```

Full `bun test tests/unit/`: **91 pass, 3 fail**. The 3 failures are pre-existing and unrelated to this task: `index.test.ts` / `auth.test.ts` still see a key from `~/.commandcode/auth.json` after deleting `COMMANDCODE_API_KEY`.

## Concerns

1. **CLI cost extract still fails on command-code@1.38.1** (`cliIds.size === 0`). Docs filled 60 models; 5 remain on `{ input: 0.5, output: 2 }` (name/id mismatch vs docs, e.g. Ling/MiniMax/Hy3 Free variants). When CLI extract starts working, those ids will win over docs.
2. **Docs id slugs vs catalog ids**: href `/models/gemini-3-7-flash` vs catalog `google/gemini-3.7-flash`. Name match saved billed Gemini 3.7 Flash (`$0.75/$3.75`). No fuzzy id mapping (spec: exact id then exact name).
3. **Live HTML shape**: extra columns; dual prices as `$1.50 $0.75`; visible name from `.truncate` span; id from `/models/{slug}`. Parser follows `models-page.live.md`, not guessed indexes.
4. **Full unit suite**: 3 auth/index failures when a local Command Code auth file exists; not introduced here.
