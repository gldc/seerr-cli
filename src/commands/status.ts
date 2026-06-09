import type { CommandSpec } from "../cli/contract";

// Server status plus a request-count dashboard. The status endpoint needs no auth;
// the request-count rollup is fetched only when an API key is present, and any
// failure there is swallowed so `status` still works for unauthenticated callers.
export const statusCommand: CommandSpec = {
  name: "status",
  summary: "Show Seerr server version/update status and a request-count dashboard.",
  requiresAuth: false,
  examples: ["seerr status"],
  output:
    "{ version, commitTag, updateAvailable, commitsBehind, restartRequired, requests } " +
    "where requests is { total, movie, tv, pending, approved, declined, processing, available, completed } or null.",
  async handler(ctx) {
    const s = await ctx.client.status();
    let requests = null;
    if (ctx.config.hasApiKey) {
      try {
        requests = await ctx.client.requestCount();
      } catch {
        requests = null;
      }
    }
    return {
      data: {
        version: s?.version,
        commitTag: s?.commitTag,
        updateAvailable: s?.updateAvailable,
        commitsBehind: s?.commitsBehind,
        restartRequired: s?.restartRequired,
        requests,
      },
    };
  },
};
