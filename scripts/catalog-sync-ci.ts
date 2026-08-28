#!/usr/bin/env bun
import { existsSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"
import { execSync } from "child_process"
import { catalogBreakResolvedComment, catalogBreakTitle, renderCatalogBreakBody } from "../src/catalog-break.js"
import {
  bumpPackageVersionField,
  lastSuccessfulModelCount,
  meetsModelCountFloor,
  type CatalogManifest,
} from "../src/manifest.js"
import { decideCatalogSync } from "../src/publish-policy.js"
import { npmLatestVersion, npmPackageVersions } from "./npm-registry.js"
import { publishIfNeeded } from "./publish-if-needed.js"

const ROOT = join(import.meta.dir, "..")
const CATALOG_FILES = ["models.json", "_version.txt", "manifest.json", "package.json"]

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T
  } catch {
    return null
  }
}

function bundledCommandCodeVersion(): string | null {
  const path = join(ROOT, "_version.txt")
  if (!existsSync(path)) return null
  return readFileSync(path, "utf-8").split("\n")[0]?.trim() || null
}

function git(args: string): string {
  return execSync(`git ${args}`, { cwd: ROOT, encoding: "utf-8" }).trim()
}

function openOrUpdateCatalogBreak(input: {
  commandCodeVersion: string
  error: string
}): void {
  const title = catalogBreakTitle(input.commandCodeVersion)
  const body = renderCatalogBreakBody({
    commandCodeVersion: input.commandCodeVersion,
    error: input.error,
    workflowUrl: process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : "(local)",
    bundledCommandCodeVersion: bundledCommandCodeVersion(),
  })
  const existing = execSync(
    `gh issue list --label catalog-break --state open --json number,title`,
    { cwd: ROOT, encoding: "utf-8" },
  )
  const issues = JSON.parse(existing) as Array<{ number: number; title: string }>
  if (issues.length === 0) {
    execSync(`gh issue create --title ${JSON.stringify(title)} --body ${JSON.stringify(body)} --label catalog-break --label automation`, {
      cwd: ROOT,
      stdio: "inherit",
    })
    return
  }
  execSync(`gh issue comment ${issues[0].number} --body ${JSON.stringify(body)}`, {
    cwd: ROOT,
    stdio: "inherit",
  })
}

function closeCatalogBreakIssues(tag: string): void {
  let existing = "[]"
  try {
    existing = execSync(`gh issue list --label catalog-break --state open --json number`, {
      cwd: ROOT,
      encoding: "utf-8",
    })
  } catch {
    return
  }
  const issues = JSON.parse(existing) as Array<{ number: number }>
  const commit = git("rev-parse --short HEAD")
  const comment = catalogBreakResolvedComment({ commit, tag })
  for (const issue of issues) {
    execSync(`gh issue close ${issue.number} --comment ${JSON.stringify(comment)}`, {
      cwd: ROOT,
      stdio: "inherit",
    })
  }
}

function commitCatalogIfChanged(commandCodeVersion: string): boolean {
  const status = git(`status --porcelain -- ${CATALOG_FILES.join(" ")}`)
  if (!status) return false
  git('config user.name "github-actions[bot]"')
  git('config user.email "41898282+github-actions[bot]@users.noreply.github.com"')
  execSync(`git add ${CATALOG_FILES.join(" ")}`, { cwd: ROOT, stdio: "inherit" })
  execSync(
    `git commit -m ${JSON.stringify(`chore(catalog): sync command-code@${commandCodeVersion}`)}`,
    { cwd: ROOT, stdio: "inherit" },
  )
  execSync("git push", { cwd: ROOT, stdio: "inherit" })
  return true
}

async function main(): Promise<void> {
  const force = process.env.FORCE === "true" || process.argv.includes("--force")
  const pkgPath = join(ROOT, "package.json")
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { name: string; version: string }
  const latestCc = await npmLatestVersion("command-code")
  const published = await npmPackageVersions(pkg.name)
  const decision = decideCatalogSync({
    force,
    latestCommandCodeVersion: latestCc,
    bundledCommandCodeVersion: bundledCommandCodeVersion(),
    pluginVersion: pkg.version,
    publishedPluginVersions: published,
  })

  console.log(JSON.stringify({ latestCc, pluginVersion: pkg.version, decision }))

  if (decision.exit) {
    console.log("nothing to do")
    return
  }

  if (decision.extract) {
    const prior = readJson<CatalogManifest>(join(ROOT, "manifest.json"))
    const beforeModels = existsSync(join(ROOT, "models.json"))
      ? readFileSync(join(ROOT, "models.json"), "utf-8")
      : ""
    const beforeVersion = bundledCommandCodeVersion()

    try {
      execSync("bun run scripts/sync-models.ts -- --remote", { cwd: ROOT, stdio: "inherit" })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      try {
        openOrUpdateCatalogBreak({ commandCodeVersion: latestCc, error: message })
      } catch (issueErr) {
        console.error("failed to open catalog-break issue", issueErr)
      }
      process.exitCode = 1
      return
    }

    const afterModels = readFileSync(join(ROOT, "models.json"), "utf-8")
    const entries = JSON.parse(afterModels) as unknown[]
    const lastCount = lastSuccessfulModelCount(prior)
    if (!meetsModelCountFloor(entries.length, lastCount)) {
      const message = `model count ${entries.length} below floor (lastSuccessful=${lastCount})`
      try {
        openOrUpdateCatalogBreak({ commandCodeVersion: latestCc, error: message })
      } catch (issueErr) {
        console.error("failed to open catalog-break issue", issueErr)
      }
      execSync(`git checkout -- models.json _version.txt manifest.json`, { cwd: ROOT, stdio: "inherit" })
      process.exitCode = 1
      return
    }

    const changed = afterModels !== beforeModels || bundledCommandCodeVersion() !== beforeVersion
    if (changed) {
      const bumped = bumpPackageVersionField(readFileSync(pkgPath, "utf-8"))
      writeFileSync(pkgPath, bumped.json)
      const manifestPath = join(ROOT, "manifest.json")
      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as CatalogManifest
      manifest.pluginVersion = bumped.version
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    }

    if (process.env.CI === "true") {
      commitCatalogIfChanged(bundledCommandCodeVersion() ?? latestCc)
    }
  }

  const publishedResult = await publishIfNeeded({ tagAndRelease: true })
  if (publishedResult === "publish") {
    const version = (JSON.parse(readFileSync(pkgPath, "utf-8")) as { version: string }).version
    try {
      closeCatalogBreakIssues(`v${version}`)
    } catch (err) {
      console.warn("could not close catalog-break issues", err)
    }
  } else if (publishedResult === "skip-no-token") {
    console.log("NPM_TOKEN/NODE_AUTH_TOKEN unset — skipped npm publish")
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
