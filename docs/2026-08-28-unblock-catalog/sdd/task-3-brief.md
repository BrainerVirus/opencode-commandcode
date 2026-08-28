# Task 3 brief

### Task 3: Official-docs costs and refresh bundled catalog

Follow docs/2026-08-28-unblock-catalog/plan.md heading ### Task 3 through its commit step.

Create src/costs-docs.ts, tests/unit/costs-docs.test.ts, tests/fixtures/command-code/models-page.md. Wire scripts/sync-models.ts. Run bun run sync --remote to refresh models.json and _version.txt from latest command-code tarball. CLI costs win; docs fill gaps; fallback last. Exact id then exact name. Do not fail sync if docs parse empty.

CA-06: _version.txt is not 1.1.0 after sync. CA-07: docs costs applied when CLI costs missing.

Work in-place on feature/2026-08-28-unblock-catalog. No worktrees. TDD then commit as specified.

