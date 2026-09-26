/**
 * Explicit load result: a value on success, a human-readable reason when
 * there is none. Load boundaries return this instead of catching everything
 * and yielding `null`, so callers can thread the reason into degraded
 * reporting instead of guessing which read failed.
 */
export type LoadResult<T> = { ok: true; value: T } | { ok: false; reason: string };

export function okResult<T>(value: T): LoadResult<T> {
  return { ok: true, value };
}

export function errResult<T>(reason: string): LoadResult<T> {
  return { ok: false, reason };
}

/** One-line summary of a caught value for embedding in a reason string. */
export function causeMessage(cause: unknown): string {
  if (cause instanceof Error && cause.message) return cause.message;
  if (typeof cause === "string" && cause) return cause;
  return "unknown error";
}
