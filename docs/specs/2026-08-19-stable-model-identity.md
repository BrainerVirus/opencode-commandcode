# Command Code OpenCode Provider — Runtime Identity and Resilience

Status: shipped (updated 2026-09-26)

## Goal

Keep Command Code working reliably in OpenCode across Command Code release drift: no local `command-code` install required, no plugin hard-failure when costs are missing, and no startup output leaking into the OpenCode UI.

This spec describes the runtime behavior that ships. An earlier draft additionally proposed canonical ids, an alias table, `model.json` state migration, `(new)` badges, and reasoning-trace modes; those were never implemented (see Non-goals) and are intentionally absent.

## Catalog source priority

`loadCatalogEntries()` in `plugin.ts` resolves the catalog in this order:

1. **Opt-in local override** — only when `COMMANDCODE_PACKAGE_PATH` or `commandCodePackagePath` is set. A failed override is recorded and ignored.
2. **Bundled `models.json`** from the installed package (npm or `file://` checkout). Default runtime source.
3. **Last-good cache** — `catalog-cache.json` in the plugin state dir (`~/.local/state/opencode/commandcode-provider`, override `COMMANDCODE_PROVIDER_STATE_DIR`). Used only when bundled `models.json` is unreadable, invalid JSON, or not an array.

Every load with models rewrites the cache; every load writes `startup.json`. Write failures never fail startup.

## Validation boundaries

- `src/schemas.ts` (zod) is the source of truth for `ModelEntry` and `CatalogManifest`. `src/catalog.ts` and `src/manifest.ts` derive their types from it.
- Bundled `models.json` is parsed entry by entry; invalid entries are dropped and counted (first three reasons kept). Dropping any entry marks the load `degraded`.
- Bundled `manifest.json` is validated; a `degraded`/`broken` status marks the load `degraded` with the matching reason.
- Provider availability payloads (`AvailabilityPayloadSchema`) are validated in CI sync (`parseAvailabilityIds`), never at runtime.
- The plugin config file is parsed leniently (`PluginFileConfigSchema`): unknown keys are stripped and missing fields fall back to defaults.

## Failure matrix

| Subsystem failure | Required behavior |
|---|---|
| bundled `models.json` missing/corrupt | last-good cache if present; else empty models map |
| bundled manifest `degraded`/`broken` | continue; mark the load degraded with reason |
| cost data missing after the CI waterfall | continue; unmatched costs keep the placeholder and the manifest is `degraded` |
| provider availability call fails in sync | no artifact writes and a `catalog-break` issue; the previous catalog stays |
| opt-in local extract fails | ignore override; use bundled |
| auth/connect | registers on V1 regardless of catalog state |

Degraded reporting is internal: `startup.json` carries `degraded` and `degradedReason`, and V1/V2 registration is unchanged. There is no separate degraded UI.

## Stable model identity

- Catalog entry `id` is the Command Code wire id (for example `deepseek/deepseek-v4.1-flash`) and is what reaches the API. Bare short names 400 as `unsupported_model`.
- The OpenCode map key (and V2 model `id`) is `toConfigKey(entry.id)` in `src/catalog.ts`: the last `/` segment, lowercased (`deepseek-v4.1-flash`).
- V1: `provider.commandcode.models[key] = { id: entry.id, ... }`. V2: `{ id: toConfigKey, modelID: entry.id }`.
- No alias table and no state migration: OpenCode owns favorites/recents/variants, and removing a model never edits that state. Persisted selections survive as long as the map key is unchanged.
- Same-name flavors stay separate entries; the catalog id disambiguates them.

## Reasoning metadata

- When the bundled entry declares `reasoningEfforts`, V1 emits `variants[effort] = { reasoningEffort: effort }` and V2 emits `variants: [{ id, settings: { reasoningEffort } }]`. `generateOpencodeModels()` and `toV2Model()` must stay in parity.
- Reasoning trace rendering is transport/OpenCode-dependent; there is no stream adapter and no `reasoningTraceMode` reporting.

## Startup behavior

- Default is quiet: no `console.log`/`console.warn` in the plugin load path.
- `~/.local/state/opencode/commandcode-provider/startup.json` records `catalogSource` (`bundled`/`cache`/`opt-in-local`), `commandCodeVersion`, `modelCount`, `reasoningModelCount`, `degraded`, and `degradedReason`.
- `debugStartupLogs: true` mirrors the summary to stderr once.
- V1 `server()` registers provider defaults and the API-key auth method; V2 `setup()` adds/updates the provider inventory and models through transforms. Auth stays V1-only.

## Config

`~/.config/opencode/opencode-commandcode.json` (legacy name `commandcode-go-opencode-provider.json` still loads):

| Key | Default | Effect |
|---|---|---|
| `commandCodePackagePath` | `""` | opt-in local CLI override |
| `debugStartupLogs` | `false` | mirror the startup summary to stderr |
| `disableModelSync` | `false` | accepted for forward compatibility; no effect |

## Non-goals (not shipped)

- `canonicalId` / `providerModelId` alias table and `~/.local/state/opencode/model.json` migration; current map keys are deliberately suffix-only (`toConfigKey`).
- `(new)` badges, `firstSeenAt` metadata, `newBadgeDays`.
- Runtime Provider API merge or runtime price fetch.
- Reasoning trace stream adapter / `reasoningTraceMode`.
- `COST_ENRICHMENT_API_URL` third-party cost API.

If favorites migration is ever needed, reopen it as a new spec against the current `toConfigKey` keys.

## Test coverage

Unit tests exercise the shipped contract (`tests/unit/plugin.test.ts`, `startup.test.ts`, `schemas.test.ts`, `catalog.test.ts`, `v2models.test.ts`, `auth.test.ts`):

- bundled load, cache fallback, and dropped-entry degraded reasons
- V1 map key vs wire id; V2 `id` vs `modelID`
- reasoning variant parity between V1 and V2
- startup summary written; no stdout by default

## Related specs

- [CI catalog automation](./2026-08-28-ci-catalog-automation.md)
- [Catalog freshness](./2026-09-20-catalog-freshness.md)
