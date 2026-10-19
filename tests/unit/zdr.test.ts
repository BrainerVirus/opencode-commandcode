import { expect, test } from "bun:test";
import {
  ZDR_HEADER,
  ZDR_HEADER_VALUE,
  findZdrHeader,
  withZdrHeaders,
  zdrEnabled,
  zdrFromEnvValue,
  zdrHeaders,
} from "@/src/zdr.ts";

test("CMD_ZDR truthy spellings turn ZDR on", () => {
  for (const value of ["1", "true", "TRUE", "Yes", "on", "  1  "]) {
    expect(zdrFromEnvValue(value)).toBe(true);
  }
});

test("CMD_ZDR falsey or absent values leave ZDR off", () => {
  for (const value of [undefined, "", "0", "false", "no", "off", "banana"]) {
    expect(zdrFromEnvValue(value)).toBe(false);
  }
});

test("zdrEnabled reads the config flag or CMD_ZDR", () => {
  const env = (value: string | undefined) => ({
    homedir: () => "/tmp",
    getEnv: (key: string) => (key === "CMD_ZDR" ? value : undefined),
  });

  expect(zdrEnabled({}, env(undefined))).toBe(false);
  expect(zdrEnabled({}, env("1"))).toBe(true);
  expect(zdrEnabled({ zdr: true }, env(undefined))).toBe(true);
  expect(zdrEnabled({ zdr: false }, env("1"))).toBe(true);
  // A false config value never overrides a truthy env opt-in, and other env keys are ignored.
  expect(zdrEnabled({ zdr: false }, env("0"))).toBe(false);
});

test("zdrHeaders returns the header map only when enabled", () => {
  expect(zdrHeaders(true)).toEqual({ [ZDR_HEADER]: ZDR_HEADER_VALUE });
  expect(zdrHeaders(false)).toBeUndefined();
});

test("withZdrHeaders keeps existing headers and never creates an empty map", () => {
  expect(withZdrHeaders(undefined, false)).toBeUndefined();
  expect(withZdrHeaders(undefined, true)).toEqual({ [ZDR_HEADER]: ZDR_HEADER_VALUE });
  expect(withZdrHeaders({ "x-other": "1" }, true)).toEqual({
    [ZDR_HEADER]: ZDR_HEADER_VALUE,
    "x-other": "1",
  });
  expect(withZdrHeaders({ "x-other": "1" }, false)).toEqual({ "x-other": "1" });
});

test("withZdrHeaders lets an explicit user value win over the opt-in", () => {
  expect(withZdrHeaders({ [ZDR_HEADER]: "0" }, true)).toEqual({ [ZDR_HEADER]: "0" });
});

test("findZdrHeader matches the header name case-insensitively", () => {
  expect(findZdrHeader(undefined)).toBeUndefined();
  expect(findZdrHeader({ "x-other": "1" })).toBeUndefined();
  expect(findZdrHeader({ "X-Cmd-Zdr": "0" })).toBe("0");
  expect(findZdrHeader({ "X-CMD-ZDR": "1" })).toBe("1");
  // The lowercase spelling wins when several are present.
  expect(findZdrHeader({ "X-Cmd-Zdr": "1", [ZDR_HEADER]: "0" })).toBe("0");
});

test("withZdrHeaders keeps a mixed-case user value and collapses it to lowercase", () => {
  expect(withZdrHeaders({ "X-Cmd-Zdr": "0" }, true)).toEqual({ [ZDR_HEADER]: "0" });
  expect(withZdrHeaders({ "X-CMD-ZDR": "0", "x-other": "yes" }, true)).toEqual({
    [ZDR_HEADER]: "0",
    "x-other": "yes",
  });
  expect(withZdrHeaders({ "X-Cmd-Zdr": "1", [ZDR_HEADER]: "0" }, true)).toEqual({
    [ZDR_HEADER]: "0",
  });
});

test("withZdrHeaders leaves headers untouched when ZDR is off", () => {
  const headers = { "X-Cmd-Zdr": "0" };
  expect(withZdrHeaders(headers, false)).toBe(headers);
});

test("withZdrHeaders does not mutate the caller's map", () => {
  const headers = { "X-Cmd-Zdr": "0", "x-other": "yes" };
  withZdrHeaders(headers, true);
  expect(headers).toEqual({ "X-Cmd-Zdr": "0", "x-other": "yes" });
});
