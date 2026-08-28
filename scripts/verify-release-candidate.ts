#!/usr/bin/env bun
// Pack-only gate: write a local tarball and check payload. Never publish or tag.
import { execSync } from "child_process"
import { mkdtempSync, readdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

const ROOT = join(import.meta.dir, "..")
const REQUIRED = ["plugin.ts", "models.json", "manifest.json", "package.json", "src/catalog.ts"]
const FORBIDDEN = ["tests/", "docs/", ".github/"]

const dir = mkdtempSync(join(tmpdir(), "cc-pack-"))
try {
  execSync("npm pack --pack-destination " + JSON.stringify(dir), {
    cwd: ROOT,
    stdio: "pipe",
    encoding: "utf-8",
  })
  const tgz = readdirSync(dir).find((f) => f.endsWith(".tgz"))
  if (!tgz) throw new Error("npm pack produced no tarball")
  const listing = execSync(`tar -tzf ${JSON.stringify(join(dir, tgz))}`, {
    encoding: "utf-8",
  })
  const files = listing.split("\n").filter(Boolean).map((f) => f.replace(/^package\//, ""))
  for (const need of REQUIRED) {
    if (!files.includes(need) && !files.some((f) => f === need || f.startsWith(need))) {
      throw new Error(`tarball missing ${need}`)
    }
  }
  for (const banned of FORBIDDEN) {
    if (files.some((f) => f === banned || f.startsWith(banned))) {
      throw new Error(`tarball must not include ${banned}`)
    }
  }
  console.log(`verified ${tgz} (${files.length} files)`)
} finally {
  rmSync(dir, { recursive: true, force: true })
}
