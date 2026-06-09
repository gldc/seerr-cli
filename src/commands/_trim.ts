import { decodeMediaStatus, decodeRequestStatus } from "../types";

// Token-efficient projections of the verbose Seerr API responses. Each keeps only the
// fields an agent needs for the search -> request -> track loop. Use --raw to bypass.

export function yearOf(r: any): number | undefined {
  const d = r?.releaseDate || r?.firstAirDate;
  if (!d) return undefined;
  const y = Number(String(d).slice(0, 4));
  return Number.isFinite(y) ? y : undefined;
}

export function titleOf(r: any): string | undefined {
  return r?.title ?? r?.name;
}

/** Search/discover results are a mixed array of movie | tv | person. */
export function trimSearchResults(results: any[]): any[] {
  return (results ?? []).map((r) =>
    r?.mediaType === "person"
      ? {
          tmdbId: r.id,
          mediaType: "person",
          name: r.name,
          knownFor: (r.knownFor ?? [])
            .map((k: any) => titleOf(k))
            .filter(Boolean)
            .slice(0, 5),
        }
      : {
          tmdbId: r.id,
          mediaType: r.mediaType,
          title: titleOf(r),
          year: yearOf(r),
          mediaStatus: decodeMediaStatus(r?.mediaInfo?.status),
          overview: r.overview,
        },
  );
}

/** A MediaRequest. Note: tmdbId lives on the nested media object, status is numeric. */
export function trimRequest(req: any): any {
  return {
    id: req?.id,
    status: decodeRequestStatus(req?.status),
    mediaType: req?.media?.mediaType,
    tmdbId: req?.media?.tmdbId,
    mediaStatus: decodeMediaStatus(req?.media?.status),
    is4k: req?.is4k,
    requestedBy: req?.requestedBy?.displayName ?? req?.requestedBy?.email ?? req?.requestedBy?.id,
    createdAt: req?.createdAt,
    seasons: Array.isArray(req?.seasons) ? req.seasons.map((s: any) => s.seasonNumber) : undefined,
  };
}
