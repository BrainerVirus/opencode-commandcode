# Task 2 brief

### Task 2: Quiet bundled startup

Follow docs/2026-08-28-unblock-catalog/plan.md from heading ### Task 2 through the Task 2 commit step (stop before ### Task 3). Use the plan's exact test code, src/startup.ts, and plugin.ts config hook.

CA-02 no console.log/warn by default. CA-03 bundled models.json. CA-04 empty models still registers npm/env. CA-05 last-good cache. Delete checkModelVersion. Do not call fetchModelsFromApi. Auth block unchanged.

Work in-place on feature/2026-08-28-unblock-catalog. No worktrees. TDD then commit as specified.

