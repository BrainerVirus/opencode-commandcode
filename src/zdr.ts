import { liveEnv, type EnvDeps } from "./env.js";

/**
 * Command Code zero-data-retention opt-in. The Provider API enforces ZDR with
 * the `x-cmd-zdr: 1` request header (the CLI exposes the same opt-in as
 * `CMD_ZDR=1`); ZDR-incapable models fail with `422 cmd_zdr_no_providers`
 * instead of falling back to a non-ZDR upstream.
 */
export const ZDR_HEADER = "x-cmd-zdr";
export const ZDR_HEADER_VALUE = "1";

/** Values that turn `CMD_ZDR` on; everything else (including "0") leaves ZDR off. */
const ZDR_TRUTHY = new Set(["1", "true", "yes", "on"]);

/** Parse the `CMD_ZDR` environment value. */
export function zdrFromEnvValue(value: string | undefined): boolean {
  return typeof value === "string" && ZDR_TRUTHY.has(value.trim().toLowerCase());
}

/** ZDR is on when the plugin config opts in or `CMD_ZDR` is truthy. */
export function zdrEnabled(config: { zdr?: boolean }, deps: EnvDeps = liveEnv): boolean {
  return config.zdr === true || zdrFromEnvValue(deps.getEnv("CMD_ZDR"));
}

/** ZDR header map, or undefined when off so callers never create an empty `headers` key. */
export function zdrHeaders(enabled: boolean): Record<string, string> | undefined {
  return enabled ? { [ZDR_HEADER]: ZDR_HEADER_VALUE } : undefined;
}

/**
 * Add the ZDR header without discarding headers already configured. An explicit
 * user value (`headers["x-cmd-zdr"] = "0"`) wins over the plugin's opt-in.
 */
export function withZdrHeaders(
  existing: unknown,
  enabled: boolean,
): Record<string, string> | undefined {
  const current =
    typeof existing === "object" && existing !== null
      ? (existing as Record<string, string>)
      : undefined;
  const added = zdrHeaders(enabled);
  if (!added) return current;
  return { ...added, ...current };
}
