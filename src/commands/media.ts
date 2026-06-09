import type { CommandSpec } from "../cli/contract";
import { yearOf } from "./_trim";
import { decodeMediaStatus } from "../types";

// Detail lookups for a single movie or tv show by TMDB id. Both return a trimmed
// projection with the library availability decoded from mediaInfo.status.
export const movieCommand: CommandSpec = {
  name: "movie",
  summary: "Show details for a movie by TMDB id.",
  args: [
    { name: "tmdbId", type: "int", required: true, description: "TMDB movie id (from seerr search)." },
  ],
  output: "{ tmdbId, title, year?, mediaStatus?, overview, runtime, genres:[name] }",
  examples: ["seerr movie 603"],
  async handler(ctx, input) {
    const id = input.int("tmdbId")!;
    const m = await ctx.client.movie(id);
    return {
      data: {
        tmdbId: m?.id,
        title: m?.title,
        year: yearOf(m),
        mediaStatus: decodeMediaStatus(m?.mediaInfo?.status),
        overview: m?.overview,
        runtime: m?.runtime,
        genres: (m?.genres ?? []).map((g: any) => g.name),
      },
    };
  },
};

export const tvCommand: CommandSpec = {
  name: "tv",
  summary: "Show details for a tv show by TMDB id.",
  args: [
    { name: "tmdbId", type: "int", required: true, description: "TMDB tv id (from seerr search)." },
  ],
  output: "{ tmdbId, name, year?, mediaStatus?, overview, seasons:[{ seasonNumber, episodeCount }] }",
  examples: ["seerr tv 1399"],
  async handler(ctx, input) {
    const id = input.int("tmdbId")!;
    const t = await ctx.client.tv(id);
    return {
      data: {
        tmdbId: t?.id,
        name: t?.name,
        year: yearOf(t),
        mediaStatus: decodeMediaStatus(t?.mediaInfo?.status),
        overview: t?.overview,
        seasons: (t?.seasons ?? []).map((s: any) => ({
          seasonNumber: s.seasonNumber,
          episodeCount: s.episodeCount,
        })),
      },
    };
  },
};
