import { buildApiUrl } from "../config";

export type ErrorCode =
  | "auth"
  | "forbidden"
  | "not_found"
  | "already_requested"
  | "quota_exceeded"
  | "rate_limited"
  | "validation"
  | "upstream"
  | "network"
  | "timeout"
  | "config"
  | "usage"
  | "other";

export interface SeerrErrorOpts {
  httpStatus?: number;
  retryable?: boolean;
  hint?: string;
  body?: unknown;
}

/** Typed error that NEVER carries the request object or headers (no API-key leakage). */
export class SeerrError extends Error {
  code: ErrorCode;
  httpStatus?: number;
  retryable: boolean;
  hint?: string;
  body?: unknown;

  constructor(code: ErrorCode, message: string, opts: SeerrErrorOpts = {}) {
    super(message);
    this.name = "SeerrError";
    this.code = code;
    this.httpStatus = opts.httpStatus;
    this.retryable = opts.retryable ?? false;
    this.hint = opts.hint;
    this.body = opts.body;
  }
}

function codeForStatus(status: number): { code: ErrorCode; retryable: boolean } {
  if (status === 401) return { code: "auth", retryable: false };
  if (status === 403) return { code: "forbidden", retryable: false };
  if (status === 404) return { code: "not_found", retryable: false };
  if (status === 409) return { code: "already_requested", retryable: false };
  if (status === 429) return { code: "rate_limited", retryable: true };
  if (status === 400 || status === 422) return { code: "validation", retryable: false };
  if (status >= 500) return { code: "upstream", retryable: true };
  return { code: "other", retryable: false };
}

function hintForCode(code: ErrorCode): string | undefined {
  switch (code) {
    case "auth":
      return "Check your API key (Seerr → Settings → General → API Key).";
    case "forbidden":
      return "The API key's user lacks permission for this action.";
    case "rate_limited":
      return "Seerr is rate-limiting; retry shortly.";
    default:
      return undefined;
  }
}

export interface ClientOptions {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface RequestCreateBody {
  mediaType: "movie" | "tv";
  mediaId: number;
  tvdbId?: number;
  seasons?: number[] | "all";
  is4k?: boolean;
  serverId?: number;
  profileId?: number;
  rootFolder?: string;
  languageProfileId?: number;
  userId?: number;
}

export interface RawResponse<T = any> {
  status: number;
  data: T;
}

export class SeerrClient {
  private baseUrl: string;
  private apiKey: string;
  private fetchImpl: typeof fetch;
  private timeoutMs: number;
  private maxRetries: number;
  private sleep: (ms: number) => Promise<void>;

  constructor(opts: ClientOptions) {
    this.baseUrl = opts.baseUrl;
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 15000;
    this.maxRetries = opts.maxRetries ?? 3;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  private async backoff(attempt: number, retryAfterMs?: number): Promise<void> {
    const base = retryAfterMs ?? Math.min(500 * 2 ** (attempt - 1), 8000);
    const jitter = Math.floor(base * 0.2 * Math.random());
    await this.sleep(base + jitter);
  }

  private async raw<T = any>(
    method: string,
    path: string,
    opts: { query?: Record<string, any>; body?: unknown; auth?: boolean } = {},
  ): Promise<RawResponse<T>> {
    const url = buildApiUrl(this.baseUrl, path, opts.query);
    const idempotent = method === "GET";
    let attempt = 0;

    while (true) {
      attempt++;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
      let res: Response;
      try {
        const headers: Record<string, string> = { Accept: "application/json" };
        if (opts.auth !== false && this.apiKey) headers["X-Api-Key"] = this.apiKey;
        if (opts.body !== undefined) headers["Content-Type"] = "application/json";
        res = await this.fetchImpl(url, {
          method,
          headers,
          body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
          signal: ctrl.signal,
        });
      } catch (err: any) {
        clearTimeout(timer);
        const aborted = err?.name === "AbortError";
        if (idempotent && attempt <= this.maxRetries) {
          await this.backoff(attempt);
          continue;
        }
        // Deliberately generic — never echo the request init / headers.
        if (aborted) {
          throw new SeerrError("timeout", `Request timed out after ${this.timeoutMs}ms`, {
            retryable: true,
          });
        }
        throw new SeerrError("network", "Network error contacting Seerr", { retryable: true });
      }
      clearTimeout(timer);

      if (res.ok) {
        if (res.status === 204) return { status: 204, data: undefined as T };
        const text = await res.text();
        let data: any = undefined;
        if (text) {
          try {
            data = JSON.parse(text);
          } catch {
            data = text;
          }
        }
        return { status: res.status, data };
      }

      const { code, retryable } = codeForStatus(res.status);
      if (retryable && idempotent && attempt <= this.maxRetries) {
        const ra = Number(res.headers.get("retry-after"));
        await this.backoff(attempt, Number.isFinite(ra) ? ra * 1000 : undefined);
        continue;
      }

      let body: unknown;
      try {
        const t = await res.text();
        if (t) {
          try {
            body = JSON.parse(t);
          } catch {
            body = t;
          }
        }
      } catch {
        // ignore body read errors
      }
      const apiMsg =
        body && typeof body === "object" && typeof (body as any).message === "string"
          ? (body as any).message
          : undefined;
      throw new SeerrError(code, apiMsg ? `Seerr API ${res.status}: ${apiMsg}` : `Seerr API ${res.status}`, {
        httpStatus: res.status,
        retryable,
        body,
        hint: hintForCode(code),
      });
    }
  }

  status(): Promise<any> {
    return this.raw("GET", "/status", { auth: false }).then((r) => r.data);
  }
  me(): Promise<any> {
    return this.raw("GET", "/auth/me").then((r) => r.data);
  }
  search(query: string, page = 1): Promise<any> {
    return this.raw("GET", "/search", { query: { query, page } }).then((r) => r.data);
  }
  movie(id: number): Promise<any> {
    return this.raw("GET", `/movie/${id}`).then((r) => r.data);
  }
  tv(id: number): Promise<any> {
    return this.raw("GET", `/tv/${id}`).then((r) => r.data);
  }
  discover(kind: "trending" | "movies" | "tv", query: Record<string, any> = {}): Promise<any> {
    return this.raw("GET", `/discover/${kind}`, { query }).then((r) => r.data);
  }
  /** Returns the raw response so callers can detect 202 (accepted, no seasons available). */
  createRequest(body: RequestCreateBody): Promise<RawResponse> {
    return this.raw("POST", "/request", { body });
  }
  listRequests(query: Record<string, any>): Promise<any> {
    return this.raw("GET", "/request", { query }).then((r) => r.data);
  }
  requestCount(): Promise<any> {
    return this.raw("GET", "/request/count").then((r) => r.data);
  }
  getRequest(id: string | number): Promise<any> {
    return this.raw("GET", `/request/${id}`).then((r) => r.data);
  }
  setRequestStatus(id: string | number, status: "approve" | "decline"): Promise<any> {
    return this.raw("POST", `/request/${id}/${status}`).then((r) => r.data);
  }
  deleteRequest(id: string | number): Promise<number> {
    return this.raw("DELETE", `/request/${id}`).then((r) => r.status);
  }
  retryRequest(id: string | number): Promise<any> {
    return this.raw("POST", `/request/${id}/retry`).then((r) => r.data);
  }
}
