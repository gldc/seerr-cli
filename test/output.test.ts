import { test, expect, describe } from "bun:test";
import { renderSuccess, renderError, redact, exitCodeForError } from "../src/cli/output";
import { SeerrError } from "../src/client/seerr";
import type { GlobalFlags } from "../src/types";

// All-false global flags; spread + override per test.
function flags(over: Partial<GlobalFlags> = {}): GlobalFlags {
  return {
    json: false,
    human: false,
    quiet: false,
    raw: false,
    dataOnly: false,
    dryRun: false,
    yes: false,
    insecure: false,
    strict: false,
    version: false,
    help: false,
    ...over,
  };
}

describe("renderSuccess", () => {
  test("wraps data and meta in the success envelope", () => {
    const r = renderSuccess({ data: { a: 1 }, meta: { count: 1 } }, flags());
    expect(r.exitCode).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ ok: true, data: { a: 1 }, meta: { count: 1 } });
  });

  test("raw flag emits just the data with no envelope", () => {
    const r = renderSuccess({ data: { a: 1 } }, flags({ raw: true }));
    expect(JSON.parse(r.stdout)).toEqual({ a: 1 });
  });
});

describe("renderError / exitCodeForError", () => {
  test("auth -> 3", () => {
    expect(renderError(new SeerrError("auth", "bad"), flags()).exitCode).toBe(3);
    expect(exitCodeForError(new SeerrError("auth", "bad"))).toBe(3);
  });

  test("not_found -> 4", () => {
    expect(renderError(new SeerrError("not_found", "x"), flags()).exitCode).toBe(4);
  });

  test("validation -> 2", () => {
    expect(renderError(new SeerrError("validation", "x"), flags()).exitCode).toBe(2);
  });

  test("upstream -> 5", () => {
    expect(renderError(new SeerrError("upstream", "x"), flags()).exitCode).toBe(5);
  });

  test("other -> 1", () => {
    expect(renderError(new SeerrError("other", "x"), flags()).exitCode).toBe(1);
  });

  test("error envelope shape goes to stderr", () => {
    const r = renderError(new SeerrError("auth", "bad"), flags());
    const parsed = JSON.parse(r.stderr);
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("auth");
  });
});

describe("redact", () => {
  test("masks the exact secret value", () => {
    expect(redact("key is abc12345 here", "abc12345")).toBe("key is *** here");
  });

  test("masks an apiKey query parameter", () => {
    expect(redact("https://h/x?apiKey=secretval")).toContain("apiKey=***");
  });

  test("leaves text without the secret untouched", () => {
    expect(redact("nothing", "abc12345")).toBe("nothing");
  });
});
