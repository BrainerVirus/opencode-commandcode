import { expect, test, describe } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { causeMessage, errResult, okResult, type LoadResult } from "@/src/load-result.ts";
import { liveEnv, resolveStateDir, type EnvDeps } from "@/src/env.ts";
import { pluginStateDir } from "@/src/startup.ts";

const fakeEnv = (overrides: Record<string, string> = {}): EnvDeps => ({
  homedir: () => "/fake/home",
  getEnv: (key) => overrides[key],
});

describe("LoadResult", () => {
  test("ok carries a value and narrows", () => {
    const result: LoadResult<number> = okResult(3);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(3);
    else throw new Error("unreachable");
  });

  test("err carries a reason and narrows", () => {
    const result: LoadResult<number> = errResult("boom");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("boom");
    else throw new Error("unreachable");
  });

  test("causeMessage unwraps errors and falls back", () => {
    expect(causeMessage(new Error("nope"))).toBe("nope");
    expect(causeMessage("plain")).toBe("plain");
    expect(causeMessage(undefined)).toBe("unknown error");
    expect(causeMessage(null)).toBe("unknown error");
  });
});

describe("EnvDeps", () => {
  test("resolveStateDir defaults under the injected homedir", () => {
    expect(resolveStateDir(fakeEnv())).toBe(
      "/fake/home/.local/state/opencode/commandcode-provider",
    );
  });

  test("resolveStateDir honors and trims the injected override", () => {
    expect(resolveStateDir(fakeEnv({ COMMANDCODE_PROVIDER_STATE_DIR: "  /tmp/state  " }))).toBe(
      "/tmp/state",
    );
  });

  test("pluginStateDir delegates to the injected deps, ignoring process.env", () => {
    expect(pluginStateDir(fakeEnv())).toBe("/fake/home/.local/state/opencode/commandcode-provider");
    const dir = mkdtempSync(join(tmpdir(), "cc-envseam-"));
    try {
      expect(pluginStateDir(fakeEnv({ COMMANDCODE_PROVIDER_STATE_DIR: dir }))).toBe(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("liveEnv reads the real environment", () => {
    expect(liveEnv.homedir().length).toBeGreaterThan(0);
    expect(liveEnv.getEnv("COMMANDCODE_PROVIDER_STATE_DIR_xyz_missing")).toBeUndefined();
  });
});
