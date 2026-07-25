import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { SeerrError } from "./client/seerr";

export interface ResolvedConfig {
  baseUrl: string;
  /** Resolved API key. May be "" when unset. NEVER printed — redacted at the output boundary. */
  apiKey: string;
  hasApiKey: boolean;
  configFilePath: string;
}

export interface RawFlags {
  url?: string;
  /** Path to a file containing the API key. The key VALUE is never accepted as a flag. */
  "api-key-file"?: string;
  insecure?: boolean;
}

export interface ResolveDeps {
  env?: Record<string, string | undefined>;
  /** Read a file's text, or null if it does not exist. Injectable for tests. */
  readFile?: (path: string) => string | null;
  /** Return a file's mode bits, or null if missing. Injectable for tests. */
  statMode?: (path: string) => number | null;
  warn?: (msg: string) => void;
}

const RFC1918 =
  /^(10\.|127\.|0\.0\.0\.0|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/;

export function isPrivateHost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".local")) return true;
  if (h === "::1" || h === "0:0:0:0:0:0:0:1") return true;
  return RFC1918.test(h);
}

/**
 * Normalize and security-check a base URL. Rejects credential-in-URL confusion,
 * non-http(s) schemes, and plaintext http to public hosts (which would leak the key).
 * Preserves any sub-path (for reverse proxies mounted under e.g. /seerr).
 */
export function normalizeBaseUrl(raw: string, opts: { insecure?: boolean } = {}): string {
  let s = raw.trim();
  if (!s) throw new SeerrError("config", "SEERR_URL is empty");
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(s)) s = "https://" + s;

  let url: URL;
  try {
    url = new URL(s);
  } catch {
    throw new SeerrError("config", `Invalid Seerr URL: ${raw}`, {
      hint: "Use a full URL like https://seerr.example.com",
    });
  }

  if (url.username || url.password) {
    throw new SeerrError("config", "Seerr URL must not contain credentials (user:pass@host)", {
      hint: "Put the API key in the config file, never in the URL.",
    });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SeerrError("config", `Unsupported URL scheme '${url.protocol}'`, {
      hint: "Use http:// or https://",
    });
  }
  if (url.protocol === "http:" && !isPrivateHost(url.hostname) && !opts.insecure) {
    throw new SeerrError(
      "config",
      `Refusing to send the API key over plaintext http to a public host (${url.hostname})`,
      { hint: "Use https://, or pass --insecure for a trusted private network." },
    );
  }

  return (url.origin + url.pathname).replace(/\/+$/, "");
}

export function buildApiUrl(
  baseUrl: string,
  path: string,
  query?: Record<string, string | number | boolean | undefined>,
): string {
  const p = path.startsWith("/") ? path : "/" + path;
  let u = `${baseUrl}/api/v1${p}`;
  if (query) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
    }
    // URLSearchParams serializes with form encoding, where a space becomes '+'.
    // Seerr validates that parameters are percent-encoded and rejects that with
    // 400 "Parameter 'query' must be url encoded", so every multi-word search
    // failed. Only separator '+' is rewritten — a literal '+' inside a value was
    // already escaped to %2B by URLSearchParams, so it is unaffected.
    const s = qs.toString().replace(/\+/g, "%20");
    if (s) u += "?" + s;
  }
  return u;
}

export function configFilePath(env: Record<string, string | undefined>): string {
  const base = env.XDG_CONFIG_HOME || join(env.HOME || homedir(), ".config");
  return join(base, "seerr", "config");
}

function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

function defaultReadFile(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function defaultStatMode(path: string): number | null {
  try {
    return statSync(path).mode;
  } catch {
    return null;
  }
}

/**
 * Resolve config from (in precedence order):
 *   URL:      --url flag -> SEERR_URL env -> config file
 *   API key:  --api-key-file <path> -> SEERR_API_KEY env -> config file
 * The key value is intentionally NOT accepted as a flag.
 */
export function resolveConfig(flags: RawFlags, deps: ResolveDeps = {}): ResolvedConfig {
  const env = deps.env ?? (process.env as Record<string, string | undefined>);
  const readFile = deps.readFile ?? defaultReadFile;
  const statMode = deps.statMode ?? defaultStatMode;
  const warn = deps.warn ?? ((m: string) => process.stderr.write(m + "\n"));

  const cfgPath = configFilePath(env);
  const fileText = readFile(cfgPath);
  const fileCfg = fileText ? parseEnvFile(fileText) : {};

  if (fileText) {
    const mode = statMode(cfgPath);
    if (mode != null && (mode & 0o077) !== 0) {
      warn(`warning: ${cfgPath} is group/world-readable; run: chmod 600 ${cfgPath}`);
    }
  }

  const url = flags.url ?? env.SEERR_URL ?? fileCfg.SEERR_URL;
  if (!url) {
    throw new SeerrError("config", "No Seerr URL configured", {
      hint: `Set SEERR_URL (env), add 'SEERR_URL=' to ${cfgPath}, or pass --url. Example: http://localhost:5055`,
    });
  }
  const baseUrl = normalizeBaseUrl(url, { insecure: flags.insecure });

  let apiKey = "";
  if (flags["api-key-file"]) {
    const kt = readFile(flags["api-key-file"]);
    if (kt == null) {
      throw new SeerrError("config", `--api-key-file not found: ${flags["api-key-file"]}`);
    }
    apiKey = kt.trim();
  } else if (env.SEERR_API_KEY) {
    apiKey = env.SEERR_API_KEY.trim();
  } else if (fileCfg.SEERR_API_KEY) {
    apiKey = fileCfg.SEERR_API_KEY.trim();
  }

  return { baseUrl, apiKey, hasApiKey: apiKey.length > 0, configFilePath: cfgPath };
}
