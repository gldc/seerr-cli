import { test, expect, describe } from "bun:test";
import { parse, parseSeasons, Input } from "../src/cli/parse";
import type { CommandSpec } from "../src/cli/contract";

describe("parseSeasons", () => {
  test("'all' is passed through", () => {
    expect(parseSeasons("all")).toBe("all");
  });

  test("a comma list becomes a number array", () => {
    expect(parseSeasons("1,2,3")).toEqual([1, 2, 3]);
  });

  test("dedupes while preserving first-seen order", () => {
    expect(parseSeasons("3,1,1")).toEqual([3, 1]);
  });

  test("rejects non-numeric values", () => {
    expect(() => parseSeasons("x")).toThrow();
  });
});

// Minimal command spec exercising int / enum / boolean flags plus a required int arg.
const cmd: CommandSpec = {
  name: "t",
  summary: "",
  flags: {
    n: { type: "int", description: "" },
    mode: { type: "enum", values: ["a", "b"], description: "" },
    on: { type: "boolean", description: "" },
  },
  args: [{ name: "id", type: "int", required: true, description: "" }],
  handler: async () => ({ data: null }),
} as any;

describe("parse", () => {
  test("coerces positional int, flag int, enum, and boolean", () => {
    const input = parse(cmd, ["5", "--n", "7", "--mode", "a", "--on"]);
    expect(input).toBeInstanceOf(Input);
    expect(input.int("id")).toBe(5);
    expect(input.int("n")).toBe(7);
    expect(input.str("mode")).toBe("a");
    expect(input.bool("on")).toBe(true);
  });

  test("throws when a required positional arg is missing", () => {
    expect(() => parse(cmd, [])).toThrow();
  });

  test("throws on an invalid enum value", () => {
    expect(() => parse(cmd, ["5", "--mode", "z"])).toThrow();
  });

  test("throws on a non-integer int flag", () => {
    expect(() => parse(cmd, ["5", "--n", "notint"])).toThrow();
  });
});
