# commandcode-go-opencode-provider

[Command Code](https://commandcode.ai) API provider for [opencode](https://opencode.ai). Use Claude, GPT, Gemini, DeepSeek, Qwen, Kimi, GLM, MiniMax, Step, and other models through a single API key.




## Quick Start

### 1. Install

```bash
opencode plugin commandcode-go-opencode-provider
```

This installs the provider and registers all available models automatically.

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
  "plugin": ["commandcode-go-opencode-provider/server"],
  "provider": {
    "commandcode": {
      "npm": "commandcode-go-opencode-provider",
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

| Model ID | Name | Tier | Reasoning | Context |
|---|---|---|---|---|
| `claude-fable-5`                           | Claude Fable 5              | premium      | yes | 1M     |
| `claude-haiku-4-5-20251001`                | Claude Haiku 4.5            | premium      | no  | 200K   |
| `claude-opus-4-7`                          | Claude Opus 4.7             | premium      | yes | 1M     |
| `claude-opus-4-8`                          | Claude Opus 4.8             | premium      | yes | 1M     |
| `claude-sonnet-4-6`                        | Claude Sonnet 4.6           | premium      | yes | 1M     |
| `claude-sonnet-5`                          | Claude Sonnet 5             | premium      | yes | 1M     |
| `gpt-5.3-codex`                            | GPT-5.3 Codex               | premium      | yes | 400K   |
| `gpt-5.4`                                  | GPT-5.4                     | premium      | yes | 400K   |
| `gpt-5.4-mini`                             | GPT-5.4 Mini                | premium      | yes | 400K   |
| `gpt-5.5`                                  | GPT-5.5                     | premium      | yes | 256K   |
| `gpt-5.6-luna`                             | GPT-5.6 Luna                | premium      | yes | 1M     |
| `gpt-5.6-sol`                              | GPT-5.6 Sol                 | premium      | yes | 1M     |
| `gpt-5.6-terra`                            | GPT-5.6 Terra               | premium      | yes | 1M     |
| `deepseek/deepseek-v4-flash`               | DeepSeek V4 Flash           | open-source  | yes | 1M     |
| `deepseek/deepseek-v4-pro`                 | DeepSeek V4 Pro             | open-source  | yes | 1M     |
| `google/gemini-3.1-flash-lite`             | Gemini 3.1 Flash Lite       | open-source  | yes | 1M     |
| `google/gemini-3.5-flash`                  | Gemini 3.5 Flash            | open-source  | yes | 1M     |
| `zai-org/GLM-5`                            | GLM-5                       | open-source  | no  | 200K   |
| `zai-org/GLM-5.1`                          | GLM-5.1                     | open-source  | no  | 200K   |
| `moonshotai/Kimi-K2.5`                     | Kimi K2.5                   | open-source  | no  | 256K   |
| `moonshotai/Kimi-K2.6`                     | Kimi K2.6                   | open-source  | no  | 256K   |
| `MiniMaxAI/MiniMax-M2.5`                   | MiniMax M2.5                | open-source  | no  | 200K   |
| `MiniMaxAI/MiniMax-M2.7`                   | MiniMax M2.7                | open-source  | no  | 1M     |
| `Qwen/Qwen3.6-Max-Preview`                 | Qwen 3.6 Max Preview        | open-source  | yes | 1M     |
| `Qwen/Qwen3.6-Plus`                        | Qwen 3.6 Plus               | open-source  | yes | 1M     |
| `Qwen/Qwen3.7-Max`                         | Qwen 3.7 Max                | open-source  | yes | 1M     |
| `stepfun/Step-3.5-Flash`                   | Step 3.5 Flash              | open-source  | yes | 1M     |

Full model list is maintained in [`models.json`](./models.json) as a fallback. Upgrade your local/global `command-code` install to pick up new models and reasoning efforts on the next OpenCode start. Run `bun run sync` to refresh the committed `models.json` from local `command-code` (or npm latest with `--remote`).

## Development

```bash
git clone https://github.com/FanFan4204/opencode-commandcode-provider.git
cd commandcode-go-opencode-provider
bun install
```

For local testing, create `opencode.local.json` (gitignored) with `file://` paths:

```json
{
  "plugin": ["file:///path/to/commandcode-go-opencode-provider/server"],
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
