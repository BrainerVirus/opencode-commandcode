# End-to-End Command Code Catalog Freshness

Status: provider steps shipped (0.7.72, 2026-09-20); automatic warm-cache refresh remains an upstream OpenCode limitation

## Goal

OpenCode must show the current callable Command Code models after routine upstream releases, without requiring users to clear package caches or discover retired models by failed requests.

Freshness has three independent boundaries:

1. Command Code must identify which extracted models are currently callable.
2. This provider must publish only that callable catalog with internally consistent metadata.
3. OpenCode must make it clear when a mutable plugin package is stale and how to update it without losing a working cache.

## Current Failure

The provider extracted 78 entries from `command-code@1.58.1`, while the public Command Code models endpoint listed 71 callable IDs. The seven omitted entries include statically hidden promotions, a dynamically hidden promotion, and an unreleased model. Because extraction dropped Command Code's `hidden` state, those entries were shipped and displayed as selectable OpenCode models.

Separately, OpenCode can retain an older installation of `@brainervirus/opencode-commandcode@latest`. A current `models.json` therefore does not guarantee a current catalog on a user's machine.

The release pipeline also updated `manifest.json` after npm publication. Consequently, the manifest inside a newly published tarball could report the previous plugin version even though the repository was corrected by a later synchronization PR.

Provider-side resolution (2026-09-20): the availability filter shipped in `fix(catalog): exclude unavailable models` and the packed-manifest alignment shipped in `fix(release): align published manifest version`. The original request for automatic warm-cache replacement is not implemented by OpenCode V2.0.18; startup loads the cached package and does not replace it. The plugin cannot update the package code that is already running.

## Decisions

### Callable model authority

The public `GET https://api.commandcode.ai/provider/v1/models` response is the availability authority at synchronization time. The extractor output, combining metadata read from the Command Code CLI bundle with repository-maintained hardcoded entries for known bundle gaps, remains the metadata authority for fields that the endpoint does not provide.

The publishable catalog is the exact-ID intersection of:

- candidate entries produced from the selected Command Code CLI bundle and maintained hardcoded entries; and
- IDs in the availability response's `data` array.

Matching is case-sensitive and exact. Display names and suffixes must not be used to infer availability.

API-only IDs are not synthesized because they lack the required provider metadata. They enter the published catalog only after the extractor produces a matching candidate.

An extracted model absent from the availability response is unavailable. It must:

- be omitted from `models.json`;
- be omitted from generated OpenCode provider configuration, including `--update-global` output; and
- be recorded in `manifest.json` review metadata as an excluded ID with reason `not-listed-by-provider-api`.

Unavailable entries are not emitted with OpenCode `status: "deprecated"`. OpenCode hides deprecated models from its selector, but retaining the model definition still permits persisted or direct IDs to resolve and attempt a request against an unavailable endpoint.

Removing a model from the provider map must not edit OpenCode's favorites, recents, variants, or other local state. Existing unresolved state remains OpenCode-owned and can resolve again if the exact ID returns in a later catalog.

### Safe synchronization

Availability filtering occurs in CI and explicit maintainer synchronization, never during plugin startup.

Before any generated artifact is written, synchronization must validate that:

- the request succeeded;
- the response is an object with `object: "list"` and a non-empty `data` array;
- every retained item has a non-empty string `id`;
- IDs are unique; and
- the filtered model count passes the existing floor: `max(20, floor(lastSuccessfulModelCount * 0.5))`.

Network failure, invalid JSON, invalid shape, duplicate IDs, an empty list, or a count below the floor is a catalog-break failure. The run must not modify `models.json`, `_version.txt`, or `manifest.json`, must not open a catalog PR, and must not publish a package. CI uses the existing `catalog-break` issue path.

The previous committed artifacts remain the last-good catalog; this design adds no runtime availability call and no second cache (the runtime last-good cache from the identity spec is unchanged).

The six-hour catalog job refreshes the provider availability list and its `supported_endpoints` metadata even when the CLI bundle version is unchanged. Endpoint metadata is replaced when the provider supplies it; a partial response preserves the last known endpoint list for that model. The job still opens a PR only when generated artifacts change and retains the existing model-count floor and `catalog-break` path.

Cost and modality enrichment runs only for the filtered catalog. `manifest.modelCount`, `reasoningModelCount`, and cost-source counts describe published models, not excluded candidates.

`manifest.review.unavailable` is additive to schema version 1:

```json
{
  "review": {
    "unavailable": [
      {
        "id": "minimax/minimax-m3-free",
        "reason": "not-listed-by-provider-api"
      }
    ]
  }
}
```

The unavailable list is sorted by ID so repeated synchronization is deterministic.

### Mutable OpenCode plugin packages

OpenCode V2.0.18 loads a warm cached package at startup and does not silently replace it. An isolated local startup with a cached Command Code 0.9.1 package loaded 0.9.1 even though npm `latest` was 0.10.1. A clean cache does install the latest package. OpenCode's current V2 plugin documentation describes startup update checks without changing the installed package; the host's update action must be applied before a restart loads the new code. V1.18.30's `opencode plugin <module> --global --force` explicitly refreshes a global package.

The bare package name is the normal unpinned reference; adding `@latest` is redundant. Exact versions remain pinned. The plugin reads only its bundled catalog and cannot refresh its own npm package or hot-swap its running code.

