# @brainervirus/commandcode-go-opencode-provider

[Command Code](https://commandcode.ai) API provider for [opencode](https://opencode.ai). Use Claude, GPT, Gemini, DeepSeek, Qwen, Kimi, GLM, MiniMax, Step, and other models through a single API key.

> **Forked from** [brent-weatherall/opencode-commandcode-provider](https://github.com/brent-weatherall/opencode-commandcode-provider) — originally created by [Brent Weatherall](https://github.com/brent-weatherall).

This fork keeps a **bundled** model catalog current via CI. You do **not** need a local `command-code` CLI. Catalog patches publish automatically when Command Code ships a new npm version.

### Key improvements over upstream

- Bundled `models.json` is the default runtime catalog (no local CLI scrape).
- CLI cost extraction can fail (as on `command-code@1.38.x`) without dropping models.
- Official docs fill missing costs; leftover models use a conservative fallback (`degraded` in `manifest.json`).
- Reasoning effort **variants** on models that declare `reasoningEfforts`.
- Quiet OpenCode startup (diagnostics go to `startup.json`, not stdout).

## Quick Start

### 1. Install the plugin

```json
{
  "plugin": ["@brainervirus/commandcode-go-opencode-provider@latest"]
}
```

Pin a version instead of `@latest` if you do not want automatic catalog patches.

`file://` checkouts are **not** updated by npm; `git pull` after CI commits, or switch to the npm plugin line.

### 2. Provider transport (Command Code Provider API)

This plugin supplies model metadata. Point OpenCode at Command Code's documented Provider API:

```json
{
  "plugin": ["@brainervirus/commandcode-go-opencode-provider@latest"],
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

Maintainers only. OpenCode will scrape a local `command-code` install when `COMMANDCODE_PACKAGE_PATH` or `commandCodePackagePath` in `~/.config/opencode/commandcode-go-opencode-provider.json` is set.

## Development

```bash
git clone https://github.com/BrainerVirus/opencode-commandcode-provider.git
cd opencode-commandcode-provider
bun install
bun test tests/unit/
```

```bash
bun run sync -- --remote  # refresh models.json + manifest.json from command-code@latest
```

CI (`.github/workflows/catalog-sync.yml`) runs that every 6 hours, commits catalog files to `main`, publishes an npm patch when `NPMJS` is set, and creates a GitHub Release **after** publish. Model extraction failures open a `catalog-break` issue and do not publish.

The GitHub Actions secret name is `NPMJS` (same as workit). It is mapped to both `NPM_TOKEN` and `NODE_AUTH_TOKEN`.

## License

MIT
