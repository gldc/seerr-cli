// Pure, dependency-free data: enums, decoders, and the declarative command-spec types.
// This module imports nothing from the rest of the app (it's a leaf).

export type MediaType = "movie" | "tv";

/** MediaRequest.status — the approval state of a request. */
export const REQUEST_STATUS: Record<number, string> = {
  1: "pending",
  2: "approved",
  3: "declined",
};

/** MediaInfo.status — the library availability of the underlying media. */
export const MEDIA_STATUS: Record<number, string> = {
  1: "unknown",
  2: "pending",
  3: "processing",
  4: "partially-available",
  5: "available",
  6: "deleted",
};

export function decodeRequestStatus(n: number | undefined | null): string | null {
  if (n == null) return null;
  return REQUEST_STATUS[n] ?? `status-${n}`;
}

export function decodeMediaStatus(n: number | undefined | null): string | null {
  if (n == null) return null;
  return MEDIA_STATUS[n] ?? `status-${n}`;
}

// ---- Declarative command registry types ----

export type FlagType = "string" | "boolean" | "int" | "enum";

export interface FlagSpec {
  type: FlagType;
  description: string;
  required?: boolean;
  default?: string | number | boolean;
  /** Allowed values for `type: "enum"`. */
  values?: readonly string[];
  short?: string;
}

export interface ArgSpec {
  name: string;
  type: "string" | "int";
  required?: boolean;
  variadic?: boolean;
  description: string;
}

export interface HandlerResult {
  data: unknown;
  meta?: Record<string, unknown>;
}

export interface GlobalFlags {
  json: boolean;
  human: boolean;
  quiet: boolean;
  raw: boolean;
  dataOnly: boolean;
  dryRun: boolean;
  yes: boolean;
  insecure: boolean;
  strict: boolean;
  version: boolean;
  help: boolean;
  timeoutMs?: number;
}
