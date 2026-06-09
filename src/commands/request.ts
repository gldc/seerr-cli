import type { CommandContext, CommandSpec } from "../cli/contract";
import { SeerrError } from "../client/seerr";
import type { RequestCreateBody } from "../client/seerr";
import { trimRequest } from "./_trim";

// Destructive verbs never prompt interactively — they require an explicit --yes.
function requireConfirm(ctx: CommandContext, action: string) {
  if (!ctx.global.yes)
    throw new SeerrError("usage", "Refusing to " + action + " without confirmation", {
      hint: "Pass --yes to confirm (no interactive prompt in agent/non-TTY use).",
    });
}

// On a 409 (already requested), look up the existing request via the media detail so
// `request create` stays idempotent and returns the prior request instead of failing.
async function findExisting(ctx: CommandContext, mediaType: "movie" | "tv", tmdbId: number) {
  try {
    const detail = mediaType === "movie" ? await ctx.client.movie(tmdbId) : await ctx.client.tv(tmdbId);
    const reqs = detail?.mediaInfo?.requests;
    if (Array.isArray(reqs) && reqs.length) {
      return { ...reqs[0], media: { mediaType, tmdbId, status: detail?.mediaInfo?.status } };
    }
  } catch {
    /* ignore */
  }
  return null;
}

export const requestCreateCommand: CommandSpec = {
  name: "request create",
  summary:
    "Create a media request (idempotent: returns the existing request if one already exists).",
  output: "The created (or pre-existing) request, trimmed: id, status, mediaType, tmdbId, is4k, seasons.",
  flags: {
    "media-type": {
      type: "enum",
      values: ["movie", "tv"],
      required: true,
      description: "movie or tv.",
    },
    "media-id": { type: "int", required: true, description: "TMDB id (from seerr search)." },
    seasons: { type: "string", description: "TV only: all or a comma list like 1,2,3 (default all)." },
    is4k: { type: "boolean", description: "Request the 4K version." },
    "tvdb-id": { type: "int", description: "TV only: force a TVDB mapping." },
    "server-id": { type: "int", description: "Target Sonarr/Radarr server id." },
    "profile-id": { type: "int", description: "Quality profile id." },
    "root-folder": { type: "string", description: "Root folder path." },
    "language-profile-id": { type: "int", description: "Language profile id (Sonarr)." },
    user: { type: "int", description: "Request on behalf of this user id." },
  },
  examples: [
    "seerr request create --media-type movie --media-id 603",
    "seerr request create --media-type tv --media-id 1399 --seasons all",
  ],
  async handler(ctx, input) {
    const mediaType = input.str("media-type") as "movie" | "tv";
    const mediaId = input.int("media-id")!;
    const body: RequestCreateBody = { mediaType, mediaId };
    if (mediaType === "tv") {
      body.seasons = input.seasons("seasons") ?? "all";
      const tvdb = input.int("tvdb-id");
      if (tvdb !== undefined) body.tvdbId = tvdb;
    } else if (input.get("seasons") !== undefined) {
      throw new SeerrError("usage", "--seasons only applies to --media-type tv");
    }
    if (input.bool("is4k")) body.is4k = true;
    const sid = input.int("server-id");
    if (sid !== undefined) body.serverId = sid;
    const pid = input.int("profile-id");
    if (pid !== undefined) body.profileId = pid;
    const rf = input.str("root-folder");
    if (rf) body.rootFolder = rf;
    const lp = input.int("language-profile-id");
    if (lp !== undefined) body.languageProfileId = lp;
    const uid = input.int("user");
    if (uid !== undefined) body.userId = uid;

    try {
      const res = await ctx.client.createRequest(body);
      const meta: Record<string, unknown> = {};
      if (res.status === 202) {
        meta.partial = true;
        meta.reason = "no_seasons_available";
      }
      return { data: trimRequest(res.data), meta: Object.keys(meta).length ? meta : undefined };
    } catch (err) {
      if (err instanceof SeerrError && err.code === "already_requested" && !ctx.global.strict) {
        const existing = await findExisting(ctx, mediaType, mediaId);
        if (existing) return { data: trimRequest(existing), meta: { alreadyExisted: true } };
      }
      throw err;
    }
  },
};

