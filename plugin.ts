import { readFileSync, existsSync } from "fs"
import { homedir } from "os"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const MODELS_PATH = join(__dirname, "models.json")
const VERSION_PATH = join(__dirname, "_version.txt")

function loadPluginConfig(): { disableModelSync?: boolean } {
  const configPath = join(homedir(), ".config", "opencode", "commandcode-go-opencode-provider.json")
  if (!existsSync(configPath)) return {}
  try {
    return JSON.parse(readFileSync(configPath, "utf-8"))
  } catch {
    return {}
  }
}

async function checkModelVersion() {
  try {
    const metaResp = await fetch("https://registry.npmjs.org/command-code/latest")
    if (!metaResp.ok) return
    const meta: any = await metaResp.json()
    const latestVersion = meta?.version as string | undefined

    let localVersion: string | null = null
    if (existsSync(VERSION_PATH)) {
      const content = readFileSync(VERSION_PATH, "utf-8")
      const parts = content.split("\n")
      if (parts[0]) localVersion = parts[0].trim()
    }

    if (latestVersion && (!localVersion || localVersion !== latestVersion)) {
      console.warn(
        `[commandcode] Model catalog update available (${localVersion || "none"} → ${latestVersion}). ` +
        `Run \`bun run sync\` to refresh models.`
      )
    }
  } catch {
    // silent — don't disrupt startup over a failed version check
  }
}

export interface ModelEntry {
  id: string
  name: string
  tier: "premium" | "open-source"
  reasoning: boolean
  reasoningEfforts?: string[]
  tool_call: boolean
  cost: { input: number; output: number; cache_read?: number; cache_write?: number }
  limit: { context: number; output: number }
}

interface ApiModel {
  id: string
  context_length?: number
}

function loadModels(): ModelEntry[] {
  const modelsPath = join(__dirname, "models.json")
  try {
    return JSON.parse(readFileSync(modelsPath, "utf-8"))
  } catch (err) {
    throw new Error(
      `Bundled models.json missing or corrupt at ${modelsPath}; ` +
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

function toConfigKey(id: string): string {
  const slashIdx = id.indexOf("/")
  const short = slashIdx >= 0 ? id.slice(slashIdx + 1) : id
  return short.toLowerCase()
}

export default async function commandcodePlugin() {
  return {
    config: async (config: Record<string, unknown>) => {
      const providers = config.provider as Record<string, Record<string, unknown>> | undefined
      if (!providers) {
        (config as Record<string, unknown>).provider = { commandcode: {} }
      }
      const cc = ((config as Record<string, unknown>).provider as Record<string, Record<string, unknown>>)?.commandcode as Record<string, unknown> | undefined
      if (!cc) return

      checkModelVersion()

      if (!cc.npm) cc.npm = "commandcode-go-opencode-provider"
      if (!cc.name) cc.name = "Command Code"
      if (!cc.env) cc.env = ["COMMANDCODE_API_KEY"]

      if (!cc.models) {
        let models = loadModels()
        const apiModels = await fetchModelsFromApi()
        if (apiModels && apiModels.length > 0) {
          models = mergeModels(models, apiModels)
        }
        const modelsObj: Record<string, unknown> = {}
        for (const entry of models) {
          const key = toConfigKey(entry.id)
          const costObj: Record<string, number> = { input: entry.cost.input, output: entry.cost.output }
          if (entry.cost.cache_read !== undefined) costObj.cache_read = entry.cost.cache_read
          if (entry.cost.cache_write !== undefined) costObj.cache_write = entry.cost.cache_write

          modelsObj[key] = {
            id: entry.id,
            name: entry.name,
            reasoning: entry.reasoning,
            reasoningEfforts: entry.reasoningEfforts,
            tool_call: entry.tool_call,
            cost: costObj,
            limit: entry.limit,
          }

          if (entry.reasoningEfforts && entry.reasoningEfforts.length > 0) {
            const variants: Record<string, Record<string, unknown>> = {}
            for (const effort of entry.reasoningEfforts) {
              variants[effort] = { reasoningEffort: effort }
            }
            modelsObj[key] = { ...(modelsObj[key] as Record<string, unknown>), variants }
          }
        }
        cc.models = modelsObj
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
