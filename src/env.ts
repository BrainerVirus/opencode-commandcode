import { homedir as osHomedir } from "os";
import { join } from "path";

/**
 * Hermetic seam for environment access. Runtime code takes an optional
 * `deps` parameter defaulting to `liveEnv`, so existing call sites behave
 * identically while tests inject fakes instead of juggling `process.env`.
 * Filesystem calls stay direct; only environment reads go through here.
 */
export type EnvDeps = {
  homedir: () => string;
  getEnv: (key: string) => string | undefined;
};

export const liveEnv: EnvDeps = {
  homedir: () => osHomedir(),
  getEnv: (key) => process.env[key],
};

/** Plugin state directory: explicit override wins, otherwise under home. */
export function resolveStateDir(deps: EnvDeps = liveEnv): string {
  const override = deps.getEnv("COMMANDCODE_PROVIDER_STATE_DIR")?.trim();
  if (override) return override;
  return join(deps.homedir(), ".local/state/opencode/commandcode-provider");
}
