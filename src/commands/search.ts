import type { CommandSpec } from "../cli/contract";
import { trimSearchResults } from "./_trim";

// Multi-search across movies, tv, and people. The Seerr API has no server-side type
// param, so --type filters the trimmed results client-side.
export const searchCommand: CommandSpec = {
  name: "search",
  summary: "Search movies, tv, and people by text query.",
  args: [
    { name: "query", type: "string", required: true, description: "Search text, e.g. dune" },
  ],
  flags: {
    type: {
      type: "enum",
      values: ["movie", "tv", "person"],
      description: "Client-side filter on result mediaType (the API has no type param).",
    },
    page: {
      type: "int",
      default: 1,
      description: "Page number (default 1).",
    },
  },
  output: "results:[{ tmdbId, mediaType, title|name, year?, mediaStatus?, overview?, knownFor? }]",
  examples: ['seerr search "the bear" --type tv'],
  async handler(ctx, input) {
    const query = input.reqStr("query");
    const page = input.int("page") ?? 1;
    const res = await ctx.client.search(query, page);
    let results = trimSearchResults(res?.results ?? []);
    const type = input.str("type");
    if (type) results = results.filter((r: any) => r.mediaType === type);
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
