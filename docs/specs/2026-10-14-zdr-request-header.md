# Zero data retention request header

Status: implemented

## Goal

Command Code accounts opt into zero data retention (ZDR) with the `x-cmd-zdr: 1` request header. The CLI exposes that
opt-in as `CMD_ZDR=1`; this plugin talks to the Provider API directly, so before this change nothing in an OpenCode
session could request ZDR. Users on both OpenCode generations must be able to turn ZDR on with the same env var the CLI
documents, without editing provider internals.

Reference: [Command Code Provider API — Zero data retention](https://commandcode.ai/docs/provider#zero-data-retention-zdr).

## Decisions

### Opt-in surface

ZDR is on when either input is true:

- env `CMD_ZDR` parses as `1`, `true`, `yes`, or `on` (trimmed, case-insensitive); every other value — including
  `"0"`, `"false"`, `""`, and an unset variable — leaves ZDR off; or
- `~/.config/opencode/opencode-commandcode.json` sets `"zdr": true` (validated by `PluginFileConfigSchema`).

`PluginFileConfigSchema` falls back per field: an invalid sibling (`"debugStartupLogs": "false"`) resets only itself and
never discards a valid `zdr: true`. `zdr` itself fails safe: a missing key is off, but a present invalid value (the
string `"true"`, `1`, `null`) is on. A mistaken opt-in at worst surfaces as `422 cmd_zdr_no_providers`; a silently
dropped one would send prompts to non-ZDR upstreams.

The config flag adds a durable per-machine option; the env var keeps parity with the CLI. No CLI installation is
required for either.

### Scope: Provider API only

The ZDR documentation covers the Provider API (`/provider/v1/*`) only. Both plugin generations route every model there:
the default OpenAI-compatible package, and the Anthropic (Messages) and OpenAI (Responses) packages a model may select,
all inherit the provider's `/provider/v1` base URL. The SDK factory is the one surface on another endpoint.

### Header injection

The header value is always `1` and the key is always the lowercase `x-cmd-zdr`.

- **V1** (`plugin.ts` `server()`): the header is written into `provider.commandcode.options.headers` next to the
  existing default `baseURL`. OpenCode V1 merges provider `options` into every model of that provider, whichever
  `provider.npm` a model overrides, so one map reaches the OpenAI-compatible (Chat Completions), Anthropic (Messages),
  and OpenAI (Responses) routes. Custom npm transports keep owning their options, so the plugin does not add headers
  when the user replaced `npm`.
- **V2** (`plugin.ts` `setup()`): the header is written into the registered provider's `headers` on the add path and
  merged into the existing provider on the update path. Provider headers apply to every model of the provider,
  including models that select the Anthropic or Responses runtime package.
- **SDK factory** (`index.ts createCommandCode`): not injected. The factory calls `/alpha/generate`, where ZDR
  enforcement is unestablished, so it fails closed instead: when ZDR is requested, `languageModel()` throws before any
  request is sent. A caller ZDR header (any casing) decides, so `x-cmd-zdr: 1` throws and `x-cmd-zdr: 0` opts out of
  `CMD_ZDR`; without one, `CMD_ZDR` decides. The throw lives in `languageModel()`, not the factory, because
  `dist/plugin.js` also exports the factory to OpenCode's plugin loader.

### User override precedence

An existing value always wins: a user who sets `headers["x-cmd-zdr"] = "0"` keeps it, and other headers in the same map
survive untouched. Header names match case-insensitively: every spelling (`X-Cmd-Zdr`, `X-CMD-ZDR`) collapses into the
single lowercase key carrying the user's value (the lowercase spelling wins if several exist), because two spellings
would reach the wire as `x-cmd-zdr: 1, 0`. When ZDR is off the plugin never creates a `headers` key, so configurations without the opt-in are
byte-identical to the previous behavior.

## Out of scope

- Per-model ZDR selection. The API refuses ZDR-incapable models with `422 cmd_zdr_no_providers`; users who want that
  granularity can set `providers.commandcode.models.<id>.headers` themselves.
- Any behavior change for `typesafe/jev`: the decision model is not in the bundled catalog and has no ZDR-capable
  upstream.

## How ZDR capability can be known without a request

Checked on 2026-10-14 against `command-code@1.82.1` and the live Provider API:

- `GET /provider/v1/models` carries no ZDR field. The only per-model keys are `context_length`, `created`, `id`, `name`,
  `object`, `owned_by`, and `supported_endpoints`.
- The CLI bundle does know. `knownModelSupportsZdr()` and `modelSupportsZdr2()` consult two hardcoded denylists of
  models with no ZDR-capable upstream (23 IDs in 1.82.1; 22 are in the current bundled catalog). The CLI uses them to
  swap feature defaults so it never sends a request that would be refused.
- Live agreement: probing denylisted models with `x-cmd-zdr: 1` returned `422 cmd_zdr_no_providers` (4 of 5 sampled).
  The fifth returned `403 MODEL_NOT_IN_PLAN`, because the entitlement check runs before ZDR routing — so a probe cannot
  classify models the account cannot call.
- A refusal never reaches an upstream, so probing is free; an accepted request costs one generation.

Consequence: capability is knowable offline by extracting the denylist at sync time (the catalog job already downloads
that bundle), but the list is only as fresh as the CLI release, and account entitlements can mask it. The live suite
below therefore treats the API as the authority and discovers both outcomes dynamically.

## Verification

- `tests/unit/zdr.test.ts` covers env parsing, config/env precedence, and case-insensitive header merging.
- `tests/unit/schemas.test.ts` covers per-field config fallback and the fail-safe invalid `zdr` value.
- `tests/unit/plugin.test.ts` covers V1 injection, user-header precedence (mixed case included), the config file with an
  invalid sibling field or an invalid `zdr` value, the off state, and the custom-npm skip.
- `tests/unit/plugin-v2.test.ts` covers the same cases on the V2 add and update paths.
- `tests/unit/index.test.ts` covers the SDK fail-closed throw (`CMD_ZDR`, explicit header in any casing) with no request
  sent, the explicit `x-cmd-zdr: 0` opt-out, and the off state.
- `tests/integration/zdr.integration.test.ts` live-checks the Provider API with no hardcoded model ID: chat-capable IDs
  come from `GET /provider/v1/models`, are probed with the plugin's own ZDR header map until both a `200` and a
  `422 cmd_zdr_no_providers` are observed, and a no-header control on a refused model proves the header causes the
  refusal. A `400`/`401` among the probes fails the suite. Every request carries an `AbortSignal` with a deadline inside
  the test timeout, so a timed-out run cancels in-flight probes and starts no new ones. It is skipped unless
  `COMMANDCODE_API_KEY` is set and stays out of `bun run check`.
