import { parseArgs } from "node:util";
import { SeerrError } from "../client/seerr";
import type { FlagSpec } from "../types";
import type { CommandSpec } from "./contract";

/** Validated, typed view of one command invocation's args + flags. */
export class Input {
  positionals: string[];
  private values: Record<string, unknown>;

  constructor(values: Record<string, unknown>, positionals: string[]) {
    this.values = values;
    this.positionals = positionals;
  }

  get(name: string): unknown {
    return this.values[name];
  }
  str(name: string): string | undefined {
    const v = this.values[name];
    return v === undefined || v === null ? undefined : String(v);
  }
  reqStr(name: string): string {
    const v = this.str(name);
    if (v === undefined) throw new SeerrError("usage", `Missing required value: ${name}`);
    return v;
  }
  int(name: string): number | undefined {
    const v = this.values[name];
    return typeof v === "number" ? v : undefined;
  }
  bool(name: string): boolean {
    return this.values[name] === true;
  }
  seasons(name: string): "all" | number[] | undefined {
    const v = this.values[name];
    if (v === undefined) return undefined;
    return v as "all" | number[];
  }
  pos(i: number): string | undefined {
    return this.positionals[i];
  }
}

function intOrThrow(label: string, raw: string, opts: { min?: number; max?: number } = {}): number {
  if (!/^-?\d+$/.test(raw.trim())) {
    throw new SeerrError("usage", `${label} must be an integer (got '${raw}')`);
  }
  const n = Number(raw);
  if (opts.min !== undefined && n < opts.min) {
    throw new SeerrError("usage", `${label} must be >= ${opts.min}`);
  }
  if (opts.max !== undefined && n > opts.max) {
    throw new SeerrError("usage", `${label} must be <= ${opts.max}`);
  }
  return n;
}

export function parseSeasons(raw: string): "all" | number[] {
  if (raw.trim().toLowerCase() === "all") return "all";
  const parts = raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    throw new SeerrError("usage", "Invalid --seasons value", {
      hint: "Use 'all' or a comma list like 1,2,3",
    });
  }
  const nums = parts.map((p) => intOrThrow("--seasons", p, { min: 0 }));
  return Array.from(new Set(nums));
}

function coerce(name: string, spec: FlagSpec, raw: unknown): unknown {
  if (spec.type === "boolean") return raw === true;
  if (name === "seasons") return parseSeasons(String(raw));
  if (spec.type === "int") return intOrThrow("--" + name, String(raw));
  if (spec.type === "enum") {
    const s = String(raw);
    if (spec.values && !spec.values.includes(s)) {
      throw new SeerrError("usage", `Invalid --${name} '${s}'`, {
        hint: `Expected one of: ${spec.values.join(", ")}`,
      });
    }
    return s;
  }
  return String(raw);
}

export function parse(cmd: CommandSpec, argv: string[]): Input {
  const flags = cmd.flags ?? {};
  const options: Record<string, { type: "string" | "boolean"; short?: string }> = {};
  for (const [name, spec] of Object.entries(flags)) {
    const opt: { type: "string" | "boolean"; short?: string } = {
      type: spec.type === "boolean" ? "boolean" : "string",
    };
    if (spec.short) opt.short = spec.short;
    options[name] = opt;
  }

  let parsed: { values: Record<string, unknown>; positionals: string[] };
  try {
    parsed = parseArgs({ args: argv, options, allowPositionals: true, strict: true }) as {
      values: Record<string, unknown>;
      positionals: string[];
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Invalid arguments";
    throw new SeerrError("usage", msg, { hint: `See: seerr ${cmd.name} --help` });
  }

  const values: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(flags)) {
    let raw = parsed.values[name];
    if (raw === undefined) {
      if (spec.default !== undefined) raw = spec.default;
      else {
        if (spec.required) {
          throw new SeerrError("usage", `Missing required flag --${name}`, { hint: spec.description });
        }
        continue;
      }
    }
    values[name] = coerce(name, spec, raw);
  }

  const args = cmd.args ?? [];
  args.forEach((a, i) => {
    if (a.variadic) {
      const rest = parsed.positionals.slice(i);
      if (rest.length === 0) {
        if (a.required) {
          throw new SeerrError("usage", `Missing required argument <${a.name}>`, { hint: a.description });
        }
        return;
      }
      values[a.name] = rest;
      return;
    }
    const val = parsed.positionals[i];
    if (val === undefined) {
      if (a.required) {
        throw new SeerrError("usage", `Missing required argument <${a.name}>`, { hint: a.description });
      }
      return;
    }
    values[a.name] = a.type === "int" ? intOrThrow(`<${a.name}>`, val) : val;
  });

  return new Input(values, parsed.positionals);
}