export const requestListCommand: CommandSpec = {
  name: "request list",
  summary: "List media requests with status / media-type / sorting filters and pagination.",
  output: "An array of trimmed requests, plus meta with page, pages, results, take, skip, count.",
  flags: {
    filter: {
      type: "enum",
      values: [
        "all",
        "approved",
        "available",
        "pending",
        "processing",
        "unavailable",
        "failed",
        "deleted",
        "completed",
      ],
      default: "all",
      description: "Filter by status.",
    },
    "media-type": {
      type: "enum",
      values: ["movie", "tv", "all"],
      default: "all",
      description: "Filter by media type.",
    },
    sort: { type: "enum", values: ["added", "modified"], default: "added", description: "Sort field." },
    "sort-direction": {
      type: "enum",
      values: ["asc", "desc"],
      default: "desc",
      description: "Sort direction.",
    },
    take: { type: "int", default: 20, description: "Page size." },
    skip: { type: "int", default: 0, description: "Offset." },
    "requested-by": { type: "int", description: "Filter by requesting user id." },
  },
  examples: ["seerr request list --filter pending"],
  async handler(ctx, input) {
    const query: any = {
      filter: input.str("filter"),
      take: input.int("take") ?? 20,
      skip: input.int("skip") ?? 0,
      sort: input.str("sort"),
      sortDirection: input.str("sort-direction"),
    };
    const mt = input.str("media-type");
    if (mt && mt !== "all") query.mediaType = mt;
    const rb = input.int("requested-by");
    if (rb !== undefined) query.requestedBy = rb;
    const res = await ctx.client.listRequests(query);
    const items = (res?.results ?? []).map(trimRequest);
    const pi = res?.pageInfo ?? {};
    return {
      data: items,
      meta: {
        page: pi.page,
        pages: pi.pages,
        results: pi.results,
        take: query.take,
        skip: query.skip,
        count: items.length,
      },
    };
  },
};

export const requestGetCommand: CommandSpec = {
  name: "request get",
  summary: "Fetch a single request by its request id (not the tmdbId).",
  output: "One trimmed request: id, status, mediaType, tmdbId, is4k, requestedBy, createdAt, seasons.",
  args: [{ name: "id", type: "int", required: true, description: "Request id (NOT the tmdbId)." }],
  examples: ["seerr request get 42"],
  async handler(ctx, input) {
    const id = input.int("id")!;
    return { data: trimRequest(await ctx.client.getRequest(id)) };
  },
};

export const requestApproveCommand: CommandSpec = {
  name: "request approve",
  summary: "Approve a pending request (destructive: requires --yes).",
  output: "The updated, trimmed request.",
  destructive: true,
  args: [{ name: "id", type: "int", required: true, description: "Request id." }],
  examples: ["seerr request approve 42 --yes"],
  async handler(ctx, input) {
    const id = input.int("id")!;
    requireConfirm(ctx, "approve request " + id);
    if (ctx.global.dryRun) return { data: { id, wouldRun: "approve" }, meta: { dryRun: true } };
    return { data: trimRequest(await ctx.client.setRequestStatus(id, "approve")) };
  },
};

export const requestDeclineCommand: CommandSpec = {
  name: "request decline",
  summary: "Decline a pending request (destructive: requires --yes).",
  output: "The updated, trimmed request.",
  destructive: true,
  args: [{ name: "id", type: "int", required: true, description: "Request id." }],
  examples: ["seerr request decline 42 --yes"],
  async handler(ctx, input) {
    const id = input.int("id")!;
    requireConfirm(ctx, "decline request " + id);
    if (ctx.global.dryRun) return { data: { id, wouldRun: "decline" }, meta: { dryRun: true } };
    return { data: trimRequest(await ctx.client.setRequestStatus(id, "decline")) };
  },
};

export const requestDeleteCommand: CommandSpec = {
  name: "request delete",
  summary: "Delete a request (destructive: requires --yes).",
  output: "{ deleted: <id> } on success.",
  destructive: true,
  args: [{ name: "id", type: "int", required: true, description: "Request id." }],
  examples: ["seerr request delete 42 --yes"],
  async handler(ctx, input) {
    const id = input.int("id")!;
    requireConfirm(ctx, "delete request " + id);
    if (ctx.global.dryRun) return { data: { id, wouldRun: "delete" }, meta: { dryRun: true } };
    await ctx.client.deleteRequest(id);
    return { data: { deleted: id } };
  },
};

export const requestRetryCommand: CommandSpec = {
  name: "request retry",
  summary: "Retry a failed request (re-sends it to the configured Sonarr/Radarr server).",
  output: "The trimmed request after the retry was triggered.",
  args: [{ name: "id", type: "int", required: true, description: "Request id." }],
  examples: ["seerr request retry 42"],
  async handler(ctx, input) {
    const id = input.int("id")!;
    return { data: trimRequest(await ctx.client.retryRequest(id)) };
  },
};
