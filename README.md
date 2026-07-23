# commandcode-go-opencode-provider

[Command Code](https://commandcode.ai) API provider for [opencode](https://opencode.ai). Use Claude, GPT, Gemini, DeepSeek, Qwen, Kimi, GLM, MiniMax, Step, and other models through a single API key.

> **Forked from** [brent-weatherall/opencode-commandcode-provider](https://github.com/brent-weatherall/opencode-commandcode-provider) — originally created by [Brent Weatherall](https://github.com/brent-weatherall).


### Key improvements over upstream

- **Auto-load catalog from local command-code** — on startup, scrapes the model catalog (including `reasoningEfforts`) from your locally installed `command-code` npm package. Falls back to bundled `models.json` if the package is not found.
- **Reasoning effort variants** — models with `reasoningEfforts` automatically get `variants` (e.g. `low` / `medium` / `high` / `xhigh` / `max`). Upgrade `command-code` and restart to pick up new models and efforts — no manual sync needed.
- **Shared catalog module** — `src/catalog.ts` provides unified package resolution, bundle extraction, and model-building logic used by both the plugin and the sync command.
- **No more dropped models** — models without cost data now receive a conservative default cost instead of being silently dropped.
- **Deduplicated display names** — models sharing the same upstream display name (e.g. `MiniMax M3` / `MiniMax M3 Free`) are automatically disambiguated.
- **Windows compatibility** — sync temp directory now uses `os.tmpdir()` instead of hard-coded `/tmp`.

## Quick Start

### 1. Install

```bash
opencode plugin @fanfan4204/commandcode-go-opencode-provider
```

This installs the provider and registers all available models automatically.

> **Tip:** For the latest model catalog (including reasoning effort variants), install the `command-code` CLI globally:
> ```bash
> npm install -g command-code
> ```
> Without it, the plugin falls back to the bundled `models.json` which may be outdated.

### 2. Connect

Run `/connect` in opencode, search for **Command Code**, and enter your API key:

```
/connect
```

### 3. Select a model

Run `/models` to pick from available models:

```
/models
```

## Manual Configuration

If you prefer to configure manually, add this to your `opencode.json`:

```json
{
  "plugin": ["@fanfan4204/commandcode-go-opencode-provider/server"],
  "provider": {
    "commandcode": {
      "npm": "@fanfan4204/commandcode-go-opencode-provider",
      "name": "Command Code",
      "env": ["COMMANDCODE_API_KEY"]
    }
  },
  "model": "commandcode/deepseek-v4-flash"
}
```

The plugin auto-registers models at startup. It prefers the model catalog (including reasoning effort variants) from a locally installed [`command-code`](https://www.npmjs.com/package/command-code) package, and falls back to the bundled [`models.json`](./models.json) if that package is not found. You only need the `provider.commandcode` block — no need to list individual models.

Optional overrides:

- Env: `COMMANDCODE_PACKAGE_PATH` — path to the `command-code` package root (or its `dist/index.mjs`)
- Config file `~/.config/opencode/commandcode-go-opencode-provider.json`:
  ```json
  {
    "commandCodePackagePath": "C:/Users/you/AppData/Roaming/npm/node_modules/command-code",
    "disableModelSync": false
  }
  ```

### Environment Variable

Set `COMMANDCODE_API_KEY` instead of using `/connect`:

```bash
COMMANDCODE_API_KEY=your-key opencode
```

## Available Models

The full model list is maintained in [`models.json`](./models.json) as a fallback. Upgrade your local/global `command-code` install to pick up new models and reasoning efforts on the next OpenCode start. Run `bun run sync` to refresh the committed `models.json` from local `command-code` (or npm latest with `--remote`).

## Development

```bash
git clone https://github.com/FanFan4204/opencode-commandcode-provider.git
cd opencode-commandcode-provider
bun install
```

For local testing, create `opencode.local.json` (gitignored) with `file://` paths:

```json
{
  "plugin": ["file:///path/to/@fanfan4204/commandcode-go-opencode-provider/server"],
  "provider": {
    "commandcode": {
      "npm": "file:///path/to/commandcode-go-opencode-provider",
      "name": "Command Code (local)",
      "env": ["COMMANDCODE_API_KEY"]
    }
  }
}
```

Run `opencode --config opencode.local.json` to test with your local build.

### Sync Models

```bash
bun run sync              # update models.json from local command-code (npm latest if missing)
bun run sync -- --remote  # force download latest command-code tarball from npm
bun run sync:global       # update models.json + write to ~/.config/opencode/opencode.jsonc
```

At runtime OpenCode does not need `bun run sync` if `command-code` is installed locally or globally — the plugin scrapes that package on startup.

## License

MIT
