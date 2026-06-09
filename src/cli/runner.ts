import pkg from "../../package.json";
import { SeerrClient, SeerrError } from "../client/seerr";
import { defaultInitIO, runInit } from "../commands/init";
import { resolveConfig, type RawFlags, type ResolveDeps } from "../config";
import type { GlobalFlags } from "../types";
import { redact, renderError, renderSuccess, type RenderResult } from "./output";
import { parse } from "./parse";
import { matchCommand, registry } from "./registry";

const GLOBAL_BOOL = [
  "json",
  "human",
  "quiet",
  "raw",
  "data-only",
  "dry-run",
  "yes",
  "insecure",
  "strict",
  "help",
  "version",
];
const GLOBAL_VALUE = ["url", "api-key-file", "timeout"];

export interface RunDeps extends ResolveDeps {
  fetchImpl?: typeof fetch;
  isTTY?: boolean;
}

function extractGlobals(
  argv: string[],
  isTTY: boolean,
): { global: GlobalFlags; rawFlags: RawFlags; rest: string[] } {
  const rest: string[] = [];
  const bool: Record<string, boolean> = {};
  const raw: RawFlags = {};
  let timeoutMs: number | undefined;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--") && a.length > 2) {
      const eq = a.indexOf("=");
      const name = eq >= 0 ? a.slice(2, eq) : a.slice(2);
      const inline = eq >= 0 ? a.slice(eq + 1) : undefined;
      if (GLOBAL_BOOL.includes(name)) {
        bool[name] = true;
        continue;
      }
      if (GLOBAL_VALUE.includes(name)) {
        const v = inline !== undefined ? inline : argv[++i];
        if (v === undefined) break;
        if (name === "url") raw.url = v;
        else if (name === "api-key-file") raw["api-key-file"] = v;
        else if (name === "timeout") timeoutMs = Number(v);
        continue;
      }
    }
    rest.push(a);
  }

  if (bool.insecure) raw.insecure = true;
  const human = bool.human ? true : !bool.json && isTTY;
  const global: GlobalFlags = {
    json: !!bool.json,
    human,
    quiet: !!bool.quiet,
    raw: !!bool.raw,
    dataOnly: !!bool["data-only"],
    dryRun: !!bool["dry-run"],
    yes: !!bool.yes,
    insecure: !!bool.insecure,
    strict: !!bool.strict,
    version: !!bool.version,
    help: !!bool.help,
    timeoutMs,
  };
  return { global, rawFlags: raw, rest };
}

function ok(data: unknown, global: GlobalFlags): RenderResult {
  return renderSuccess({ data }, global);
}

const version = (pkg as { version: string }).version;

export async function run(argv: string[], deps: RunDeps = {}): Promise<RenderResult> {
  const isTTY = deps.isTTY ?? process.stdout.isTTY === true;
  const { global, rawFlags, rest } = extractGlobals(argv, isTTY);

  if (global.version) {
    return ok({ name: "seerr", version }, global);
  }
  if (rest.length === 0 || global.help) {
    return ok(
      {
        name: "seerr",
        version,
        summary: "Unofficial agent-optimized CLI for Seerr.",
        commands: registry.map((c) => ({ name: c.name, summary: c.summary })),
        hint: "Run `seerr describe` for the full machine-readable manifest.",
      },
      global,
    );
  }

  const match = matchCommand(rest);
  if (!match) {
    return renderError(
      new SeerrError("usage", `Unknown command: ${rest.join(" ")}`, {
        hint: "Run `seerr --help` or `seerr describe`.",
      }),
      global,
    );
  }
  const { command, rest: cmdArgv } = match;

  if (cmdArgv.includes("--help") || cmdArgv.includes("-h")) {
    return ok(
      {
        name: command.name,
        summary: command.summary,
        args: command.args ?? [],
        flags: command.flags ?? {},
        examples: command.examples ?? [],
        output: command.output,
      },
      global,
    );
  }

  // Interactive, human-only commands (`init`) run a prompt flow that writes to the
  // terminal directly. Refuse without a TTY so an agent never hangs on a prompt.
  if (command.interactive) {
    const tty = deps.isTTY ?? (process.stdin.isTTY === true && process.stdout.isTTY === true);
    if (!tty) {
      return renderError(
        new SeerrError("usage", "`seerr init` is interactive; run it in a terminal.", {
          hint: "For non-interactive setup, create ~/.config/seerr/config or set SEERR_URL and SEERR_API_KEY.",
        }),
        global,
      );
    }
    const code = await runInit(defaultInitIO(), {
      env: deps.env,
      fetchImpl: deps.fetchImpl,
      force: cmdArgv.includes("--force"),
    });
    return { exitCode: code, stdout: "", stderr: "" };
  }

  let secret = "";
  try {
    const input = parse(command, cmdArgv);

    // Commands like `describe` need no Seerr connection — skip config/key
    // resolution so an agent can self-discover before anything is configured.
    if (command.requiresClient === false) {
      const offlineCtx = {
        client: undefined as unknown as SeerrClient,
        config: { baseUrl: "", apiKey: "", hasApiKey: false, configFilePath: "" },
        global,
      };
      const result = await command.handler(offlineCtx, input);
      return renderSuccess(result, global);
    }

    const config = resolveConfig(rawFlags, deps);
    secret = config.apiKey;
    if (command.requiresAuth !== false && !config.hasApiKey) {
      throw new SeerrError("auth", "No API key configured", {
        hint: `Add SEERR_API_KEY to ${config.configFilePath} (chmod 600) or set the SEERR_API_KEY env var. The key is never accepted on the command line.`,
      });
    }
    const client = new SeerrClient({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      fetchImpl: deps.fetchImpl,
      timeoutMs: global.timeoutMs,
    });
    const result = await command.handler({ client, config, global }, input);
    const r = renderSuccess(result, global);
    return { exitCode: r.exitCode, stdout: redact(r.stdout, secret), stderr: redact(r.stderr, secret) };
  } catch (err) {
    const r = renderError(err, global);
    return { exitCode: r.exitCode, stdout: redact(r.stdout, secret), stderr: redact(r.stderr, secret) };
  }
}
