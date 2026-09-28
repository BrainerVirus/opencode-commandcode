# @brainervirus/opencode-commandcode

[![npm version](https://img.shields.io/npm/v/@brainervirus/opencode-commandcode)](https://www.npmjs.com/package/@brainervirus/opencode-commandcode)
[![CI](https://img.shields.io/github/actions/workflow/status/BrainerVirus/opencode-commandcode/ci.yml?branch=main&label=CI)](https://github.com/BrainerVirus/opencode-commandcode/actions)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[Command Code](https://commandcode.ai) API provider for [opencode](https://opencode.ai). Use Claude, GPT, Gemini, DeepSeek, Qwen, Kimi, GLM, MiniMax, Step, and other models through a single API key.

This plugin is for Command Code accounts with Provider API access. GOAT is the live-tested baseline; other API-enabled plans can use models their account is entitled to. The $1 Go plan has no Provider API access. The catalog follows the provider-wide model list, so a model appearing in OpenCode does not imply that every account can call it. See [GOAT plan details](https://commandcode.ai/docs/plans/goat) and [Provider API docs](https://commandcode.ai/docs/provider).

This package keeps a **bundled** model catalog current via CI. You do **not** need a local `command-code` CLI. Catalog patches publish automatically after a green PR merges to `main`.

Previously published as `@brainervirus/commandcode-go-opencode-provider`. Use this name instead.

## Credits

This package is based on **[FanFan4204/opencode-commandcode-provider](https://github.com/FanFan4204/opencode-commandcode-provider)**. That work started from **[brent-weatherall/opencode-commandcode-provider](https://github.com/brent-weatherall/opencode-commandcode-provider)** by **[Brent Weatherall](https://github.com/brent-weatherall)**. Thank you both — FanFan for the OpenCode provider this repo continues, and Brent for the original plugin, catalog extraction.

### What this package adds

- Bundled `models.json` is the default runtime catalog (no local CLI scrape).
- V1 and V2 use their native plugin and provider surfaces. V1 `server()` fills `provider.commandcode` and registers API-key auth; V2 `setup()` registers provider/model transforms and a key/env integration for `/connect` and `opencode auth login`.
- Validation at the boundaries via `src/schemas.ts` (zod): bundled `models.json` / `manifest.json` reads, provider availability payloads, and the plugin config file.
- CLI cost extraction can fail without dropping models; official docs fill missing costs, remaining paid gaps use [models.dev](https://models.dev) as a reference price at sync time. Command Code free SKUs stay `$0`.
- Vision vs text-only comes from the Command Code CLI catalog (`inputModalities` on every SKU). [models.dev](https://models.dev) only adds extra inputs (video/audio/pdf) when it matches.
- Reasoning effort **variants** on models that declare `reasoningEfforts`.
- Release date, family, input limits, model status, vendor context limits, and matched context-price tiers flow through the bundled catalog. V2 gets native release, family, input, status, and tier fields; V1 keeps its supported fields and base prices, with `context_over_200k` where representable.
- Claude models use the Anthropic Messages package override in both host versions. This route is covered by mapping tests, but GOAT live validation returned a plan-entitlement rejection. If your API-enabled account can access a Claude model and the route fails, please [open an issue](https://github.com/BrainerVirus/opencode-commandcode/issues) with the model ID and OpenCode version, or submit a PR with a reproducible fix.
- Quiet OpenCode startup (diagnostics go to `startup.json`, not stdout).

## How it works

Each CI sync extracts the model catalog from the latest `command-code` npm bundle, merges costs, and commits versioned artifacts; at startup the plugin loads those artifacts and registers them with OpenCode — never the other way around.

- **Extract + filter** — model entries (ids, names, reasoning, `inputModalities`, limits) are evaluated out of the minified CLI bundle (`src/catalog.ts`), then intersected with the callable IDs reported by the provider API.
- **Metadata + costs merge** — vendor context length tightens only a fallback context limit; models.dev contributes release date, family, input limit, status, modalities, and cost tiers when present. Tier rows are accepted only when their base prices match this Command Code catalog. Base costs use CLI bundle → official Command Code docs → free SKUs (`$0`) → [models.dev](https://models.dev) reference prices → unmatched placeholder. Anything still unmatched marks the catalog `degraded`. This runs at sync time only; runtime never fetches metadata or prices.
- **Artifacts** — `models.json` (the catalog), `_version.txt` (upstream version), `manifest.json` (counts, per-source cost stats, `healthy`/`degraded`/`broken` status).
- **Version-specific registration** — V1 uses the `plugin` config key, `server()` provider map, and V1 auth callback. V2 uses `plugins`, provider/model transforms, and a `commandcode` integration with key and `COMMANDCODE_API_KEY` environment methods. Both retain the Command Code wire model ID. V2 exposes tiered context pricing; V1 emits its supported `context_over_200k` field and keeps flat pricing for other tiers.
- **Degraded/cache fallbacks** — a `degraded`/`broken` manifest sets the degraded flag with a reason; an unreadable bundled `models.json` falls back to the last-good cache; auth/connect still registers even with an empty catalog.

## Quick Start

### 1. Install the plugin

OpenCode V2:

```json
{
  "plugins": ["@brainervirus/opencode-commandcode@latest"]
}
```

OpenCode V1:

```json
{
  "plugin": ["@brainervirus/opencode-commandcode@latest"]
}
```

Pin a version instead of `@latest` if you do not want automatic catalog patches.

`file://` checkouts are **not** updated by npm; `git pull` after CI commits, or switch to the npm plugin line.

### 2. No provider block needed

On OpenCode V2 the plugin registers the `commandcode` provider, its models, and its API base URL through the V2 provider API. On V1 the `server` hook fills `provider.commandcode` defaults — `npm: "@ai-sdk/openai-compatible"` plus the Provider API `baseURL`; the plugin package itself is never the SDK `npm` field. Only add a manual provider entry if you need non-default transport options.

### 3. Connect

Set `COMMANDCODE_API_KEY`, or connect interactively. OpenCode V1 provides **Command Code** through `/connect`; OpenCode V2 registers key and environment methods for `/connect` and `opencode auth login commandcode`. V2 uses OpenCode's automatic provider activation and preserves an explicit activation setting. Connect before running a model; an explicit run while disconnected still returns an authorization error from the API.

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

Entry points: `plugin.ts` owns both config surfaces (V2 `id`/`setup` plus V1 `server`); `index.ts` re-exports the plugin plus the `createCommandCode` SDK factory; `src/entry.ts` is bundle glue for `scripts/build-plugin.ts` only — it produces `dist/plugin.js`.

CI (`.github/workflows/catalog-sync.yml`) opens a `fix(catalog)` PR every 6 hours when Command Code ships a new catalog; if extraction fails it opens a `catalog-break` issue instead. The PR auto-merges after **check (test)**, **check (typecheck)**, **check (lint)**, **check (format)**, and **check (pack)** are green. `.github/workflows/release.yml` then runs **semantic-release** (build + verified npm publish + GitHub Release + tag). Do not push to `main`.

The GitHub Actions secret name is `NPMJS`. It is mapped to both `NPM_TOKEN` and `NODE_AUTH_TOKEN`. Use an npm **Automation** token (bypasses 2FA). A login token from `~/.npmrc` fails CI with `EOTP`. Catalog PRs get a real CI run when `RELEASE_SYNC_TOKEN` is a PAT; `GITHUB_TOKEN` can open the PR but GitHub will not start workflows from that event.

## License

MIT — see [LICENSE](LICENSE). Original copyright [Brent Weatherall](https://github.com/brent-weatherall).
