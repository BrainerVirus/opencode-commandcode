# AGENTS.md

OpenCode provider plugin (`@brainervirus/opencode-commandcode`). Ships a **bundled** model catalog (`models.json`) extracted from the minified `command-code` npm CLI. CI does the extracting — never hand-edit `models.json`, `manifest.json`, or `_version.txt`.

Layout: `src/` = runtime plugin + catalog engine (product, release-gated). `scripts/` = CI tooling (not published, not release-gated). `tests/unit/` = the only suite `bun run check` runs.

## Commands

- `bun run check` — the CI gate: `oxlint --deny-warnings` + `oxfmt --check` + `bun test tests/unit/` + `tsc --noEmit`. Run before every PR.
- Single file: `bun test tests/unit/catalog.test.ts`
- Refresh catalog locally (writes `models.json`, `_version.txt`, `manifest.json`): `bun run sync -- --remote`

## Release rules — read before committing

On 2026-09-02 this repo published **42 accidental npm versions** (0.7.5→0.7.46) from an infinite loop. The rules below exist to prevent that. Do not relax them.

- Releases are path-gated (`scripts/analyze-release-scope.ts`): a commit counts only if it touches a product path — `plugin.ts`, `index.ts`, `models.json`, `manifest.json`, `_version.txt`, or `src/`. CI/docs/tests/scripts-only merges never release.
- Only **`fix|feat|perf`** commit subjects can cut a release. **`chore` never releases — not even `chore(scope)`.** The post-release automation commits `chore(release): sync manifests to vX` touching `package.json` + `manifest.json` (both product paths): making any `chore` releasable turns each release into the trigger for the next one — release → sync PR → merge → release → …
- The intended release path for catalog updates is the automation's `fix(catalog): sync command-code@X` commit (patch). Do not rename it to `chore(catalog)`.
- `package.json` / `manifest.json` version fields are written by automation only; don't bump them in feature PRs.

## Docs rule — shipped behavior changes touch docs in the same branch

Any branch that changes shipped behavior — `plugin.ts`, `index.ts`, `src/**`, or the sync pipeline in `scripts/sync-models.ts` — must also touch `README.md` or the matching spec under `docs/specs/` in the same branch. Plans and task notes are not committed; specs describe what ships. Verify with `git diff --name-only main...HEAD`: if it lists a behavior path, it must also list `README.md` or a `docs/specs/` file.

## Catalog extraction (`src/catalog.ts`) — fragile by design

- It slices balanced `{…}` spans around the anchor `SONNET_4_6:{id:"claude-sonnet-4-6"` and evals them with string bindings collected from the 12k chars before the anchor (`extractStringBindings`).
- Minified identifier names are **not stable** across `command-code` releases. 1.40.x introduced `$`-prefixed vars (`$R="vercel-ai-gateway"`); `\b` regex boundaries never fire before `$` (not a word char) — use `(?<![A-Za-z0-9_$])` lookbehind instead. Same for alias resolution.
- Symptom of a new bundle shape: `Could not evaluate model catalog` — every candidate span threw and errors were swallowed. To debug: download the tarball (`https://registry.npmjs.org/command-code/-/command-code-<v>.tgz`, bundle is `dist/cli.mjs`), eval candidates manually with the same context, and surface the real ReferenceError (usually a missing binding, e.g. `$R is not defined`).
- Every extraction fix ships with a regression test in `tests/unit/catalog.test.ts` whose fixture mirrors the new minified shape. `isModelCatalog` requires ≥2 model entries — single-model fixtures fail.

## CI automation

- `catalog-sync.yml`: every 6h + manual dispatch. Extracts `command-code@latest`, opens a `fix(catalog)` PR (branch `chore/catalog-sync`) that auto-merges when the five `check *` jobs pass. On extraction failure it opens/updates a **catalog-break issue** — labels `catalog-break` and `automation` must exist on the repo (recreate with `gh label create` if missing).
- `release.yml`: semantic-release on every push to `main` (npm publish + tag + GitHub Release), then opens the `chore(release): sync manifests` PR which also auto-merges.
- `main` is protected (5 required checks). Never push to `main` — open a PR and let auto-merge handle it.
- `workflow_dispatch` always runs a workflow from **`main`**, never a PR head. Dispatching does not test your branch.
- Secrets: `NPMJS` (npm **Automation** token, mapped to `NPM_TOKEN`/`NODE_AUTH_TOKEN` — a login token fails with `EOTP`), `RELEASE_SYNC_TOKEN` (PAT; PRs opened with `GITHUB_TOKEN` do not trigger CI runs on their branch).

## Runtime weight + validation boundaries (2026-09-26: dist/plugin.js ~708KB after zod)

- `src/schemas.ts` is the single source of truth for `ModelEntry` / `CatalogManifest` shapes. `src/catalog.ts` and `src/manifest.ts` derive them via `z.infer` — never redeclare the shape. Verify: `grep -rn "interface ModelEntry\|type CatalogManifest = {" src` must be empty.
- zod lives only at validation boundaries (bundled `models.json` / `manifest.json` reads in `plugin.ts`, provider availability payloads, user config files). Hot paths (`src/convert.ts`, `src/stream.ts`, `src/model.ts`, the `generate*` model loops) stay zod-free. Verify: `grep -rn 'from "zod"' src/convert.ts src/stream.ts src/model.ts` must be empty.
- `dist/plugin.js` budget: ~708KB with zod bundled (was ~45KB type-only). A second runtime dependency requires either `--external` in `scripts/build-plugin.ts` or updating this budget line. Verify: `bun run build && du -h dist/plugin.js`.
- V1 (`generateOpencodeModels` in `src/catalog.ts`) and V2 (`toV2Model` in `src/v2models.ts`) cost/limit/modality mappings must stay in parity — change one, update the other plus `tests/unit/v2models.test.ts`. UI/map keys use `toConfigKey` in `src/catalog.ts` (do not duplicate it); the Command Code wire id is always catalog `entry.id` (V1 model `id`, V2 `modelID`) — bare short names 400 as unsupported_model.
- Entry points: `plugin.ts` owns all config-hook logic; `index.ts` re-exports + SDK factory; `src/entry.ts` is bundle glue for `scripts/build-plugin.ts` only. Do not add a fourth entry or duplicate the catalog-load path.
