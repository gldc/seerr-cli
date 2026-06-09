import { test, expect } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit, type InitIO } from "../src/commands/init";

function scriptedIO(answers: string[], log: string[]): InitIO {
  let i = 0;
  return {
    isTTY: false,
    print: (m) => {
      log.push(m);
    },
    question: async () => answers[i++] ?? "",
  };
}

function jsonResponse(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("init writes a chmod-600 config and validates the key", async () => {
  const dir = mkdtempSync(join(tmpdir(), "seerr-init-"));
  const env = { XDG_CONFIG_HOME: dir };
  const log: string[] = [];
  const io = scriptedIO(["https://seerr.example.com", "secretkey123"], log);
  const fetchImpl = (async (url: string) => {
    if (url.endsWith("/auth/me")) return jsonResponse({ displayName: "Gianluca" });
    if (url.endsWith("/status")) return jsonResponse({ version: "3.3.0" });
    return jsonResponse({}, 404);
  }) as unknown as typeof fetch;

  const code = await runInit(io, { env, fetchImpl });
  expect(code).toBe(0);

  const path = join(dir, "seerr", "config");
  expect(existsSync(path)).toBe(true);
  const content = readFileSync(path, "utf8");
  expect(content).toContain("SEERR_URL=https://seerr.example.com");
  expect(content).toContain("SEERR_API_KEY=secretkey123");
  expect(statSync(path).mode & 0o777).toBe(0o600);

  const out = log.join("");
  expect(out).toContain("ready");
  expect(out).toContain("3.3.0");
  expect(out).toContain("Gianluca");
});

test("init normalizes a scheme-less URL", async () => {
  const dir = mkdtempSync(join(tmpdir(), "seerr-init-"));
  const log: string[] = [];
  const io = scriptedIO(["seerr.example.com", "k1234567"], log);
  const fetchImpl = (async (url: string) =>
    url.endsWith("/auth/me")
      ? jsonResponse({ email: "a@b.c" })
      : jsonResponse({ version: "3.3.0" })) as unknown as typeof fetch;

  const code = await runInit(io, { env: { XDG_CONFIG_HOME: dir }, fetchImpl });
  expect(code).toBe(0);
  const content = readFileSync(join(dir, "seerr", "config"), "utf8");
  expect(content).toContain("SEERR_URL=https://seerr.example.com");
});

test("init reports a rejected API key (exit 3)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "seerr-init-"));
  const log: string[] = [];
  const io = scriptedIO(["https://seerr.example.com", "badkey9999"], log);
  const fetchImpl = (async (url: string) =>
    url.endsWith("/auth/me")
      ? jsonResponse({ message: "Unauthorized" }, 401)
      : jsonResponse({ version: "3.3.0" })) as unknown as typeof fetch;

  const code = await runInit(io, { env: { XDG_CONFIG_HOME: dir }, fetchImpl });
  expect(code).toBe(3);
  expect(log.join("")).toContain("rejected");
});

test("init rejects an empty URL after retries (exit 2)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "seerr-init-"));
  const log: string[] = [];
  const io = scriptedIO(["", "", ""], log);
  const code = await runInit(io, { env: { XDG_CONFIG_HOME: dir } });
  expect(code).toBe(2);
});
