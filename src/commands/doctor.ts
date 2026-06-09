import type { CommandSpec } from "../cli/contract";

// Connectivity + auth preflight. Probes the no-auth status endpoint first, then
// validates the API key via `me`. The key is NEVER echoed: apiKey is reported only
// as "set" or "unset".
export const doctorCommand: CommandSpec = {
  name: "doctor",
  summary: "Check connectivity and validate the API key without printing it.",
  requiresAuth: false,
  examples: ["seerr doctor"],
  output:
    "{ url, apiKey:'set'|'unset', connectivity:'ok'|'failed', version?, " +
    "auth?:'ok'|'invalid'|'skipped', user?, error?, authError? }.",
  async handler(ctx) {
    const out: any = {
      url: ctx.config.baseUrl,
      apiKey: ctx.config.hasApiKey ? "set" : "unset",
    };

    try {
      const s = await ctx.client.status();
      out.connectivity = "ok";
      out.version = s?.version;
    } catch (e: any) {
      out.connectivity = "failed";
      out.error = e?.message;
      return { data: out };
    }

    if (!ctx.config.hasApiKey) {
      out.auth = "skipped";
      return { data: out };
    }

    try {
      const me = await ctx.client.me();
      out.auth = "ok";
      out.user = me?.displayName ?? me?.email ?? me?.id;
    } catch (e: any) {
      out.auth = "invalid";
      out.authError = e?.message;
    }

    return { data: out };
  },
};
