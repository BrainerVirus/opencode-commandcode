import { readFileSync, existsSync } from "fs"
import { homedir } from "os"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import {
  generateOpencodeModels,
  loadCatalogFromLocalCommandCode,
  type ModelEntry,
} from "./src/catalog.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const MODELS_PATH = join(__dirname, "models.json")
const VERSION_PATH = join(__dirname, "_version.txt")

interface PluginFileConfig {
  disableModelSync?: boolean
  commandCodePackagePath?: string
}

function loadPluginConfig(): PluginFileConfig {
  const configPath = join(homedir(), ".config", "opencode", "commandcode-go-opencode-provider.json")
  if (!existsSync(configPath)) return {}
  try {
    return JSON.parse(readFileSync(configPath, "utf-8"))
  } catch {
    return {}
  }
}

async function checkModelVersion(localVersion: string | null) {
  try {
    const metaResp = await fetch("https://registry.npmjs.org/command-code/latest")
    if (!metaResp.ok) return
    const meta: any = await metaResp.json()
    const latestVersion = meta?.version as string | undefined

    let bundledVersion: string | null = null
    if (existsSync(VERSION_PATH)) {
      const content = readFileSync(VERSION_PATH, "utf-8")
      const parts = content.split("\n")
      if (parts[0]) bundledVersion = parts[0].trim()
    }

    const current = localVersion || bundledVersion
    if (latestVersion && (!current || current !== latestVersion)) {
      if (localVersion) {
        console.warn(
          `[commandcode] command-code update available (${localVersion} → ${latestVersion}). ` +
            `Upgrade the command-code package to refresh models and reasoning efforts.`,
        )
      } else {
        console.warn(
          `[commandcode] Model catalog update available (${bundledVersion || "none"} → ${latestVersion}). ` +
            `Install/upgrade command-code, or run \`bun run sync\` to refresh models.`,
        )
      }
    }
  } catch {
    // silent — don't disrupt startup over a failed version check
  }
}

export type { ModelEntry }

interface ApiModel {
  id: string
  context_length?: number
}

function loadModels(): ModelEntry[] {
  try {
    return JSON.parse(readFileSync(MODELS_PATH, "utf-8"))
  } catch (err) {
    throw new Error(
      `Bundled models.json missing or corrupt at ${MODELS_PATH}; ` +
        `please reinstall commandcode-go-opencode-provider.`,
      { cause: err },
    )
  }
}

async function fetchModelsFromApi(): Promise<ApiModel[] | null> {
  if (loadPluginConfig().disableModelSync) return null

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)
  try {
    const headers: Record<string, string> = {}
    const apiKey = process.env.COMMANDCODE_API_KEY
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`

    const resp = await fetch("https://api.commandcode.ai/provider/v1/models", {
      headers,
      signal: controller.signal,
    })

    if (!resp.ok) return null
    const data = (await resp.json()) as { data?: ApiModel[] }
    return data.data ?? null
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

function mergeModels(local: ModelEntry[], api: ApiModel[]): ModelEntry[] {
  const apiMap = new Map(api.map((m) => [m.id, m]))
  const merged: ModelEntry[] = []

  for (const entry of local) {
    const apiModel = apiMap.get(entry.id)
    if (apiModel?.context_length) {
      merged.push({ ...entry, limit: { ...entry.limit, context: apiModel.context_length } })
    } else {
      merged.push(entry)
    }
    apiMap.delete(entry.id)
  }

  for (const [id, apiModel] of apiMap) {
    merged.push({
      id,
      name: id.split("/").pop() ?? id,
      tier: "open-source",
      reasoning: false,
      tool_call: true,
      cost: { input: 0.5, output: 2 },
      limit: { context: apiModel.context_length ?? 131072, output: 131072 },
    })
  }

  return merged.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier === "premium" ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

export default async function commandcodePlugin() {
  return {
    config: async (config: Record<string, unknown>) => {
      const providers = config.provider as Record<string, Record<string, unknown>> | undefined
      if (!providers) {
        ;(config as Record<string, unknown>).provider = { commandcode: {} }
      }
      const cc = ((config as Record<string, unknown>).provider as Record<string, Record<string, unknown>>)?.commandcode as Record<string, unknown> | undefined
      if (!cc) return

      const pluginCfg = loadPluginConfig()
      const localCatalog = loadCatalogFromLocalCommandCode({
        packagePath: pluginCfg.commandCodePackagePath,
      })

      checkModelVersion(localCatalog?.version ?? null)

      if (!cc.npm) cc.npm = "commandcode-go-opencode-provider"
      if (!cc.name) cc.name = "Command Code"
      if (!cc.env) cc.env = ["COMMANDCODE_API_KEY"]

      if (!cc.models) {
        let models: ModelEntry[]
        if (localCatalog) {
          models = localCatalog.models
          console.log(
            `[commandcode] Loaded ${models.length} models from command-code@${localCatalog.version} (${localCatalog.root})`,
          )
        } else {
          models = loadModels()
          console.log(
            `[commandcode] Loaded ${models.length} models from bundled models.json (local command-code not found)`,
          )
        }

        const apiModels = await fetchModelsFromApi()
        if (apiModels && apiModels.length > 0) {
          models = mergeModels(models, apiModels)
        }

        cc.models = generateOpencodeModels(models)
      }
    },

    auth: {
      provider: "commandcode",
      methods: [
        {
          type: "api",
          label: "API Key",
          authorize: async (inputs: Record<string, unknown> | undefined) => {
            const rawKey = inputs?.key
            if (typeof rawKey !== "string") return { type: "failed" as const }
            const key = rawKey.trim()
            if (!key) return { type: "failed" as const }
            return { type: "success" as const, key }
          },
        },
      ],
      loader: async (getAuth: () => Promise<{ type: string; key?: string } | null>) => {
        try {
          const auth = await getAuth()
          if (!auth) return {}
          if (auth.type === "api" && auth.key) return { apiKey: auth.key }
          return {}
        } catch {
          return {}
        }
      },
    },
  }
}
