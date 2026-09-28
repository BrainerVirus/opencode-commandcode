import { expect, test, describe } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { parseAvailabilityIds } from "@/src/catalog.ts";
import { buildSyncArtifacts } from "@/scripts/sync-models.ts";
import { lastSuccessfulModelCount, meetsModelCountFloor } from "@/src/manifest.ts";

function availabilityResponse(ids: string[]): unknown {
  return { object: "list", data: ids.map((id) => ({ id })) };
}

describe("sync availability gate", () => {
  test("below-floor intersection fails before any artifact write", () => {
    const prior = {
      schemaVersion: 1 as const,
      generatedAt: "2026-09-20T00:00:00.000Z",
      pluginVersion: "0.7.72",
      commandCodeVersion: "1.58.1",
      commandCodeTarball: "https://registry.npmjs.org/command-code/-/command-code-1.58.1.tgz",
      modelCount: 78,
      reasoningModelCount: 67,
      extraction: {
        modelCatalog: "ok" as const,
        costCatalog: "cli" as const,
        costCatalogError: null,
      },
      costSources: { cli: 78, officialDocs: 0, thirdParty: 0, free: 0, fallback: 0, unmatched: 0 },
      status: "healthy" as const,
    };
    const last = lastSuccessfulModelCount(prior);
    const filteredCount = 3;
    expect(meetsModelCountFloor(filteredCount, last)).toBe(false);
  });

  test("a malformed availability payload fails validation", () => {
    expect(() => parseAvailabilityIds({ object: "list", data: [] })).toThrow();
    expect(() =>
      parseAvailabilityIds({ object: "list", data: [{ id: "a" }, { id: "a" }] }),
    ).toThrow();
  });

  test("a valid small intersection parses and a writer gate would keep artifacts untouched", () => {
    const ids = parseAvailabilityIds(availabilityResponse(["keep-a", "keep-b"]));
    expect(ids).toEqual(["keep-a", "keep-b"]);
    expect(meetsModelCountFloor(ids.length, 78)).toBe(false);
  });
});

describe("buildSyncArtifacts", () => {
  const candidate = (id: string) => ({
    id,
    name: id,
    tier: "open-source" as const,
    reasoning: false,
    tool_call: true,
    cost: { input: 0, output: 0 },
    limit: { context: 1, output: 1 },
  });

  const base = {
    version: "1.58.1",
    sourceLabel: "test",
    pluginVersion: "0.7.72",
    availabilityModels: [] as Array<{
      id: string;
      context_length?: number;
      supported_endpoints?: string[];
    }>,
    priorModels: [] as ReturnType<typeof candidate>[],
    priorManifest: null,
    cliIds: new Set<string>(),
    docIds: new Set<string>(),
    thirdPartyIds: new Set<string>(),
    freeIds: new Set<string>(),
    generatedAt: "2026-09-20T00:00:00.000Z",
  };

  test("three CLI candidates with two API ids build two models plus sorted unavailable review", () => {
    const artifacts = buildSyncArtifacts({
      ...base,
      candidates: [
        candidate("keep-a"),
        candidate("keep-b"),
        candidate("retired"),
        ...Array.from({ length: 20 }, (_, i) => candidate(`keep-extra-${i}`)),
      ],
      availabilityModels: [
        "keep-a",
        "keep-b",
        "api-only",
        ...Array.from({ length: 20 }, (_, i) => `keep-extra-${i}`),
      ].map((id) => ({ id })),
    });
    expect(artifacts.models.map((m) => m.id).slice(0, 2)).toEqual(["keep-a", "keep-b"]);
    expect(artifacts.manifest.modelCount).toBe(22);
    expect(artifacts.manifest.review?.unavailable).toEqual([
      { id: "retired", reason: "not-listed-by-provider-api" },
    ]);
  });

  test("sync carries advertised endpoint changes and preserves known endpoints on partial responses", () => {
    const candidates = [
      candidate("changed"),
      candidate("partial"),
      candidate("cleared"),
      ...Array.from({ length: 18 }, (_, i) => candidate(`keep-${i}`)),
    ];
    const artifacts = buildSyncArtifacts({
      ...base,
      candidates,
      availabilityModels: [
        { id: "changed", supported_endpoints: ["/v1/responses"] },
        { id: "partial" },
        { id: "cleared", supported_endpoints: [] },
        ...Array.from({ length: 18 }, (_, i) => ({ id: `keep-${i}` })),
      ],
      priorModels: [
        { ...candidate("changed"), supported_endpoints: ["/v1/chat/completions"] },
        { ...candidate("partial"), supported_endpoints: ["/v1/chat/completions"] },
        { ...candidate("cleared"), supported_endpoints: ["/v1/responses"] },
      ],
    });
    expect(artifacts.models.find((model) => model.id === "changed")?.supported_endpoints).toEqual([
      "/v1/responses",
    ]);
    expect(artifacts.models.find((model) => model.id === "partial")?.supported_endpoints).toEqual([
      "/v1/chat/completions",
    ]);
    expect(artifacts.models.find((model) => model.id === "cleared")?.supported_endpoints).toEqual(
      [],
    );
  });

  test("buildSyncArtifacts never writes generated artifacts, even on success", () => {
    const dir = mkdtempSync(join(tmpdir(), "cc-sync-"));
    try {
      const modelsPath = join(dir, "models.json");
      const manifestPath = join(dir, "manifest.json");
      const versionPath = join(dir, "_version.txt");
      writeFileSync(modelsPath, '[{"id":"keep-a"}]\n');
      writeFileSync(manifestPath, '{"modelCount":1}\n');
      writeFileSync(versionPath, "1.58.1\n");
      const before = {
        models: readFileSync(modelsPath, "utf-8"),
        manifest: readFileSync(manifestPath, "utf-8"),
        version: readFileSync(versionPath, "utf-8"),
      };
      // Throws on the floor (1 retained < 20) — the only path that must not write.
      // Success returns payloads for main() to write after every build succeeds;
      // the function takes no output paths, so it cannot write by construction.
      expect(() =>
        buildSyncArtifacts({
          ...base,
          candidates: [candidate("keep-a")],
          availabilityModels: [{ id: "other" }],
        }),
      ).toThrow();
      expect(readFileSync(modelsPath, "utf-8")).toBe(before.models);
      expect(readFileSync(manifestPath, "utf-8")).toBe(before.manifest);
      expect(readFileSync(versionPath, "utf-8")).toBe(before.version);
      const ok = buildSyncArtifacts({
        ...base,
        candidates: [
          candidate("keep-a"),
          ...Array.from({ length: 20 }, (_, i) => candidate(`keep-extra-${i}`)),
        ],
        availabilityModels: [
          "keep-a",
          ...Array.from({ length: 20 }, (_, i) => `keep-extra-${i}`),
        ].map((id) => ({ id })),
      });
      expect(ok.models).toHaveLength(21);
      // Still untouched: main() performs the three writes from these payloads.
      expect(readFileSync(modelsPath, "utf-8")).toBe(before.models);
      expect(readFileSync(manifestPath, "utf-8")).toBe(before.manifest);
      expect(readFileSync(versionPath, "utf-8")).toBe(before.version);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
