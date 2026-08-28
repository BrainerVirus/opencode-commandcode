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
- CLI cost extraction can fail (as on `command-code@1.38.x`) without dropping models.
- Official docs fill missing costs; remaining paid gaps use [models.dev](https://models.dev) as a reference. Command Code free SKUs stay `$0`.
- Vision vs text-only comes from the Command Code CLI catalog (`inputModalities` on every SKU). [models.dev](https://models.dev) only adds extra inputs (video/audio/pdf) when it matches.
- Reasoning effort **variants** on models that declare `reasoningEfforts`.
- Quiet OpenCode startup (diagnostics go to `startup.json`, not stdout).

## Quick Start

### 1. Install the plugin

```json
{
  "plugin": ["@brainervirus/opencode-commandcode@latest"]
}
```

Pin a version instead of `@latest` if you do not want automatic catalog patches.

`file://` checkouts are **not** updated by npm; `git pull` after CI commits, or switch to the npm plugin line.

### 2. Provider transport (Command Code Provider API)

This plugin supplies model metadata. Point OpenCode at Command Code's documented Provider API:

```json
{
  "plugin": ["@brainervirus/opencode-commandcode@latest"],
  "provider": {
    "commandcode": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Command Code GOAT",
      "env": ["COMMANDCODE_API_KEY"],
      "options": {
        "baseURL": "https://api.commandcode.ai/provider/v1"
      }
    }
  }
}
```

### 3. Connect

Run `/connect` in opencode, search for **Command Code**, and enter your API key, or set `COMMANDCODE_API_KEY`.

### 4. Select a model

```
/models
```

## Optional local CLI override

Maintainers only. OpenCode will scrape a local `command-code` install when `COMMANDCODE_PACKAGE_PATH` or `commandCodePackagePath` in `~/.config/opencode/opencode-commandcode.json` is set.

## Development

```bash
git clone https://github.com/BrainerVirus/opencode-commandcode.git
cd opencode-commandcode
bun install
bun run check            # oxlint + oxfmt + bun test + tsc (same stack as workit)
```

```bash
bun run sync -- --remote  # refresh models.json + manifest.json from command-code@latest
```

CI (`.github/workflows/catalog-sync.yml`) opens a PR every 6 hours when Command Code ships a new catalog. Merge after **check (test)**, **check (typecheck)**, **check (lint)**, **check (format)**, and **check (pack)** are green. `.github/workflows/release.yml` then runs **semantic-release** (npm publish + GitHub Release + tag). Do not push to `main`.

The GitHub Actions secret name is `NPMJS` (same as workit). It is mapped to both `NPM_TOKEN` and `NODE_AUTH_TOKEN`. Use an npm **Automation** token (bypasses 2FA). A login token from `~/.npmrc` fails CI with `EOTP`. Catalog PRs get a real CI run when `RELEASE_SYNC_TOKEN` (or `CATALOG_PUSH_TOKEN`) is a PAT; `GITHUB_TOKEN` can open the PR but GitHub will not start workflows from that event.

## License

MIT — see [LICENSE](LICENSE). Original copyright [Brent Weatherall](https://github.com/brent-weatherall).
