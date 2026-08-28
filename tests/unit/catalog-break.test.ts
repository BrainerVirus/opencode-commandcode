import { expect, test, describe } from "bun:test";
import {
  catalogBreakResolvedComment,
  catalogBreakTitle,
  renderCatalogBreakBody,
} from "../../src/catalog-break.ts";

describe("catalogBreakTitle", () => {
  test("includes the failed command-code version", () => {
    expect(catalogBreakTitle("1.39.0")).toBe(
      "[catalog-break] command-code@1.39.0 — model extraction failed",
    );
  });
});

describe("renderCatalogBreakBody", () => {
  test("includes version, error, workflow URL, and bundled version still in use", () => {
    const body = renderCatalogBreakBody({
      commandCodeVersion: "1.39.0",
      error: "Could not evaluate model catalog",
      workflowUrl: "https://github.com/BrainerVirus/opencode-commandcode/actions/runs/1",
      bundledCommandCodeVersion: "1.38.1",
    });
    expect(body).toContain("command-code@1.39.0");
    expect(body).toContain("Could not evaluate model catalog");
    expect(body).toContain("https://github.com/BrainerVirus/opencode-commandcode/actions/runs/1");
    expect(body).toContain("1.38.1");
    expect(body).toContain("src/catalog.ts");
  });
});

describe("catalogBreakResolvedComment", () => {
  test("points at the fix commit and release tag", () => {
    const comment = catalogBreakResolvedComment({
      commit: "abc1234",
      tag: "v0.5.1",
    });
    expect(comment).toContain("abc1234");
    expect(comment).toContain("v0.5.1");
  });
});
