import { expect, test, beforeAll } from "bun:test"

type PluginResult = {
  config: (config: Record<string, unknown>) => Promise<void>
  auth: {
    provider: string
    methods: Array<{
      type: string
      label: string
      authorize: (inputs: Record<string, unknown> | undefined) => Promise<{ type: string; key?: string }>
    }>
    loader: (getAuth: () => Promise<{ type: string; key?: string } | null>) => Promise<Record<string, unknown>>
  }
}

type PluginModule = { default: () => Promise<PluginResult> }

let pluginFn: PluginModule["default"]

beforeAll(async () => {
  const mod = await import("../../plugin.ts")
  pluginFn = mod.default
})

test("plugin returns correct provider name", async () => {
  const plugin = await pluginFn()
  expect(plugin.auth.provider).toBe("commandcode")
})

test("authorize returns success with valid key", async () => {
  const plugin = await pluginFn()
  const result = await plugin.auth.methods[0].authorize({ key: "sk-valid-key" })
  expect(result.type).toBe("success")
  expect((result as Record<string, unknown>).key).toBe("sk-valid-key")
})

test("authorize returns failed with empty key", async () => {
  const plugin = await pluginFn()
  const result = await plugin.auth.methods[0].authorize({ key: "   " })
  expect(result.type).toBe("failed")
})

test("authorize returns failed with undefined key", async () => {
  const plugin = await pluginFn()
  const result = await plugin.auth.methods[0].authorize({ key: undefined })
  expect(result.type).toBe("failed")
})

test("authorize returns failed with missing inputs", async () => {
  const plugin = await pluginFn()
  const result = await plugin.auth.methods[0].authorize(undefined)
  expect(result.type).toBe("failed")
})

test("authorize handles non-string key", async () => {
  const plugin = await pluginFn()
  const result = await plugin.auth.methods[0].authorize({ key: 123 as unknown as string })
  expect(result.type).toBe("failed")
})

test("loader returns apiKey on successful auth", async () => {
  const plugin = await pluginFn()
  const result = await plugin.auth.loader(async () => ({
    type: "api",
    key: "sk-loaded-key",
  }))
  expect(result).toEqual({ apiKey: "sk-loaded-key" })
})

test("loader returns empty object on null auth", async () => {
  const plugin = await pluginFn()
  const result = await plugin.auth.loader(async () => null)
  expect(result).toEqual({})
})

test("loader returns empty object on wrong auth type", async () => {
  const plugin = await pluginFn()
  const result = await plugin.auth.loader(async () => ({
    type: "oauth",
    key: "some-token",
  } as Record<string, unknown>))
  expect(result).toEqual({})
})

test("loader returns empty object when getAuth throws", async () => {
  const plugin = await pluginFn()
  const result = await plugin.auth.loader(async () => {
    throw new Error("auth failed")
  })
  expect(result).toEqual({})
})

test("config hook registers provider with npm and models", async () => {
  const plugin = await pluginFn()
  const config: Record<string, unknown> = {
    provider: { commandcode: {} },
  }
  await plugin.config(config)

  const cc = (config.provider as Record<string, Record<string, unknown>>).commandcode
  expect(cc.npm).toBe("commandcode-go-opencode-provider")
  expect(cc.name).toBe("Command Code")
  expect(cc.env).toEqual(["COMMANDCODE_API_KEY"])
  expect(cc.models).toBeDefined()
  const models = cc.models as Record<string, unknown>
  expect(Object.keys(models).length).toBeGreaterThan(0)
})

test("config hook does not overwrite existing npm field", async () => {
  const plugin = await pluginFn()
  const config: Record<string, unknown> = {
    provider: { commandcode: { npm: "custom-package" } },
  }
  await plugin.config(config)

  const cc = (config.provider as Record<string, Record<string, unknown>>).commandcode
  expect(cc.npm).toBe("custom-package")
})

test("config hook does not overwrite existing models", async () => {
  const plugin = await pluginFn()
  const config: Record<string, unknown> = {
    provider: { commandcode: { models: { "my-model": { id: "my-model" } } } },
  }
  await plugin.config(config)

  const cc = (config.provider as Record<string, Record<string, unknown>>).commandcode
  const models = cc.models as Record<string, unknown>
  expect(Object.keys(models)).toEqual(["my-model"])
})

test("config hook creates provider block if missing", async () => {
  const plugin = await pluginFn()
  const config: Record<string, unknown> = {}
  await plugin.config(config)

  expect(config.provider).toBeDefined()
  const cc = (config.provider as Record<string, Record<string, unknown>>).commandcode
  expect(cc).toBeDefined()
  expect(cc.npm).toBe("commandcode-go-opencode-provider")
})

test("config does not write to stdout or stderr by default", async () => {
  const logs: unknown[][] = []
  const warns: unknown[][] = []
  const origLog = console.log
  const origWarn = console.warn
  console.log = (...args: unknown[]) => {
    logs.push(args)
  }
  console.warn = (...args: unknown[]) => {
    warns.push(args)
  }
  try {
    const plugin = await pluginFn()
    const config: Record<string, unknown> = { provider: { commandcode: {} } }
    await plugin.config(config)
    expect(logs).toEqual([])
    expect(warns).toEqual([])
    const cc = (config.provider as Record<string, Record<string, unknown>>).commandcode
    expect(cc.models).toBeDefined()
    expect(Object.keys(cc.models as object).length).toBeGreaterThan(0)
  } finally {
    console.log = origLog
    console.warn = origWarn
  }
})

test("config hook attaches reasoning effort variants when available", async () => {
  const plugin = await pluginFn()
  const config: Record<string, unknown> = {
    provider: { commandcode: {} },
  }
  await plugin.config(config)

  const cc = (config.provider as Record<string, Record<string, unknown>>).commandcode
  const models = cc.models as Record<string, Record<string, unknown>>
  const withVariants = Object.values(models).filter(
    (m) => m.variants && typeof m.variants === "object",
  )
  // Bundled models.json or local command-code should expose at least one effort list
  expect(withVariants.length).toBeGreaterThan(0)
  const sample = withVariants[0]
  const variants = sample.variants as Record<string, { reasoningEffort?: string }>
  const keys = Object.keys(variants)
  expect(keys.length).toBeGreaterThan(0)
  expect(variants[keys[0]].reasoningEffort).toBe(keys[0])
})
