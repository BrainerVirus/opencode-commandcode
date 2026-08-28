import { existsSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"
import { execSync } from "child_process"
import { decidePublish } from "../src/publish-policy.js"
import { npmPackageVersions, npmTokenSet } from "./npm-registry.js"

const ROOT = join(import.meta.dir, "..")

function pkg(): { name: string; version: string } {
  return JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8")) as {
    name: string
    version: string
  }
}

function releaseNotes(version: string): string {
  const manifestPath = join(ROOT, "manifest.json")
  if (!existsSync(manifestPath)) return `Plugin ${version}`
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
    commandCodeVersion?: string
    status?: string
    modelCount?: number
  }
  return [
    `Plugin ${version}`,
    `command-code@${manifest.commandCodeVersion ?? "unknown"}`,
    `${manifest.modelCount ?? "?"} models`,
    `catalog status: ${manifest.status ?? "unknown"}`,
  ].join("\n")
}

export async function publishIfNeeded(opts: { tagAndRelease: boolean } = { tagAndRelease: true }): Promise<"publish" | "skip-no-token" | "skip-already-published"> {
  const { name, version } = pkg()
  const published = await npmPackageVersions(name)
  const decision = decidePublish({
    pluginVersion: version,
    publishedPluginVersions: published,
    npmTokenSet: npmTokenSet(),
  })
  if (decision !== "publish") {
    console.log(`publish: ${decision}`)
    return decision
  }

  execSync("npm publish --access public", { cwd: ROOT, stdio: "inherit" })

  if (opts.tagAndRelease) {
    const tag = `v${version}`
    try {
      execSync(`git tag ${tag}`, { cwd: ROOT, stdio: "inherit" })
    } catch {
      // tag may already exist locally after a retry
    }
    try {
      execSync(`git push origin ${tag}`, { cwd: ROOT, stdio: "inherit" })
    } catch (err) {
      console.warn(`tag push failed for ${tag}: ${err}`)
    }
    try {
      execSync(`gh release create ${tag} --title ${tag} --notes-file -`, {
        cwd: ROOT,
        stdio: ["pipe", "inherit", "inherit"],
        input: releaseNotes(version),
      })
    } catch (err) {
      console.warn(`gh release create failed for ${tag}: ${err}`)
    }
  }
  return "publish"
}

if (import.meta.main) {
  publishIfNeeded().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
