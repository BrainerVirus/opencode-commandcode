import { beforeAll, describe, expect, test } from "bun:test";
import { createCommandCode } from "@/index.js";
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
/** OpenAI-routed models reject `max_tokens` below 16, so keep the probe above it. */
const PROBE_MAX_TOKENS = 64;

type Probe = { id: string; status: number; code?: string };
type Discovery = { probes: Probe[]; capable: Probe[]; denied: Probe[] };

async function listChatModelIds(): Promise<string[]> {
  const response = await fetch(`${PROVIDER_BASE_URL}/models`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
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
async function postChat(model: string, extraHeaders: Record<string, string>) {
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

/** Probe chat models until one ZDR-capable and one ZDR-refused sample exist. */
async function discoverZdrOutcomes(ids: string[]): Promise<Discovery> {
  const probes: Probe[] = [];
  const capable: Probe[] = [];
  const denied: Probe[] = [];
  let started = 0;

  const header = withZdrHeaders(undefined, true) as Record<string, string>;

  const worker = async () => {
    while (capable.length === 0 || denied.length === 0) {
      const index = started++;
      if (index >= ids.length || started > MAX_PROBES) return;
      const id = ids[index]!;
      const result = await postChat(id, header);
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
    chatIds = await listChatModelIds();
    discovery = await discoverZdrOutcomes(chatIds);
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
      const result = await postChat(sample.id, {});
      if (result.status !== 200) {
        throw new Error(
          `control request for ${sample.id} returned ${result.status}: ${result.body.slice(0, 300)}`,
        );
      }
      expect(result.status).toBe(200);
    },
    NETWORK_TIMEOUT_MS,
  );

  test(
    "CMD_ZDR=1 reaches a live SDK request",
    async () => {
      const sample = discovery?.capable[0];
      if (!sample) throw new Error("no ZDR-capable sample to drive the SDK path");

      const previous = process.env.CMD_ZDR;
      process.env.CMD_ZDR = "1";
      try {
        const provider = createCommandCode({ apiKey: API_KEY! });
        const model = provider.languageModel(sample.id);
        // The SDK path targets the CLI-compatible endpoint, so this asserts the
        // opt-in survives a real request rather than re-checking upstream routing.
        // Reasoning models may answer with reasoning-only content at a small budget.
        const result = await model.doGenerate({
          prompt: [{ role: "user", content: "Reply with exactly the word: hello" }],
          maxOutputTokens: 64,
        });

        expect(result.content.length).toBeGreaterThan(0);
        expect(result.finishReason.unified).toMatch(/stop|length/);
      } finally {
        if (previous === undefined) delete process.env.CMD_ZDR;
        else process.env.CMD_ZDR = previous;
      }
    },
    NETWORK_TIMEOUT_MS,
  );
});

test("integration tests are skipped when COMMANDCODE_API_KEY is not set", () => {
  if (!hasApiKey) {
    console.log("Skipping ZDR integration tests: COMMANDCODE_API_KEY not set");
  }
});
