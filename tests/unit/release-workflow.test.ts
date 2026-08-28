import { expect, test, describe } from "bun:test"
import { readFileSync } from "fs"
import { join } from "path"

const ROOT = join(import.meta.dir, "../..")
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf-8")
const json = <T>(rel: string) => JSON.parse(read(rel)) as T

const NPMJS = "${{ secrets.NPMJS }}"

describe("package.json publish identity", () => {
  test("is the scoped public package on the BrainerVirus fork", () => {
    const pkg = json<{
      name: string
      version: string
      publishConfig?: { access?: string }
      repository?: { url?: string }
      bugs?: { url?: string }
      homepage?: string
      files?: string[]
    }>("package.json")
    expect(pkg.name).toBe("@brainervirus/commandcode-go-opencode-provider")
    expect(pkg.publishConfig?.access).toBe("public")
    expect(pkg.repository?.url).toContain("BrainerVirus/opencode-commandcode-provider")
    expect(pkg.bugs?.url).toContain("BrainerVirus/opencode-commandcode-provider")
    expect(pkg.homepage).toContain("BrainerVirus/opencode-commandcode-provider")
    expect(pkg.files).toContain("manifest.json")
  })
})

function publishEnv(step: { env?: Record<string, string> } | undefined): void {
  expect(step?.env?.NPM_TOKEN, "NPM_TOKEN must come from secrets.NPMJS").toBe(NPMJS)
  expect(step?.env?.NODE_AUTH_TOKEN, "NODE_AUTH_TOKEN must come from secrets.NPMJS").toBe(NPMJS)
}

describe("catalog-sync.yml", () => {
  test("crons every 6 hours and publishes with the workit npm token mapping", () => {
    const wf = Bun.YAML.parse(read(".github/workflows/catalog-sync.yml")) as {
      on: { schedule?: Array<{ cron: string }>; workflow_dispatch?: { inputs?: { force?: unknown } } }
      jobs: {
        sync: {
          steps: Array<{
            name?: string
            uses?: string
            with?: Record<string, string>
            run?: string
            env?: Record<string, string>
          }>
        }
      }
    }
    expect(wf.on.schedule?.[0]?.cron).toBe("0 */6 * * *")
    expect(wf.on.workflow_dispatch?.inputs?.force).toBeDefined()
    const setupNode = wf.jobs.sync.steps.find((s) => s.uses?.startsWith("actions/setup-node"))
    expect(setupNode?.with?.["registry-url"]).toBe("https://registry.npmjs.org")
    const sync = wf.jobs.sync.steps.find((s) => (s.name ?? "").toLowerCase().includes("sync"))
    publishEnv(sync)
    const blob = wf.jobs.sync.steps.map((s) => s.run ?? "").join("\n")
    expect(blob).toContain("catalog-sync-ci.ts")
  })
})

describe("release.yml", () => {
  test("publishes unpublished versions on push to main using NPMJS for both tokens", () => {
    const wf = Bun.YAML.parse(read(".github/workflows/release.yml")) as {
      on: { push?: { branches?: string[] } }
      jobs: {
        release: {
          steps: Array<{
            name?: string
            uses?: string
            with?: Record<string, string>
            run?: string
            env?: Record<string, string>
          }>
        }
      }
    }
    expect(wf.on.push?.branches).toContain("main")
    const setupNode = wf.jobs.release.steps.find((s) => s.uses?.startsWith("actions/setup-node"))
    expect(setupNode?.with?.["registry-url"]).toBe("https://registry.npmjs.org")
    const publish = wf.jobs.release.steps.find((s) => (s.name ?? "").toLowerCase().includes("publish"))
    publishEnv(publish)
    expect(publish?.run).toContain("publish-if-needed.ts")
  })
})
