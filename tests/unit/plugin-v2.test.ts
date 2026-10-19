import { expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { withPluginConfigFile } from "@/tests/helpers/plugin-config.ts";

let dual: { id: string; setup: (ctx: unknown) => Promise<unknown>; server: () => Promise<unknown> };
let prevStateDir: string | undefined;
let testStateDir: string;

beforeAll(async () => {
  testStateDir = mkdtempSync(join(tmpdir(), "cc-v2-state-"));
  prevStateDir = process.env.COMMANDCODE_PROVIDER_STATE_DIR;
  process.env.COMMANDCODE_PROVIDER_STATE_DIR = testStateDir;
  const mod = await import("@/plugin.ts");
  dual = mod.default;
});

afterAll(() => {
  if (prevStateDir === undefined) delete process.env.COMMANDCODE_PROVIDER_STATE_DIR;
  else process.env.COMMANDCODE_PROVIDER_STATE_DIR = prevStateDir;
  rmSync(testStateDir, { recursive: true, force: true });
});

test("default export carries V2 id/setup plus V1 server", async () => {
  expect(dual.id).toBe("commandcode");
  expect(typeof dual.setup).toBe("function");
  expect(typeof dual.server).toBe("function");
  const mod = await import("@/plugin.ts");
  expect(mod.server).toBe(dual.server);
});

test("V2 setup adds provider with models when missing", async () => {
  const calls: Array<{ name: string }> = [];
  const methods: unknown[] = [];
  let added: any = null;
  const ctx = {
    provider: {
      transform: async (fn: (editor: any) => void) => {
        calls.push({ name: "provider.transform" });
        const editor = {
          get: () => undefined,
          add: (input: any) => {
            added = input;
          },
          update: () => {
            throw new Error("update should not run when provider is missing");
          },
          models: {
            set: () => {
              throw new Error("models.set should not run on add path");
            },
          },
        };
        fn(editor);
      },
    },
    integration: {
      transform: async (fn: (editor: any) => void) => {
        calls.push({ name: "integration.transform" });
        fn({ method: { update: (input: unknown) => methods.push(input) } });
      },
    },
  };
  await dual.setup(ctx);
  expect(calls.map((call) => call.name)).toEqual(["provider.transform", "integration.transform"]);
  expect(added.info.id).toBe("commandcode");
  expect(added.info.activation).toBe("auto");
  expect(added.info.package).toBe("@opencode/ai/providers/openai-compatible");
  expect(added.info.integrationID).toBe("commandcode");
  expect(added.info.env).toEqual(["COMMANDCODE_API_KEY"]);
  expect(added.info.settings.apiKey).toBeUndefined();
  expect(added.info.settings.baseURL).toBe("https://api.commandcode.ai/provider/v1");
  expect(Array.isArray(added.models)).toBe(true);
  expect(added.models.length).toBeGreaterThan(20);
  const sample = added.models[0];
  expect(sample.providerID).toBe("commandcode");
  expect(sample.capabilities.input).toContain("text");
  expect(sample.cost[0].cache).toHaveProperty("read");
  const deepseek = added.models.find((m: { id: string }) => m.id === "deepseek-v4.1-flash");
  expect(deepseek).toBeDefined();
  expect(deepseek.modelID).toBe("deepseek/deepseek-v4.1-flash");
  expect(deepseek.id).toBe("deepseek-v4.1-flash");
  expect(methods).toEqual([
    { integrationID: "commandcode", method: { type: "key", label: "API Key" } },
    {
      integrationID: "commandcode",
      method: { type: "env", names: ["COMMANDCODE_API_KEY"] },
    },
  ]);
});

test("V2 setup preserves existing package and sets models", async () => {
  let updated: any = null;
  let setModels: any = null;
  const ctx = {
    provider: {
      transform: async (fn: (editor: any) => void) => {
        const editor = {
          get: () => ({ provider: { id: "commandcode" }, models: new Map() }),
          add: () => {
            throw new Error("add should not run when provider exists");
          },
          update: (_id: string, fn2: (p: any) => void) => {
            updated = {
              id: _id,
              activation: "disabled",
              package: "custom/provider",
              settings: {},
            };
            fn2(updated);
          },
          models: {
            set: (id: string, models: any) => {
              setModels = { id, models };
            },
          },
        };
        fn(editor);
      },
    },
    integration: {
      transform: async (fn: (editor: any) => void) => {
        fn({ method: { update: () => {} } });
      },
    },
  };
  await dual.setup(ctx);
  expect(updated.id).toBe("commandcode");
  expect(updated.activation).toBe("disabled");
  expect(updated.settings.baseURL).toBe("https://api.commandcode.ai/provider/v1");
  expect(updated.integrationID).toBe("commandcode");
  expect(updated.env).toEqual(["COMMANDCODE_API_KEY"]);
  expect(updated.settings.apiKey).toBeUndefined();
  // Must not overwrite existing user choices.
  expect(updated.package).toBe("custom/provider");
  expect(setModels.id).toBe("commandcode");
  expect(setModels.models.length).toBeGreaterThan(20);
});

type Captured = { added: any; updated: any; setModels: any };

/** Minimal V2 context; `existing` seeds the update path, absence exercises the add path. */
function makeCtx(existing?: any): { ctx: any; captured: Captured } {
  const captured: Captured = { added: null, updated: null, setModels: null };
  const ctx = {
    provider: {
      transform: async (fn: (editor: any) => void) => {
        const editor = {
          get: () => existing,
          add: (input: any) => {
            captured.added = input;
          },
          update: (id: string, fn2: (p: any) => void) => {
            captured.updated = existing ?? { id, settings: {} };
            fn2(captured.updated);
          },
          models: {
            set: (id: string, models: any) => {
              captured.setModels = { id, models };
            },
          },
        };
        fn(editor);
      },
    },
    integration: {
      transform: async (fn: (editor: any) => void) => {
        fn({ method: { update: () => {} } });
      },
    },
  };
  return { ctx, captured };
}

async function withEnvZdr<T>(value: string | undefined, fn: () => Promise<T>): Promise<T> {
  const prev = process.env.CMD_ZDR;
  if (value === undefined) delete process.env.CMD_ZDR;
  else process.env.CMD_ZDR = value;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.CMD_ZDR;
    else process.env.CMD_ZDR = prev;
  }
}

