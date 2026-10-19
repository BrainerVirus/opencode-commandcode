import { beforeAll, describe, expect, test } from "bun:test";
import { withZdrHeaders } from "@/src/zdr.js";

/**
 * Live zero-data-retention checks against api.commandcode.ai.
 *
 * The unit suites prove the plugin emits `x-cmd-zdr: 1`; this suite proves the
 * Provider API honors that exact header: some chat model answers, and some
 * model without a ZDR-capable upstream is refused with `cmd_zdr_no_providers`.
 *
 * No model ID is hardcoded. Chat-capable IDs come from `GET /provider/v1/models`
 * and are probed with `max_tokens: 1` until both outcomes appear (a 422 response
 * never reaches an upstream, so refusals are free). 403 (account entitlement),
 * 429, and 5xx are tolerated along the way; a 400/401 would be a real defect.
 *
 * Every request carries an AbortSignal tied to a deadline inside the test
 * timeout, so a timed-out run cancels in-flight probes and schedules no more.
 *
 * Skipped unless COMMANDCODE_API_KEY is set, and outside `bun run check` because
 * ZDR coverage depends on live upstream availability and account entitlements.
 */

const API_KEY = process.env.COMMANDCODE_API_KEY?.trim();
const hasApiKey = !!API_KEY;

const skipIfNoKey = hasApiKey ? describe : describe.skip;

const PROVIDER_BASE_URL = "https://api.commandcode.ai/provider/v1";
const ZDR_REFUSAL = "cmd_zdr_no_providers";

/** Stop after this many probes even if a branch is still missing. */
const MAX_PROBES = 40;
const CONCURRENCY = 4;
const NETWORK_TIMEOUT_MS = 180_000;
/** Abort requests before the test timeout fires, so none outlive their test. */
const REQUEST_BUDGET_MS = NETWORK_TIMEOUT_MS - 15_000;
/** OpenAI-routed models reject `max_tokens` below 16, so keep the probe above it. */
const PROBE_MAX_TOKENS = 64;

type Probe = { id: string; status: number; code?: string };
type Discovery = { probes: Probe[]; capable: Probe[]; denied: Probe[] };

async function listChatModelIds(signal: AbortSignal): Promise<string[]> {
  const response = await fetch(`${PROVIDER_BASE_URL}/models`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
    signal,
  });
  if (response.status !== 200) {
    throw new Error(`GET /models: ${response.status} ${(await response.text()).slice(0, 300)}`);
  }
  const payload = (await response.json()) as {
    data?: Array<{ id?: string; supported_endpoints?: string[] }>;
  };
  return (payload.data ?? [])
    .filter((entry) =>
      (entry.supported_endpoints ?? []).some((endpoint) => endpoint.includes("chat/completions")),
    )
    .map((entry) => entry.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}

/** One minimal chat request; `extraHeaders` carries the plugin's ZDR map. */
async function postChat(model: string, extraHeaders: Record<string, string>, signal: AbortSignal) {
  const response = await fetch(`${PROVIDER_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      ...extraHeaders,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "hi" }],
      max_tokens: PROBE_MAX_TOKENS,
    }),
    signal,
  });
  const body = await response.text();
  let code: string | undefined;
  if (response.status !== 200) {
    try {
      code = (JSON.parse(body) as { error?: { code?: string } }).error?.code;
    } catch {
      code = undefined;
    }
  }
  return { status: response.status, body, code };
}

/**
 * Probe chat models until one ZDR-capable and one ZDR-refused sample exist, or
 * until `signal` aborts: an aborted probe is dropped and no new one starts.
 */
async function discoverZdrOutcomes(ids: string[], signal: AbortSignal): Promise<Discovery> {
  const probes: Probe[] = [];
  const capable: Probe[] = [];
  const denied: Probe[] = [];
  let started = 0;

  const header = withZdrHeaders(undefined, true) as Record<string, string>;

  const worker = async () => {
    while (!signal.aborted && (capable.length === 0 || denied.length === 0)) {
      const index = started++;
      if (index >= ids.length || started > MAX_PROBES) return;
      const id = ids[index]!;
      let result: Awaited<ReturnType<typeof postChat>>;
      try {
        result = await postChat(id, header, signal);
      } catch (error) {
        if (signal.aborted) return;
        throw error;
      }
      const probe: Probe = {
        id,
        status: result.status,
        ...(result.code ? { code: result.code } : {}),
      };
      probes.push(probe);
      if (probe.status === 200) capable.push(probe);
      else if (probe.status === 422 && probe.code === ZDR_REFUSAL) denied.push(probe);
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return { probes, capable, denied };
}

skipIfNoKey("integration: zero data retention", () => {
  let chatIds: string[] = [];
  let discovery: Discovery | undefined;

  beforeAll(async () => {
    const signal = AbortSignal.timeout(REQUEST_BUDGET_MS);
    chatIds = await listChatModelIds(signal);
    discovery = await discoverZdrOutcomes(chatIds, signal);
    console.log(
      `ZDR probe: ${discovery.probes.length}/${chatIds.length} chat models probed, ` +
        `${discovery.capable.length} served, ${discovery.denied.length} refused`,
    );
  }, NETWORK_TIMEOUT_MS);

  test("at least one chat model serves a ZDR request", () => {
    const capable = discovery?.capable ?? [];
    console.log(
      "ZDR-capable sample:",
      capable
        .slice(0, 3)
        .map((probe) => probe.id)
        .join(", "),
    );
    if (capable.length === 0) {
      throw new Error(
        `no ZDR-capable chat model among ${discovery?.probes.length ?? 0} probes: ` +
          `${JSON.stringify(discovery?.probes.slice(0, 10))}`,
      );
    }
    for (const probe of capable) expect(probe.status).toBe(200);
  });

  test("a model without a ZDR-capable upstream is refused with cmd_zdr_no_providers", () => {
    const denied = discovery?.denied ?? [];
    console.log(
      "ZDR-refused sample:",
      denied
        .slice(0, 3)
        .map((probe) => probe.id)
        .join(", "),
    );
    if (denied.length === 0) {
      throw new Error(
        `no ${ZDR_REFUSAL} response among ${discovery?.probes.length ?? 0} probes; ` +
          `upstream ZDR coverage may have widened, or MAX_PROBES is too low`,
      );
    }
    for (const probe of denied) expect(probe.code).toBe(ZDR_REFUSAL);
  });

  test("the header never produces a malformed request or an auth error", () => {
    const rejected = (discovery?.probes ?? []).filter(
      (probe) => probe.status === 400 || probe.status === 401,
    );
    expect(rejected).toEqual([]);
  });

  test(
    "the same model answers without the header (control)",
    async () => {
      const sample = discovery?.denied[0];
      if (!sample) throw new Error("no ZDR-refused sample to use as a control");
      const result = await postChat(sample.id, {}, AbortSignal.timeout(REQUEST_BUDGET_MS));
      if (result.status !== 200) {
        throw new Error(
          `control request for ${sample.id} returned ${result.status}: ${result.body.slice(0, 300)}`,
        );
      }
      expect(result.status).toBe(200);
    },
    NETWORK_TIMEOUT_MS,
  );
});
