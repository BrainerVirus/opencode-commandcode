import { expect, test, describe } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dir, "../..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf-8");
const json = <T>(rel: string) => JSON.parse(read(rel)) as T;

const NPMJS = "${{ secrets.NPMJS }}";

describe("package.json publish identity", () => {
  test("is the scoped public package on BrainerVirus/opencode-commandcode-provider", () => {
    const pkg = json<{
      name: string;
      publishConfig?: { access?: string };
      repository?: { url?: string };
      bugs?: { url?: string };
      homepage?: string;
      files?: string[];
      scripts?: Record<string, string>;
    }>("package.json");
    expect(pkg.name).toBe("@brainervirus/commandcode-go-opencode-provider");
    expect(pkg.publishConfig?.access).toBe("public");
    expect(pkg.repository?.url).toContain("BrainerVirus/opencode-commandcode-provider");
    expect(pkg.bugs?.url).toContain("BrainerVirus/opencode-commandcode-provider");
    expect(pkg.homepage).toContain("BrainerVirus/opencode-commandcode-provider");
    expect(pkg.files).toContain("manifest.json");
    expect(pkg.scripts?.["verify:release-candidate"]).toContain("verify-release-candidate.ts");
    expect(pkg.scripts?.lint).toContain("oxlint --deny-warnings");
    expect(pkg.scripts?.format).toContain("oxfmt");
    expect(pkg.scripts?.["format:check"]).toContain("oxfmt --check");
    expect(pkg.scripts?.check).toContain("format:check");
  });
});

describe("ci.yml", () => {
  test("exposes named check jobs on pull requests to main", () => {
    const wf = Bun.YAML.parse(read(".github/workflows/ci.yml")) as {
      on: { pull_request?: { branches?: string[] }; push?: { branches?: string[] } };
      jobs: Record<string, { name?: string; steps: Array<{ run?: string }> }>;
    };
    expect(wf.on.pull_request?.branches).toContain("main");
    expect(wf.on.push?.branches).toContain("main");
    expect(wf.jobs.test.name).toBe("check (test)");
    expect(wf.jobs.typecheck.name).toBe("check (typecheck)");
    expect(wf.jobs.pack.name).toBe("check (pack)");
    expect(wf.jobs.lint.name).toBe("check (lint)");
    expect(wf.jobs.format.name).toBe("check (format)");
    const blob = Object.values(wf.jobs)
      .flatMap((j) => j.steps.map((s) => s.run ?? ""))
      .join("\n");
    expect(blob).toContain("bun test tests/unit/");
    expect(blob).toContain("bun run typecheck");
    expect(blob).toContain("verify:release-candidate");
    expect(blob).toContain("bun run lint");
    expect(blob).toContain("bun run format:check");
    expect(blob).not.toMatch(/\bnpm publish\b/);
    expect(blob).not.toContain("semantic-release");
  });
});

describe("release.yml", () => {
  test("runs semantic-release on main with the workit npm token mapping", () => {
    const wf = Bun.YAML.parse(read(".github/workflows/release.yml")) as {
      on: { push?: { branches?: string[] } };
      jobs: {
        release: {
          name?: string;
          steps: Array<{
            name?: string;
            uses?: string;
            with?: Record<string, string>;
            run?: string;
            env?: Record<string, string>;
          }>;
        };
      };
    };
    expect(wf.on.push?.branches).toContain("main");
    expect(wf.jobs.release.name).toBe("semantic-release");
    const setupNode = wf.jobs.release.steps.find((s) => s.uses?.startsWith("actions/setup-node"));
    expect(setupNode?.with?.["registry-url"]).toBe("https://registry.npmjs.org");
    const names = wf.jobs.release.steps.map((s) => s.name ?? "");
    expect(names.indexOf("Verify release candidate")).toBeGreaterThan(-1);
    expect(names.indexOf("Release")).toBeGreaterThan(names.indexOf("Verify release candidate"));
    expect(names.indexOf("Sync release manifests to main")).toBeGreaterThan(
      names.indexOf("Release"),
    );
    const release = wf.jobs.release.steps.find((s) => s.name === "Release");
    expect(release?.run).toContain("npx semantic-release");
    expect(release?.env?.NPM_TOKEN).toBe(NPMJS);
    expect(release?.env?.NODE_AUTH_TOKEN).toBe(NPMJS);
    const blob = wf.jobs.release.steps.map((s) => s.run ?? "").join("\n");
    expect(blob).not.toContain("publish-if-needed");
  });
});

describe("catalog-sync.yml", () => {
  test("opens a catalog PR and does not publish", () => {
    const wf = Bun.YAML.parse(read(".github/workflows/catalog-sync.yml")) as {
      on: {
        schedule?: Array<{ cron: string }>;
        workflow_dispatch?: { inputs?: { force?: unknown } };
      };
      jobs: {
        sync: {
          name?: string;
          steps: Array<{ name?: string; run?: string; env?: Record<string, string> }>;
        };
      };
    };
    expect(wf.on.schedule?.[0]?.cron).toBe("0 */6 * * *");
    expect(wf.on.workflow_dispatch?.inputs?.force).toBeDefined();
    expect(wf.jobs.sync.name).toBe("catalog-pr");
    const blob = wf.jobs.sync.steps
      .map((s) => `${s.run ?? ""}\n${JSON.stringify(s.env ?? {})}`)
      .join("\n");
    expect(blob).toContain("catalog-sync-ci.ts");
    expect(blob).not.toMatch(/\bnpm publish\b/);
    expect(blob).not.toContain("semantic-release");
    expect(blob).not.toContain("publish-if-needed");
  });
});

describe("release.config.cjs", () => {
  test("publishes the root package then GitHub Release", () => {
    const cfg = read("release.config.cjs");
    expect(cfg).toContain("@semantic-release/commit-analyzer");
    expect(cfg).toContain("./scripts/semantic-release-catalog-notes.cjs");
    expect(cfg).toContain("@semantic-release/npm");
    expect(cfg).toContain("@semantic-release/github");
    expect(cfg.indexOf("semantic-release-catalog-notes.cjs")).toBeLessThan(
      cfg.indexOf("@semantic-release/release-notes-generator"),
    );
    expect(cfg.indexOf("@semantic-release/npm")).toBeLessThan(
      cfg.indexOf("@semantic-release/github"),
    );
  });
});

describe("verify-release-candidate.ts", () => {
  test("is pack-only", () => {
    const src = read("scripts/verify-release-candidate.ts")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(src).toContain("npm pack");
    expect(src).not.toMatch(
      /\b(?:npm|npx|bun)\s+(?:publish|login|adduser)\b|\bgit\s+(?:push|tag)\b/,
    );
  });
});
