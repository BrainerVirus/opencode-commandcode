import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, statSync } from "fs"
import { join } from "path"
import { homedir, tmpdir } from "os"
import { execSync } from "child_process"
import {
  NPM_PACKAGE,
  generateOpencodeModels,
  loadCatalogFromBundle,
  loadCatalogFromLocalCommandCode,
  type ModelEntry,
} from "../src/catalog.js"

const PROJECT_ROOT = join(import.meta.dir, "..")
const MODELS_JSON = join(PROJECT_ROOT, "models.json")
const VERSION_PATH = join(PROJECT_ROOT, "_version.txt")
const GLOBAL_CONFIG = join(homedir(), ".config", "opencode", "opencode.jsonc")
const TMP_DIR = join(tmpdir(), "cc-model-sync")

async function fetchLatestBundle(): Promise<{ source: string; version: string }> {
  console.log(`Fetching latest ${NPM_PACKAGE} metadata...`)
  const metaResp = await fetch(`https://registry.npmjs.org/${NPM_PACKAGE}/latest`)
  if (!metaResp.ok) throw new Error(`npm registry returned ${metaResp.status}`)
  const meta = await metaResp.json()
  const version = meta.version as string
  const tarball = meta.dist.tarball as string
  console.log(`  Latest version: ${version}`)
  console.log(`  Tarball: ${tarball}`)

  mkdirSync(TMP_DIR, { recursive: true })
  const tgzPath = join(TMP_DIR, `${NPM_PACKAGE}.tgz`)

  console.log("Downloading tarball...")
  const tarballResp = await fetch(tarball)
  if (!tarballResp.ok) throw new Error(`tarball download returned ${tarballResp.status}`)
  const buffer = Buffer.from(await tarballResp.arrayBuffer())
  writeFileSync(tgzPath, buffer)

  console.log("Extracting...")
  execSync(`tar -xzf "${tgzPath}" -C "${TMP_DIR}"`, { stdio: "pipe" })

  const pkgRoot = join(TMP_DIR, "package")
  const candidates = [
    join(pkgRoot, "dist", "cli.mjs"),
    join(pkgRoot, "dist", "index.mjs"),
  ]
  const bundlePath = candidates.find((p) => existsSync(p) && statSync(p).size >= 4096)
    ?? candidates.find((p) => existsSync(p))
  if (!bundlePath) throw new Error(`Bundle not found under ${pkgRoot}/dist`)

  const source = readFileSync(bundlePath, "utf-8")

  rmSync(TMP_DIR, { recursive: true, force: true })

  return { source, version }
}

function stripJsonc(input: string): string {
  let out = ""
  let i = 0
  while (i < input.length) {
    const ch = input[i]
    if (ch === '"') {
      const start = i
      i++
      while (i < input.length && input[i] !== '"') {
        if (input[i] === "\\") i++
        i++
      }
      i++
      out += input.slice(start, i)
    } else if (ch === "/" && input[i + 1] === "/") {
      while (i < input.length && input[i] !== "\n") i++
    } else if (ch === "/" && input[i + 1] === "*") {
      i += 2
      while (i < input.length && !(input[i] === "*" && input[i + 1] === "/")) i++
      i += 2
    } else {
      out += ch
      i++
    }
  }
  return out.replace(/,\s*([}\]])/g, "$1")
}

function updateGlobalConfig(modelsObj: Record<string, unknown>) {
  if (!existsSync(GLOBAL_CONFIG)) {
    console.log(`  Global config not found at ${GLOBAL_CONFIG}, skipping`)
    return
  }

  const raw = readFileSync(GLOBAL_CONFIG, "utf-8")
  const jsonStr = stripJsonc(raw)

  let config: any
  try {
    config = JSON.parse(jsonStr)
  } catch {
    console.error("  Failed to parse global config as JSON after stripping comments")
    return
  }

  if (!config.provider) config.provider = {}
  if (!config.provider.commandcode) {
    config.provider.commandcode = {
      npm: "commandcode-go-opencode-provider",
      name: "Command Code",
      env: ["COMMANDCODE_API_KEY"],
    }
  }
  config.provider.commandcode.models = modelsObj

  const output = JSON.stringify(config, null, 2) + "\n"
  writeFileSync(GLOBAL_CONFIG, output, "utf-8")
  console.log(`  Updated ${GLOBAL_CONFIG}`)
}

async function main() {
  const args = process.argv.slice(2)
  const shouldUpdateGlobal = args.includes("--update-global")
  const forceRemote = args.includes("--remote")

  let entries: ModelEntry[]
  let version: string
  let sourceLabel: string

  const local = !forceRemote ? loadCatalogFromLocalCommandCode() : null
  if (local) {
    entries = local.models
    version = local.version
    sourceLabel = `local ${local.root}`
    console.log(`Loaded catalog from local command-code@${version}`)
    console.log(`  Path: ${local.root}`)
    console.log(`  Models: ${entries.length}`)
  } else {
    const bundle = await fetchLatestBundle()
    version = bundle.version
    sourceLabel = `npm tarball v${version}`
    console.log(`Read CLI bundle v${version} (${(bundle.source.length / 1024).toFixed(0)} KB)`)
    console.log("Extracting model catalog...")
    entries = loadCatalogFromBundle(bundle.source)
    console.log(`  Found ${entries.length} models`)
  }

  console.log(`\nWriting ${MODELS_JSON} with ${entries.length} models from ${sourceLabel}...`)
  writeFileSync(MODELS_JSON, JSON.stringify(entries, null, 2) + "\n", "utf-8")
  writeFileSync(VERSION_PATH, `${version}\n`, "utf-8")

  const modelsObj = generateOpencodeModels(entries)

  if (shouldUpdateGlobal) {
    console.log("Updating global config...")
    updateGlobalConfig(modelsObj)
  }

  console.log("\nModel list:")
  for (const entry of entries) {
    const cost = `$${entry.cost.input}/$${entry.cost.output}`
    const efforts = entry.reasoningEfforts?.length
      ? ` efforts=[${entry.reasoningEfforts.join(",")}]`
      : ""
    console.log(
      `  ${entry.tier.padEnd(12)} ${entry.id.padEnd(35)} ${entry.name.padEnd(25)} ${cost}${efforts}`,
    )
  }

  if (!shouldUpdateGlobal) {
    console.log(`\nRun with --update-global to update ${GLOBAL_CONFIG}`)
  }

  console.log("\nDone.")
}

main()
