import type { CommandSpec } from "../cli/contract";
import { trimSearchResults } from "./_trim";

// Browse a discovery feed (trending, popular movies, or popular tv). Same envelope
// and trimmed result shape as search.
export const discoverCommand: CommandSpec = {
  name: "discover",
  summary: "Browse trending or popular movies and tv.",
  flags: {
    type: {
      type: "enum",
      values: ["trending", "movies", "tv"],
      default: "trending",
      description: "Which discovery feed (default trending).",
    },
    page: {
      type: "int",
      default: 1,
      description: "Page number.",
    },
  },
  output: "results:[{ tmdbId, mediaType, title|name, year?, mediaStatus?, overview?, knownFor? }]",
  examples: ["seerr discover --type movies"],
  async handler(ctx, input) {
    const kind = (input.str("type") ?? "trending") as "trending" | "movies" | "tv";
    const page = input.int("page") ?? 1;
    const res = await ctx.client.discover(kind, { page });
    const results = trimSearchResults(res?.results ?? []);
    return {
      data: results,
      meta: {
        page: res?.page,
        totalPages: res?.totalPages,
        totalResults: res?.totalResults,
        count: results.length,
      },
    };
  },
};
