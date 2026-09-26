# CI Catalog Sync + npm Publish

Status: shipped (0.5.0, 2026-08-28; package renamed to `@brainervirus/opencode-commandcode` in 0.6.0)
**Branch:** `feature/2026-08-28-ci-catalog`
Parent: [docs/specs/2026-08-28-ci-catalog-automation.md](../specs/2026-08-28-ci-catalog-automation.md)

## Goal

Watch `command-code` on npm every 6 hours, refresh the bundled catalog, publish `@brainervirus/opencode-commandcode` patches, tag GitHub Releases only after npm succeeds, and open a `catalog-break` issue when model extraction cannot be auto-fixed.

## Locked (do not reopen)

- npm name: `@brainervirus/opencode-commandcode` with `publishConfig.access: "public"` (renamed from `@brainervirus/commandcode-go-opencode-provider` in 0.6.0).
- GitHub Actions secret name: `NPMJS` (same as workit). Map it to **both** `NPM_TOKEN` and `NODE_AUTH_TOKEN`. `setup-node` `registry-url` writes an `.npmrc` that only reads `NODE_AUTH_TOKEN`; `NPM_TOKEN` alone is not enough.
- Tag + GitHub Release **after** successful `npm publish` only. Never tag a version that is not on the registry.
- Bot catalog sync commits generated files to `chore/catalog-sync`, opens a `fix(catalog)` PR, and queues auto-merge. The PR is opened with `RELEASE_SYNC_TOKEN` (PAT) so checks run; `GITHUB_TOKEN`-opened PRs would not start workflows.
- Human merges to `main` run semantic-release; releases are path-gated (`scripts/analyze-release-scope.ts`), so CI/docs/tests-only merges do not publish.
- Cost-only CLI failure still ships (`degraded` only if unmatched placeholder costs remain). Model extract failure → no publish, `catalog-break` issue.
- Runtime catalog stays bundled `models.json`. No GitHub fetch at OpenCode startup.
- Hybrid OpenCode transport stays `@ai-sdk/openai-compatible` + Provider API; this package is the **plugin**, not the SDK `npm` field.

## First publish

Repo had no prior `@brainervirus/...` package. First version was `0.5.0` as `@brainervirus/commandcode-go-opencode-provider`; the package was renamed to `@brainervirus/opencode-commandcode` at `0.6.0`. After this landed on `main`, cron owns later catalog patches.
