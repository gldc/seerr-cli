import { test, expect } from "bun:test";
import { SeerrClient, SeerrError } from "../src/client/seerr";

// A JSON Response helper that mirrors what a real Seerr server returns.
function jsonResponse(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Build a client with an injected fetch stub and an instant sleep (so retries
// never actually delay the test run).
function makeClient(stub: (url: string, init: any) => Promise<Response>): SeerrClient {
  return new SeerrClient({
    baseUrl: "http://localhost:5055",
    apiKey: "k12345",
    fetchImpl: stub as unknown as typeof fetch,
    sleep: () => Promise.resolve(),
  });
}

test("status() is unauthenticated (no X-Api-Key header)", async () => {
  let sawApiKey = true;
  const stub = async (_url: string, init: any) => {
    // Header keys are case-insensitive in the client; check both spellings.
    const h = init?.headers ?? {};
    sawApiKey = "X-Api-Key" in h || "x-api-key" in h;
    return jsonResponse({ version: "3.3.0" });
  };
  const client = makeClient(stub);
  const result = await client.status();
  expect(sawApiKey).toBe(false);
  expect(result.version).toBe("3.3.0");
});

test("createRequest() POSTs the body with the API key header", async () => {
  let capturedBody: string | undefined;
  let capturedMethod: string | undefined;
  let capturedKey: string | undefined;
  const stub = async (_url: string, init: any) => {
    capturedBody = init?.body;
    capturedMethod = init?.method;
    capturedKey = (init?.headers ?? {})["X-Api-Key"];
    return jsonResponse({ id: 1, status: 2, media: { mediaType: "movie", tmdbId: 603, status: 3 } }, 201);
  };
  const client = makeClient(stub);
  const res = await client.createRequest({ mediaType: "movie", mediaId: 603 });
  expect(JSON.parse(capturedBody as string)).toEqual({ mediaType: "movie", mediaId: 603 });
  expect(capturedMethod).toBe("POST");
  expect(capturedKey).toBe("k12345");
  expect(res.status).toBe(201);
});

test("createRequest() maps 409 to a SeerrError with code already_requested", async () => {
  const stub = async () => jsonResponse({ message: "already" }, 409);
  const client = makeClient(stub);
  let caught: unknown;
  try {
    await client.createRequest({ mediaType: "movie", mediaId: 603 });
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(SeerrError);
  expect((caught as SeerrError).code).toBe("already_requested");
});

test("deleteRequest() returns the 204 status number", async () => {
  const stub = async () => new Response(null, { status: 204 });
  const client = makeClient(stub);
  const status = await client.deleteRequest(7);
  expect(status).toBe(204);
});

test("retries a retryable 429 on an idempotent GET, then succeeds", async () => {
  let calls = 0;
  const stub = async () => {
    calls++;
    if (calls === 1) return jsonResponse({ message: "rate limited" }, 429);
    return jsonResponse({}, 200);
  };
  const client = makeClient(stub);
  await client.status();
  expect(calls).toBe(2);
});
