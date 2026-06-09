import { SeerrError } from "../client/seerr";
import type { GlobalFlags, HandlerResult } from "../types";

export interface RenderResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Scrub the resolved API key (and any apiKey=/x-api-key that slipped through) from
 * any text headed to stdout/stderr. Scoped to the exact secret — never blanket hex,
 * so legitimate values like commit hashes are left intact.
 */
export function redact(text: string, secret?: string): string {
  let out = text;
  if (secret && secret.length >= 4) out = out.split(secret).join("***");
  out = out.replace(/((?:[?&])api[_-]?key=)[^&\s"']+/gi, "$1***");
  out = out.replace(/("?x-api-key"?\s*[:=]\s*"?)[^"\s,}]+/gi, "$1***");
  return out;
}

export function exitCodeForError(err: SeerrError): number {
  switch (err.code) {
    case "auth":
    case "forbidden":
    case "config":
      return 3;
    case "not_found":
      return 4;
    case "validation":
    case "usage":
      return 2;
    case "upstream":
    case "network":
    case "timeout":
      return 5;
    default:
      return 1;
  }
}

function stringify(value: unknown, human: boolean): string {
  return JSON.stringify(value, null, human ? 2 : 0);
}

export function renderSuccess(result: HandlerResult, global: GlobalFlags): RenderResult {
  let payload: unknown;
  if (global.raw || global.dataOnly) {
    payload = result.data;
  } else {
    payload = result.meta
      ? { ok: true, data: result.data, meta: result.meta }
      : { ok: true, data: result.data };
  }
  return { exitCode: 0, stdout: stringify(payload, global.human) + "\n", stderr: "" };
}

export function renderError(err: unknown, global: GlobalFlags): RenderResult {
  const e =
    err instanceof SeerrError
      ? err
      : new SeerrError("other", err instanceof Error ? err.message : String(err));
  const error: Record<string, unknown> = { code: e.code, message: e.message };
  if (e.httpStatus !== undefined) error.httpStatus = e.httpStatus;
  error.retryable = e.retryable;
  if (e.hint) error.hint = e.hint;
  return {
    exitCode: exitCodeForError(e),
    stdout: "",
    stderr: stringify({ ok: false, error }, global.human) + "\n",
  };
}