Git, file, and workspace plugin references are outside this behavior change.

### Published manifest version

The `manifest.pluginVersion` embedded in an npm tarball must equal that tarball's `package.json` version.

Semantic Release must set the manifest version from `nextRelease.version` during its prepare phase, before `@semantic-release/npm` packs and publishes. The existing post-release synchronization PR remains responsible for committing generated release versions back to protected `main`.

Release verification must inspect the packed artifact and fail before publication when the two versions differ.

## Runtime Contract

The installed plugin reads only its bundled `models.json` and `manifest.json` for normal model registration. It does not call the availability endpoint, npm registry, or GitHub to decide which models to expose.

This preserves deterministic startup and offline use. Freshness is delivered by catalog automation plus the host's explicit package-update flow; a warm npm cache can remain stale until that update is applied.

## Non-Goals

- Evaluating minified `hidden` getters at plugin runtime.
- Probing every model with a billable inference request.
- Fuzzy or case-insensitive availability matching.
- Hot-reloading plugin code in a running OpenCode process.
- Deleting unresolved user model state.
- Changing OpenCode's deprecated-model semantics.
- Cleaning local duplicate plugin configuration, package-manager settings, or credentials.

## Acceptance Criteria

### Provider synchronization

- A fixture with three CLI candidates and two API IDs writes exactly the two exact-ID matches.
- API-absent candidates appear only in sorted `manifest.review.unavailable` entries with reason `not-listed-by-provider-api`.
- An unchanged CLI bundle still refreshes provider availability and `supported_endpoints`; partial endpoint metadata preserves the last known list, and unchanged generated artifacts create no PR.
- Static or dynamic Command Code hiding requires no special parser handling when the hidden ID is absent from the API.
- An unavailable, malformed, empty, duplicate-ID, or below-floor response leaves all generated artifacts byte-for-byte unchanged and exits non-zero.
- Cost, reasoning, and manifest counts are computed from the filtered catalog.
- `bun run check` passes after generated artifacts are refreshed.

### OpenCode package refresh

- A clean cache with the bare package entry installs the current npm `latest` release.
- A warm OpenCode V2.0.18 cache loads its installed version at startup without replacing it.
- Applying a host plugin update and restarting loads the new package.
- The V1 force-install command refreshes its configured global package.
- Exact-version references remain pinned; `@latest` is not required for an unpinned package.

### Release metadata

- A packed release candidate has equal versions in `package.json` and `manifest.json`.
- A mismatch fails before `npm publish`.
- The post-release synchronization PR remains non-releasing under the repository's `chore` release rule.

### End-to-end

From a clean OpenCode cache, the bare Command Code package installs the current npm release and exposes the catalog in that tarball. With a warm stale cache, users must apply the host's package update and restart before the newer catalog appears. In both cases the catalog exposes only the exact-ID matches produced by the provider sync.

## Coordination Plan

1. **Provider availability filter**
   - Owner: provider maintainer.
   - Files: `scripts/sync-models.ts`, `src/catalog.ts`, `src/manifest.ts`, focused unit fixtures/tests, then generated catalog artifacts.
   - Dependency: none.
   - Evidence: focused availability and manifest tests, a forced remote sync, unchanged-artifact failure tests, then `bun run check`.
   - Commit: `fix(catalog): exclude unavailable models`.
   - Status: shipped 2026-09-20.
2. **Published manifest alignment**
   - Owner: provider maintainer.
   - Files: Semantic Release configuration, release preparation script, release-candidate verification, and focused unit tests.
   - Dependency: none; may proceed in the same PR after step 1 as a separate commit.
   - Evidence: packed-artifact equality and mismatch rejection, then `bun run check`.
   - Commit: `fix(release): align published manifest version`.
   - Status: shipped 2026-09-20.
3. **Mutable plugin refresh**
   - Owner: OpenCode contributor.
   - Files: the package installation/cache path and tests in the upstream OpenCode repository.
   - Dependency: rework pull request `#49485`; independent of provider steps 1 and 2.
   - Evidence: upstream docs and local warm-cache tests show that V2 checks but does not silently replace a cached package; automatic replacement still requires upstream support.
   - Commit: follow OpenCode repository convention.
   - Status: pending upstream; see [OpenCode plugin update behavior](https://opencode.ai/v2/docs/plugins).
4. **Rollout verification**
   - Owner: provider maintainer.
   - Dependency: provider release and an OpenCode build containing step 3.
   - Evidence: compare the installed tarball manifest to its package version, launch from a clean cache, apply a host update to a warm cache, restart, and compare displayed provider IDs with the public availability response.
   - Commit: none unless verification finds a defect.
   - Status: pending upstream.

Provider steps 1 and 2 shipped on 2026-09-20. Until OpenCode adds automatic package installation for warm caches, users may need to apply the host update action manually; do not clear the cache as a workaround because it discards a working install.

## References

- [OpenCode pull request #49485](https://github.com/anomalyco/opencode/pull/49485)
- [Command Code public models endpoint](https://api.commandcode.ai/provider/v1/models)
- [Stable model identity specification](./2026-08-19-stable-model-identity.md)
- [CI catalog automation specification](./2026-08-28-ci-catalog-automation.md)
