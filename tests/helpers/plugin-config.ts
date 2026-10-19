import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { liveEnv } from "@/src/env.ts";

/**
 * Run `fn` with `~/.config/opencode/opencode-commandcode.json` holding `config`
 * and `CMD_ZDR` unset. The plugin hooks read the file through `liveEnv`, so its
 * `homedir` is pointed at a temp home for the duration (Bun's `os.homedir()`
 * ignores a runtime `HOME` change).
 */
export async function withPluginConfigFile<T>(config: unknown, fn: () => Promise<T>): Promise<T> {
  const home = mkdtempSync(join(tmpdir(), "cc-plugin-home-"));
  const dir = join(home, ".config", "opencode");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "opencode-commandcode.json"), JSON.stringify(config));

  const prevHomedir = liveEnv.homedir;
  const prevZdr = process.env.CMD_ZDR;
  liveEnv.homedir = () => home;
  delete process.env.CMD_ZDR;
  try {
    return await fn();
  } finally {
    liveEnv.homedir = prevHomedir;
    if (prevZdr === undefined) delete process.env.CMD_ZDR;
    else process.env.CMD_ZDR = prevZdr;
    rmSync(home, { recursive: true, force: true });
  }
}
