# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- GitHub flow: PR-gated `main`, CI matrix (`check (test|typecheck|pack)`), semantic-release on merge, catalog updates as PRs.
- `manifest.json` describing the bundled catalog (status, cost sources, command-code version).
- First publish of `@brainervirus/commandcode-go-opencode-provider`.
- Last-good catalog cache and silent `startup.json` diagnostics under the plugin state dir.

### Fixed

- Load the Command Code model catalog when CLI cost extraction fails (`command-code@1.38.x`).
- Stop plugin `console.log` / `console.warn` from leaking into the OpenCode loading UI.
- Default to bundled `models.json` (no local `command-code` install). Opt-in local scrape via `commandCodePackagePath` or `COMMANDCODE_PACKAGE_PATH`.
- Refresh bundled catalog from `command-code@1.38.1` and fill missing costs from official docs.