test("V2 setup leaves headers unset without a ZDR opt-in", async () => {
  await withEnvZdr(undefined, async () => {
    const { ctx, captured } = makeCtx();
    await dual.setup(ctx);
    expect(captured.added.info.headers).toBeUndefined();
  });
});

test("CMD_ZDR=1 adds the ZDR header to a new V2 provider", async () => {
  await withEnvZdr("1", async () => {
    const { ctx, captured } = makeCtx();
    await dual.setup(ctx);
    expect(captured.added.info.headers).toEqual({ "x-cmd-zdr": "1" });
    expect(captured.added.info.settings.baseURL).toBe("https://api.commandcode.ai/provider/v1");
  });
});

test("V2 setup merges the ZDR header into existing provider headers", async () => {
  await withEnvZdr("1", async () => {
    const existing = {
      id: "commandcode",
      headers: { "x-other": "yes", "x-cmd-zdr": "0" },
      settings: {},
    };
    const { ctx, captured } = makeCtx(existing);
    await dual.setup(ctx);
    // An explicit user value survives the plugin opt-in.
    expect(captured.updated.headers).toEqual({ "x-cmd-zdr": "0", "x-other": "yes" });
    expect(captured.setModels.id).toBe("commandcode");
  });
});

test("a mixed-case user ZDR header wins and collapses to lowercase on V2", async () => {
  await withEnvZdr("1", async () => {
    const existing = {
      id: "commandcode",
      headers: { "X-Cmd-Zdr": "0", "x-other": "yes" },
      settings: {},
    };
    const { ctx, captured } = makeCtx(existing);
    await dual.setup(ctx);
    expect(captured.updated.headers).toEqual({ "x-cmd-zdr": "0", "x-other": "yes" });
  });
});

test("config zdr survives an invalid sibling field on V2", async () => {
  await withPluginConfigFile({ zdr: true, debugStartupLogs: "false" }, async () => {
    const { ctx, captured } = makeCtx();
    await dual.setup(ctx);
    expect(captured.added.info.headers).toEqual({ "x-cmd-zdr": "1" });
  });
});

test("an invalid config zdr value fails safe to on for V2", async () => {
  await withPluginConfigFile({ zdr: "true" }, async () => {
    const { ctx, captured } = makeCtx();
    await dual.setup(ctx);
    expect(captured.added.info.headers).toEqual({ "x-cmd-zdr": "1" });
  });
});
