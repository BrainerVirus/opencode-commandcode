#!/usr/bin/env bun
// Build the self-contained OpenCode plugin entry (dist/plugin.js).
// Bundles src/entry.ts (plugin default + V1 server + AI-SDK factory) for
// node ESM; the `ai` package stays external and node builtins stay external
// via --target node. All other imports are type-only (erased at build).
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

mkdirSync(join(ROOT, "dist"), { recursive: true });

const build = spawnSync(
  "bun",
  [
    "build",
    join(ROOT, "src/entry.ts"),
    "--outfile",
    join(ROOT, "dist/plugin.js"),
    "--target",
    "node",
    "--format",
    "esm",
    "--external",
    "ai",
  ],
  { encoding: "utf8", cwd: ROOT },
);
if (build.stdout) process.stdout.write(build.stdout);
if (build.stderr) process.stderr.write(build.stderr);
if (build.status !== 0) {
  throw new Error(`bun build src/entry.ts failed (exit ${build.status ?? "unknown"})`);
}
console.log("opencode: built dist/plugin.js");
