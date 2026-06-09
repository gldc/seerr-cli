// `seerr init` — interactive, human-only setup. Prompts for the Seerr URL and API key,
// writes the config file (chmod 600), then validates the connection. The API key is read
// with echo suppressed and is never passed via argv, so it can't leak to shell history,
// process lists, or an agent transcript.

import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { CommandSpec } from "../cli/contract";
import { SeerrClient, SeerrError } from "../client/seerr";
import { configFilePath, normalizeBaseUrl } from "../config";

export interface InitIO {
  isTTY: boolean;
  print(msg: string): void;
  question(promptText: string, opts?: { hidden?: boolean }): Promise<string>;
}

export interface InitDeps {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  force?: boolean;
}

/** Run the interactive setup flow. Returns a process exit code. */
export async function runInit(io: InitIO, deps: InitDeps = {}): Promise<number> {
  const env = deps.env ?? (process.env as Record<string, string | undefined>);

  io.print("Configure seerr — set up your Seerr connection.\n\n");

  // 1) URL (validated; re-prompt up to 3 times)
  let baseUrl = "";
  for (let attempt = 0; attempt < 3 && !baseUrl; attempt++) {
    const raw = (await io.question("Seerr URL: ")).trim();
    if (!raw) {
      io.print("  A URL is required, e.g. http://localhost:5055\n");
      continue;
    }
    try {
      baseUrl = normalizeBaseUrl(raw);
    } catch (e) {
      io.print("  " + (e instanceof Error ? e.message : "Invalid URL") + "\n");
    }
  }
  if (!baseUrl) {
    io.print("Gave up after 3 attempts.\n");
    return 2;
  }

  // 2) API key (hidden input)
  const apiKey = (await io.question("Seerr API key: ", { hidden: true })).trim();
  if (!apiKey) {
    io.print("An API key is required (Seerr -> Settings -> General -> API Key).\n");
    return 2;
  }

  // 3) Write the config file (chmod 600)
  const path = configFilePath(env);
  if (existsSync(path) && !deps.force) {
    const ans = (await io.question("Config exists at " + path + ". Overwrite? [y/N] "))
      .trim()
      .toLowerCase();
    if (ans !== "y" && ans !== "yes") {
      io.print("Aborted; existing config left unchanged.\n");
      return 0;
    }
  }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, "SEERR_URL=" + baseUrl + "\nSEERR_API_KEY=" + apiKey + "\n", { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // best-effort on platforms without POSIX modes
  }
  io.print("\nSaved config to " + path + " (chmod 600).\n");

  // 4) Validate the connection
  const client = new SeerrClient({ baseUrl, apiKey, fetchImpl: deps.fetchImpl });
  let version = "";
  try {
    const status = await client.status();
    version = status?.version ?? "";
  } catch (e) {
    io.print(
      "\n! Saved config, but couldn't reach " +
        baseUrl +
        ": " +
        (e instanceof Error ? e.message : "unknown error") +
        "\n  Check the URL and that Seerr is running, then re-run `seerr init`.\n",
    );
    return 5;
  }

  let who = "";
  try {
    const me = await client.me();
    who = me?.displayName ?? me?.email ?? (me?.id != null ? "user " + me.id : "");
  } catch {
    io.print(
      "\n! Connected to Seerr " +
        (version || "(unknown version)") +
        ", but the API key was rejected.\n  Double-check it in Seerr -> Settings -> General -> API Key, then re-run `seerr init`.\n",
    );
    return 3;
  }

  io.print(
    "\n✓ Connected to Seerr " +
      (version || "(unknown version)") +
      (who ? " as " + who : "") +
      ". You're ready.\n" +
      '  Try: seerr search "dune"\n',
  );
  return 0;
}

/** Default terminal IO: prompts on stdout, hidden input via raw mode. */
export function defaultInitIO(): InitIO {
  const reader = createStdinReader();
  return {
    isTTY: process.stdin.isTTY === true,
    print: (m) => {
      process.stdout.write(m);
    },
    question: (promptText, opts) => reader.question(promptText, opts?.hidden ?? false),
  };
}

/**
 * One persistent line reader for the whole init session. A shared buffer means input
 * delivered in a single chunk (e.g. a paste of "url\nkey\n") is split correctly across
 * successive questions instead of being dropped. On a TTY it uses raw mode so it can
 * suppress echo for the hidden API-key prompt; otherwise it reads cooked lines.
 */
function createStdinReader(): { question(promptText: string, hidden: boolean): Promise<string> } {
  const input = process.stdin;
  const canRaw = input.isTTY === true && typeof (input as { setRawMode?: unknown }).setRawMode === "function";
  if (canRaw) (input as unknown as { setRawMode(v: boolean): void }).setRawMode(true);
  input.resume();
  input.setEncoding("utf8");

  const lines: string[] = [];
  let lineBuf = "";
  let sawCR = false;
  let pending: { resolve: (s: string) => void; hidden: boolean } | null = null;

  const drain = () => {
    while (pending && lines.length > 0) {
      const p = pending;
      pending = null;
      const line = lines.shift() as string;
      if (canRaw) process.stdout.write("\n");
      p.resolve(line);
    }
  };

  input.on("data", (chunk: string) => {
    for (const ch of chunk) {
      if (ch === "\r") {
        lines.push(lineBuf);
        lineBuf = "";
        sawCR = true;
        continue;
      }
      if (ch === "\n") {
        if (sawCR) {
          sawCR = false;
          continue; // swallow the \n of a \r\n pair
        }
        lines.push(lineBuf);
        lineBuf = "";
        continue;
      }
      sawCR = false;
      const code = ch.charCodeAt(0);
      if (code === 3) {
        // Ctrl-C
        if (canRaw) (input as unknown as { setRawMode(v: boolean): void }).setRawMode(false);
        process.stdout.write("\n");
        process.exit(130);
      }
      if (code === 127 || code === 8) {
        if (lineBuf.length > 0) {
          lineBuf = lineBuf.slice(0, -1);
          if (canRaw && pending && !pending.hidden) process.stdout.write("\b \b");
        }
        continue;
      }
      if (code < 32) continue;
      lineBuf += ch;
      if (canRaw && pending && !pending.hidden) process.stdout.write(ch); // echo only non-hidden
    }
    drain();
  });

  return {
    question(promptText: string, hidden: boolean): Promise<string> {
      process.stdout.write(promptText);
      return new Promise((resolve) => {
        pending = { resolve, hidden };
        drain();
      });
    },
  };
}

export const initCommand: CommandSpec = {
  name: "init",
  summary: "Interactively set up the config file (Seerr URL + API key) and validate the connection.",
  requiresAuth: false,
  requiresClient: false,
  interactive: true,
  flags: {
    force: { type: "boolean", description: "Overwrite an existing config without prompting." },
  },
  output: "Human-interactive: writes ~/.config/seerr/config (chmod 600) and prints a readiness message.",
  examples: ["seerr init"],
  async handler() {
    // The runner intercepts interactive commands before this is reached.
    throw new SeerrError("usage", "`seerr init` is interactive and handled by the runner.");
  },
};
