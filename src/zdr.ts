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

function asHeaderMap(value: unknown): Record<string, string> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, string>)
    : undefined;
}

/**
 * The caller's ZDR header value, matched case-insensitively (HTTP header names
 * are). The lowercase spelling wins when several spellings are present.
 */
export function findZdrHeader(headers: unknown): string | undefined {
  const current = asHeaderMap(headers);
  if (!current) return undefined;
  if (ZDR_HEADER in current) return String(current[ZDR_HEADER]);
  const key = Object.keys(current).find((name) => name.toLowerCase() === ZDR_HEADER);
  return key === undefined ? undefined : String(current[key]);
}

/**
 * Add the ZDR header without discarding headers already configured. An explicit
 * user value in any casing (`X-Cmd-Zdr: 0`) wins over the plugin's opt-in, and
 * every spelling collapses into the single lowercase key so a request never
 * carries two ZDR headers (`1, 0`).
 */
export function withZdrHeaders(
  existing: unknown,
  enabled: boolean,
): Record<string, string> | undefined {
  const current = asHeaderMap(existing);
  if (!enabled) return current;
  const value = findZdrHeader(current) ?? ZDR_HEADER_VALUE;
  const rest = Object.fromEntries(
    Object.entries(current ?? {}).filter(([name]) => name.toLowerCase() !== ZDR_HEADER),
  );
  return { [ZDR_HEADER]: value, ...rest };
}
