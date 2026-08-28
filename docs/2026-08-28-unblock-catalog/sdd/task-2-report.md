# Task 2 Report: Quiet bundled startup

## Status

**Complete.** Review findings fixed: tests isolate state via `COMMANDCODE_PROVIDER_STATE_DIR`; CA-04 and CA-05 covered at plugin level.

## Branch

`feature/2026-08-28-unblock-catalog` (in-place, no worktrees)

## Commits

| Hash | Message |
|------|---------|
| `131ef76` | `fix: load bundled catalog without leaking plugin logs into OpenCode` |
| `fb0d878` | `fix: isolate plugin test state and add CA-04/CA-05 coverage` |

## TDD workflow

1. **Red** — Added `tests/unit/startup.test.ts` and the `config does not write to stdout or stderr by default` test in `tests/unit/plugin.test.ts`. Ran `bun test tests/unit/startup.test.ts tests/unit/plugin.test.ts`: startup module missing; plugin test failed on `console.log` and npm version-check `console.warn`.
2. **Green** — Created `src/startup.ts` with cache/summary helpers; rewrote `plugin.ts` config hook per plan.
3. **Verify** — `bun test tests/unit/plugin.test.ts tests/unit/startup.test.ts tests/unit/catalog.test.ts`: **28 pass, 0 fail**.

## Files changed

| File | Action |
|------|--------|
| `src/startup.ts` | Created — `pluginStateDir`, `readCatalogCache`, `writeCatalogCache`, `writeStartupSummary`, `StartupSummary` type; re-exports `ModelEntry` from `./catalog.js` |
| `plugin.ts` | Rewritten config hook; removed `checkModelVersion`, `fetchModelsFromApi`, `mergeModels`; renamed `loadModels` → `loadBundledModels`; added `readBundledVersion` |
| `tests/unit/startup.test.ts` | Created — cache round-trip and startup summary tests |
| `tests/unit/plugin.test.ts` | Added silent-startup contract test |

## Spec coverage (Task 2)

| Requirement | Implementation |
|-------------|----------------|
| CA-02: No console.log/warn by default | Config hook only logs when `debugStartupLogs === true` (via `console.warn` with JSON summary) |
| CA-03: Bundled models.json default | Loads bundled catalog unless `commandCodePackagePath` or `COMMANDCODE_PACKAGE_PATH` is set |
| CA-04: Empty models still registers npm/env | Always sets `cc.npm`, `cc.name`, `cc.env`; `cc.models = generateOpencodeModels([])` → `{}` on total failure |
| CA-05: Last-good cache | `readCatalogCache()` fallback when bundled read fails; `writeCatalogCache()` after successful non-empty load |
| Startup diagnostics file | `writeStartupSummary()` → `~/.local/state/opencode/commandcode-provider/startup.json` |
| No `fetchModelsFromApi` | Removed entirely from plugin startup path |
| Delete `checkModelVersion` | Removed |
| Auth unchanged | `auth` block left identical |

## Config hook behavior (summary)

```
override set? → loadCatalogFromLocalCommandCode (opt-in-local)
else → loadBundledModels (bundled)
  fail → readCatalogCache (cache, degraded)
    fail → models=[], degraded
success + non-empty → writeCatalogCache
always → cc.models = generateOpencodeModels(models)
always → writeStartupSummary
debug only → console.warn summary JSON
```

## Test results

```
bun test tests/unit/plugin.test.ts tests/unit/startup.test.ts tests/unit/catalog.test.ts
28 pass, 0 fail, 66 expect() calls
```

Notable new assertions:

- Plugin config produces zero stdout/stderr captures while still populating models from bundled `models.json`.
- Cache round-trips `ModelEntry[]` through temp dir.
- `startup.json` written with expected `catalogSource` and `modelCount`.

## Concerns / follow-ups

- **Task 3 scope**: `fetchModelsFromApi` / API context merge removed from startup; reintroduction would need a separate opt-in if desired.
- **Bundled catalog age**: `_version.txt` still reports `1.1.0`; Task 3 refresh will update bundled catalog and version.

## Review fixes (post-131ef76)

| Finding | Fix |
|---------|-----|
| Plugin tests wrote to `~/.local/state/...` | `pluginStateDir()` honors `COMMANDCODE_PROVIDER_STATE_DIR`; plugin tests set it to a temp dir |
| No plugin-level CA-04/CA-05 tests | Added CA-04 (bundled+cache miss → `{}` models, npm/env set) and CA-05 (unreadable bundled → cache fallback) |

## Test results (review fix)

```
bun test tests/unit/plugin.test.ts tests/unit/startup.test.ts
21 pass, 0 fail, 44 expect() calls
```

New assertions:

- `pluginStateDir()` returns env override when `COMMANDCODE_PROVIDER_STATE_DIR` is set.
- CA-04: config still sets npm/name/env; `cc.models` is `{}` when bundled and cache both miss.
- CA-05: unreadable bundled catalog loads models from last-good cache; `startup.json` reports `catalogSource: "cache"` and `degraded: true`.

## Out of scope (not done)

- Task 3: official-docs costs, `sync-models.ts` changes, catalog refresh
- GitHub Actions, npm rename, identity aliases
