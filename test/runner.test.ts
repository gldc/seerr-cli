import { test, expect } from "bun:test";
import { run } from "../src/cli/runner";
import type { RunDeps } from "../src/cli/runner";

// JSON Response helper for the injected fetch stub.
function jsonResponse(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const ENV: Record<string, string | undefined> = {
  SEERR_URL: "http://localhost:5055",
  SEERR_API_KEY: "testkey987",
};

// Base deps with a default no-op stub. Individual tests override fetchImpl/env.
function deps(
  stub: (url: string, init: any) => Promise<Response>,
  env: Record<string, string | undefined> = ENV,
): RunDeps {
  return {
    env,
    readFile: () => null,
    statMode: () => null,
    isTTY: false,
    fetchImpl: stub as unknown as typeof fetch,
  };
}

test("--version returns exit 0 with a version string", async () => {
  const stub = async () => jsonResponse({});
  const res = await run(["--version"], deps(stub));
  expect(res.exitCode).toBe(0);
  expect(typeof JSON.parse(res.stdout).data.version).toBe("string");
});

test("status returns the server version", async () => {
  const stub = async () => jsonResponse({ version: "3.3.0" });
  const res = await run(["status"], deps(stub));
  expect(res.exitCode).toBe(0);
  const out = JSON.parse(res.stdout);
  expect(out.ok).toBe(true);
  expect(out.data.version).toBe("3.3.0");
});

test("search trims results to tmdbId", async () => {
  const stub = async () =>
    jsonResponse({
      page: 1,
      totalPages: 1,
      totalResults: 1,
      results: [{ id: 438631, mediaType: "movie", title: "Dune", releaseDate: "2021-10-22" }],
    });
  const res = await run(["search", "dune"], deps(stub));
  expect(res.exitCode).toBe(0);
  const out = JSON.parse(res.stdout);
  expect(out.data[0].tmdbId).toBe(438631);
});

test("request approve without --yes is rejected as a usage error (exit 2)", async () => {
  const stub = async () => jsonResponse({});
  const res = await run(["request", "approve", "5"], deps(stub));
  expect(res.exitCode).toBe(2);
});

test("missing API key fails fast with an auth error (exit 3)", async () => {
  const stub = async () => jsonResponse({});
  const res = await run(["search", "x"], deps(stub, { SEERR_URL: "http://localhost:5055" }));
  expect(res.exitCode).toBe(3);
});

test("the resolved API key is never present in stdout", async () => {
  const stub = async () => jsonResponse({ version: "3.3.0" });
  const res = await run(["status"], deps(stub));
  expect(res.stdout.includes("testkey987")).toBe(false);
});

test("describe works with no URL/key configured (agent self-discovery)", async () => {
  const stub = async () => {
    throw new Error("describe must not touch the network");
  };
  const res = await run(["describe"], deps(stub, {}));
  expect(res.exitCode).toBe(0);
  const out = JSON.parse(res.stdout);
  expect(out.ok).toBe(true);
  expect(Array.isArray(out.data.commands)).toBe(true);
  expect(out.data.commands.some((c: { name: string }) => c.name === "request create")).toBe(true);
});
