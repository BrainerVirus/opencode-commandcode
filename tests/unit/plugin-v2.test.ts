import { expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

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
  };
  await dual.setup(ctx);
  expect(calls.length).toBe(1);
  expect(added.info.id).toBe("commandcode");
  expect(added.info.package).toBe("aisdk:@ai-sdk/openai-compatible");
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
            updated = { id: _id };
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
  };
  await dual.setup(ctx);
  expect(updated.id).toBe("commandcode");
  expect(updated.settings.baseURL).toBe("https://api.commandcode.ai/provider/v1");
  expect(updated.settings.apiKey).toBe("{env:COMMANDCODE_API_KEY}");
  // Must not overwrite an existing custom package.
  expect(updated.package).toBeUndefined();
  expect(setModels.id).toBe("commandcode");
  expect(setModels.models.length).toBeGreaterThan(20);
});
