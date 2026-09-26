# @brainervirus/opencode-commandcode

[![npm version](https://img.shields.io/npm/v/@brainervirus/opencode-commandcode)](https://www.npmjs.com/package/@brainervirus/opencode-commandcode)
[![CI](https://img.shields.io/github/actions/workflow/status/BrainerVirus/opencode-commandcode/ci.yml?branch=main&label=CI)](https://github.com/BrainerVirus/opencode-commandcode/actions)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[Command Code](https://commandcode.ai) API provider for [opencode](https://opencode.ai). Use Claude, GPT, Gemini, DeepSeek, Qwen, Kimi, GLM, MiniMax, Step, and other models through a single API key.

This package keeps a **bundled** model catalog current via CI. You do **not** need a local `command-code` CLI. Catalog patches publish automatically after a green PR merges to `main`.

Previously published as `@brainervirus/commandcode-go-opencode-provider`. Use this name instead.

## Credits

This package is based on **[FanFan4204/opencode-commandcode-provider](https://github.com/FanFan4204/opencode-commandcode-provider)**. That work started from **[brent-weatherall/opencode-commandcode-provider](https://github.com/brent-weatherall/opencode-commandcode-provider)** by **[Brent Weatherall](https://github.com/brent-weatherall)**. Thank you both — FanFan for the OpenCode provider this repo continues, and Brent for the original plugin, catalog extraction.

### What this package adds

- Bundled `models.json` is the default runtime catalog (no local CLI scrape).
- Dual OpenCode entry: V2 `setup` injects the provider plus models via transforms; V1 `server` fills `provider.commandcode` defaults plus models and registers API-key auth (auth stays V1-only).
- Validation at the boundaries via `src/schemas.ts` (zod): bundled `models.json` / `manifest.json` reads, provider availability payloads, and the plugin config file.
- CLI cost extraction can fail without dropping models; official docs fill missing costs, remaining paid gaps use [models.dev](https://models.dev) as a reference price at sync time. Command Code free SKUs stay `$0`.
- Vision vs text-only comes from the Command Code CLI catalog (`inputModalities` on every SKU). [models.dev](https://models.dev) only adds extra inputs (video/audio/pdf) when it matches.
- Reasoning effort **variants** on models that declare `reasoningEfforts`.
- Quiet OpenCode startup (diagnostics go to `startup.json`, not stdout).

## How it works

Each CI sync extracts the model catalog from the latest `command-code` npm bundle, merges costs, and commits versioned artifacts; at startup the plugin loads those artifacts and registers them with OpenCode — never the other way around.

- **Extract + filter** — model entries (ids, names, reasoning, `inputModalities`, limits) are evaluated out of the minified CLI bundle (`src/catalog.ts`), then intersected with the callable IDs reported by the provider API.
- **Costs merge** — per model, first hit wins: CLI bundle costs → official Command Code docs → free SKUs (`$0`) → [models.dev](https://models.dev) reference prices → unmatched placeholder. Anything still unmatched marks the catalog `degraded`. This runs at sync time only; runtime never fetches prices.
- **Artifacts** — `models.json` (the catalog), `_version.txt` (upstream version), `manifest.json` (counts, per-source cost stats, `healthy`/`degraded`/`broken` status).
- **V1 injection + V2 transform** — V1 `server()` fills `provider.commandcode` defaults and the models map; V2 `setup()` adds/updates the provider inventory (baseURL, API key binding) and sets models through `ctx.provider.transform`.
- **Degraded/cache fallbacks** — a `degraded`/`broken` manifest sets the degraded flag with a reason; an unreadable bundled `models.json` falls back to the last-good cache; auth/connect still registers even with an empty catalog.

## Quick Start

### 1. Install the plugin

```json
{
  "plugin": ["@brainervirus/opencode-commandcode@latest"]
}
```

Pin a version instead of `@latest` if you do not want automatic catalog patches. The config key stays `plugin` in OpenCode V2 — there is no `plugins` key.

`file://` checkouts are **not** updated by npm; `git pull` after CI commits, or switch to the npm plugin line.

### 2. No provider block needed

On OpenCode V2 the plugin registers the `commandcode` provider itself (Provider API base URL plus `COMMANDCODE_API_KEY` binding) and its models. On V1 the `server` hook fills the same `provider.commandcode` defaults — `npm: "@ai-sdk/openai-compatible"` plus the Provider API `baseURL`; the plugin package itself is never the SDK `npm` field. Only add a manual `provider.commandcode` entry if you need non-default transport options.

### 3. Connect

Set `COMMANDCODE_API_KEY`, or on OpenCode V1 run `/connect`, search for **Command Code**, and enter your API key. V2 registers the provider with the env binding; the `/connect` API-key method is V1-only.

### 4. Select a model

```
/models
```

Catalog patches arrive as plugin updates: `@latest` refreshes in the background and takes effect on the next OpenCode restart. If a new model is missing after an announced sync, restart opencode once.

## Plugin config file

Optional, `~/.config/opencode/opencode-commandcode.json` (legacy fallback name `commandcode-go-opencode-provider.json` still loads). Unknown keys are ignored; every field has a default.

| Key | Default | Effect |
|---|---|---|
| `commandCodePackagePath` | `""` | Maintainer override: extract the catalog from a local `command-code` checkout instead of the bundle. Same as env `COMMANDCODE_PACKAGE_PATH`. |
| `debugStartupLogs` | `false` | Also mirror the startup summary to stderr. Default is quiet (`startup.json` only). |
| `disableModelSync` | `false` | Accepted for forward compatibility; currently has no effect. |

## Optional local CLI override

Maintainers only. OpenCode will scrape a local `command-code` install when `COMMANDCODE_PACKAGE_PATH` or `commandCodePackagePath` in `~/.config/opencode/opencode-commandcode.json` is set.

## Development

```bash
git clone https://github.com/BrainerVirus/opencode-commandcode.git
cd opencode-commandcode
bun install
bun run check            # oxlint + oxfmt --check + bun test tests/unit/ + tsc (the release gate)
```

```bash
bun run sync -- --remote  # refresh models.json + manifest.json + _version.txt from command-code@latest
bun run build             # bundle src/entry.ts to dist/plugin.js
bun test tests/unit/      # unit suite (also via bun run test)
bun run test:integration  # live-endpoint tests, not part of the gate
bun run verify:release-candidate  # dry-run pack; manifest and package versions must match
bun run generate-readme   # reports catalog counts only; README is hand-edited
bun run catalog:ci        # entry used by the catalog-sync workflow
```

Entry points: `plugin.ts` owns all config-hook logic (dual default `{ id, setup }` plus `server`); `index.ts` re-exports the plugin plus the `createCommandCode` SDK factory; `src/entry.ts` is bundle glue for `scripts/build-plugin.ts` only — it produces `dist/plugin.js`.

CI (`.github/workflows/catalog-sync.yml`) opens a `fix(catalog)` PR every 6 hours when Command Code ships a new catalog; if extraction fails it opens a `catalog-break` issue instead. The PR auto-merges after **check (test)**, **check (typecheck)**, **check (lint)**, **check (format)**, and **check (pack)** are green. `.github/workflows/release.yml` then runs **semantic-release** (npm publish + GitHub Release + tag). Do not push to `main`.

The GitHub Actions secret name is `NPMJS`. It is mapped to both `NPM_TOKEN` and `NODE_AUTH_TOKEN`. Use an npm **Automation** token (bypasses 2FA). A login token from `~/.npmrc` fails CI with `EOTP`. Catalog PRs get a real CI run when `RELEASE_SYNC_TOKEN` is a PAT; `GITHUB_TOKEN` can open the PR but GitHub will not start workflows from that event.

## License

MIT — see [LICENSE](LICENSE). Original copyright [Brent Weatherall](https://github.com/brent-weatherall).
