// `describe` — emits a machine-readable manifest of every command so an agent can
// self-discover the CLI surface (commands, args, flags, enums, exit codes) in one call.

import pkg from "../../package.json";
import type { CommandSpec } from "../cli/contract";
import { MEDIA_STATUS, REQUEST_STATUS } from "../types";

export const describeCommand: CommandSpec = {
  name: "describe",
  summary: "Emit a machine-readable manifest of all commands for agent self-discovery.",
  requiresAuth: false,
  requiresClient: false,
  examples: ["seerr describe"],
  async handler() {
    // Dynamic import to avoid a circular import (registry -> this file -> registry).
    const { registry } = await import("../cli/registry");
    return { data: buildManifest(registry) };
  },
};

/** Build the self-describing manifest object from the command registry. */
export function buildManifest(registry: CommandSpec[]) {
  return {
    name: "seerr",
    version: (pkg as { version: string }).version,
    unofficial: true,
    usage:
      "Humans set up auth once with the interactive `seerr init`. Auth is configured out-of-band (a " +
      "config file or the SEERR_API_KEY env var); an API key is " +
      "NEVER passed on the command line. Output is JSON {ok,data,meta} on success and {ok,error} on " +
      "failure. To request something by title: (1) `seerr search` the title, (2) take `tmdbId` from a " +
      "result, (3) `seerr request create --media-type movie|tv --media-id <tmdbId>`. Availability is " +
      "the `mediaStatus` field on search/movie/tv results.",
    output: {
      success: "{ ok:true, data, meta? }",
      error: "{ ok:false, error:{ code, message, httpStatus, retryable, hint } }",
      flags:
        "--json forces machine output; --data-only drops the envelope; --raw returns untrimmed API " +
        "JSON; --human pretty-prints; destructive verbs need --yes; --dry-run plans without mutating.",
    },
    commands: registry.map((c) => ({
      name: c.name,
      summary: c.summary,
      args: (c.args ?? []).map((a) => ({
        name: a.name,
        type: a.type,
        required: !!a.required,
        description: a.description,
      })),
      flags: Object.entries(c.flags ?? {}).map(([n, f]) => ({
        name: n,
        type: f.type,
        required: !!f.required,
        default: f.default,
        values: f.values,
        description: f.description,
      })),
      destructive: !!c.destructive,
      requiresAuth: c.requiresAuth !== false,
      output: c.output,
      examples: c.examples ?? [],
    })),
    enums: { requestStatus: REQUEST_STATUS, mediaStatus: MEDIA_STATUS },
    exitCodes: {
      "0": "success",
      "1": "other",
      "2": "usage/validation",
      "3": "auth/config/permission",
      "4": "not found",
      "5": "upstream/network/timeout",
    },
  };
}
