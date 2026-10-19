import { expect, test, beforeAll, afterAll } from "bun:test";
import { createCommandCode } from "@/index.js";
import { makeCallOptions, mockFetchTrack } from "@/tests/helpers/mocks.js";

let originalEnv: Record<string, string | undefined> = {};
beforeAll(() => {
  originalEnv.COMMANDCODE_API_KEY = process.env.COMMANDCODE_API_KEY;
  delete process.env.COMMANDCODE_API_KEY;
  // A developer's CMD_ZDR=1 would make every languageModel() call fail closed.
  originalEnv.CMD_ZDR = process.env.CMD_ZDR;
  delete process.env.CMD_ZDR;
});
afterAll(() => {
  if (originalEnv.COMMANDCODE_API_KEY)
    process.env.COMMANDCODE_API_KEY = originalEnv.COMMANDCODE_API_KEY;
  if (originalEnv.CMD_ZDR !== undefined) process.env.CMD_ZDR = originalEnv.CMD_ZDR;
});

const noAuthPaths = { authPaths: [] as string[] };

test("throws when no API key is available", () => {
  expect(() => createCommandCode(noAuthPaths)).toThrow("Command Code API key not found");
});

test("throws with descriptive message listing all options", () => {
  try {
    createCommandCode(noAuthPaths);
    expect.unreachable("Should have thrown");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    expect(msg).toContain("COMMANDCODE_API_KEY");
    expect(msg).toContain("auth.json");
    expect(msg).toContain("apiKey");
  }
});

test("returns provider with languageModel when apiKey is provided", () => {
  const provider = createCommandCode({ apiKey: "sk-test" });
  expect(provider.languageModel).toBeDefined();
  expect(typeof provider.languageModel).toBe("function");
});

test("languageModel returns a model with correct provider and modelId", () => {
  const provider = createCommandCode({ apiKey: "sk-test" });
  const model = provider.languageModel("gpt-5.5");
  expect(model.provider).toBe("commandcode");
  expect(model.modelId).toBe("gpt-5.5");
  expect(model.specificationVersion).toBe("v3");
});

test("resolves API key from env var", () => {
  process.env.COMMANDCODE_API_KEY = "sk-from-env";
  const provider = createCommandCode();
  const model = provider.languageModel("test");
  expect(model).toBeDefined();
  delete process.env.COMMANDCODE_API_KEY;
});

test("explicit apiKey takes priority over env var", () => {
  process.env.COMMANDCODE_API_KEY = "sk-from-env";
  const provider = createCommandCode({ apiKey: "sk-explicit" });
  const model = provider.languageModel("test");
  expect(model).toBeDefined();
  delete process.env.COMMANDCODE_API_KEY;
});

test("each languageModel call returns a new instance", () => {
  const provider = createCommandCode({ apiKey: "sk-test" });
  const m1 = provider.languageModel("a");
  const m2 = provider.languageModel("b");
  expect(m1).not.toBe(m2);
  expect(m1.modelId).toBe("a");
  expect(m2.modelId).toBe("b");
});

async function withCmdZdr<T>(value: string | undefined, fn: () => Promise<T> | T): Promise<T> {
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

function emptyStream(respondWith: (response: Partial<Response>) => void): void {
  respondWith({
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "text/event-stream" }),
    body: new ReadableStream({
      start(controller) {
        controller.close();
      },
    }),
  });
}

test("CMD_ZDR=1 fails closed in the SDK without sending a request", async () => {
  await withCmdZdr("1", () => {
    const { calls, restore } = mockFetchTrack();
    try {
      // The guard sits on model resolution, so the factory itself still succeeds.
      const provider = createCommandCode({ apiKey: "sk-test" });
      expect(() => provider.languageModel("m")).toThrow("/provider/v1/*");
      expect(calls).toHaveLength(0);
    } finally {
      restore();
    }
  });
});

test("an explicit ZDR header in any casing fails closed in the SDK", async () => {
  await withCmdZdr(undefined, () => {
    for (const headers of [{ "x-cmd-zdr": "1" }, { "X-Cmd-Zdr": "1" }]) {
      const provider = createCommandCode({ apiKey: "sk-test", headers });
      expect(() => provider.languageModel("m")).toThrow("/alpha/generate");
    }
  });
});

test("an explicit x-cmd-zdr: 0 opts the SDK out of CMD_ZDR", async () => {
  await withCmdZdr("1", async () => {
    const { calls, restore, respondWith } = mockFetchTrack();
    emptyStream(respondWith);
    try {
      const provider = createCommandCode({ apiKey: "sk-test", headers: { "X-Cmd-Zdr": "0" } });
      await provider.languageModel("m").doStream(makeCallOptions());
      const headers = calls[0].options.headers as Record<string, string>;
      expect(headers["X-Cmd-Zdr"]).toBe("0");
    } finally {
      restore();
    }
  });
});

test("the SDK sends no ZDR header when ZDR is off", async () => {
  await withCmdZdr(undefined, async () => {
    const { calls, restore, respondWith } = mockFetchTrack();
    emptyStream(respondWith);
    try {
      const provider = createCommandCode({ apiKey: "sk-test" });
      await provider.languageModel("m").doStream(makeCallOptions());
      const headers = calls[0].options.headers as Record<string, string>;
      expect(Object.keys(headers).some((name) => name.toLowerCase() === "x-cmd-zdr")).toBe(false);
    } finally {
      restore();
    }
  });
});
