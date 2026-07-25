import { test, expect, describe } from "bun:test";
import { normalizeBaseUrl, buildApiUrl, isPrivateHost, resolveConfig } from "../src/config";
import { SeerrError } from "../src/client/seerr";

describe("normalizeBaseUrl", () => {
  test("adds https scheme when missing", () => {
    expect(normalizeBaseUrl("requests.example.com")).toBe("https://requests.example.com");
  });

  test("preserves subpath and strips trailing slash", () => {
    expect(normalizeBaseUrl("https://h/seerr/")).toBe("https://h/seerr");
  });

  test("allows plaintext http to a private host", () => {
    expect(normalizeBaseUrl("http://192.168.1.21:5055")).toBe("http://192.168.1.21:5055");
  });

  test("blocks plaintext http to a public host", () => {
    expect(() => normalizeBaseUrl("http://evil.example.com")).toThrow();
  });

  test("rejects credentials embedded in the URL", () => {
    expect(() => normalizeBaseUrl("https://a:b@evil.com")).toThrow();
  });

  test("rejects unsupported schemes", () => {
    expect(() => normalizeBaseUrl("ftp://x")).toThrow();
  });
});

describe("buildApiUrl", () => {
  test("prefixes the /api/v1 path", () => {
    expect(buildApiUrl("https://h/seerr", "/status")).toBe("https://h/seerr/api/v1/status");
  });

  test("appends a query string from a query object", () => {
    const u = buildApiUrl("https://h/seerr", "/search", { query: "dune", page: 2 });
    expect(u.startsWith("https://h/seerr/api/v1/search?")).toBe(true);
    expect(u).toContain("query=dune");
    expect(u).toContain("page=2");
  });

  // Seerr validates that `query` is percent-encoded and rejects reserved
  // characters: URLSearchParams' form encoding (space -> '+') comes back as
  // 400 "Parameter 'query' must be url encoded", which broke EVERY multi-word
  // search.
  test("percent-encodes spaces rather than using form '+' encoding", () => {
    const u = buildApiUrl("https://h", "/search", { query: "Dune Part Two" });
    expect(u).toContain("query=Dune%20Part%20Two");
    expect(u).not.toContain("+");
  });

  test("percent-encodes reserved characters in a value", () => {
    const u = buildApiUrl("https://h", "/search", { query: "Dune: Part Two" });
    expect(u).toContain("query=Dune%3A%20Part%20Two");
  });

  test("a literal '+' in the value survives as %2B", () => {
    const u = buildApiUrl("https://h", "/search", { query: "C++ tutorial" });
    expect(u).toContain("query=C%2B%2B%20tutorial");
  });
});

describe("isPrivateHost", () => {
  test("localhost is private", () => {
    expect(isPrivateHost("localhost")).toBe(true);
  });

  test("RFC1918 10.x is private", () => {
    expect(isPrivateHost("10.0.0.4")).toBe(true);
  });

  test("a public DNS address is not private", () => {
    expect(isPrivateHost("8.8.8.8")).toBe(false);
  });
});

describe("resolveConfig", () => {
  test("reads url and key from env", () => {
    const cfg = resolveConfig(
      {},
      {
        env: { SEERR_URL: "http://localhost:5055", SEERR_API_KEY: "abc12345" },
        readFile: () => null,
        statMode: () => null,
      },
    );
    expect(cfg.baseUrl).toBe("http://localhost:5055");
    expect(cfg.hasApiKey).toBe(true);
    expect(cfg.apiKey).toBe("abc12345");
  });

  test("throws a config SeerrError when no url is configured", () => {
    let thrown: unknown;
    try {
      resolveConfig({}, { env: {}, readFile: () => null, statMode: () => null });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(SeerrError);
    expect((thrown as SeerrError).code).toBe("config");
  });

  test("reads the api key from a config file when env lacks it", () => {
    const cfg = resolveConfig(
      {},
      {
        env: { SEERR_URL: "http://localhost:5055" },
        readFile: (p) => (p.includes("seerr") ? "SEERR_API_KEY=fromfile1\n" : null),
        statMode: () => null,
      },
    );
    expect(cfg.hasApiKey).toBe(true);
    expect(cfg.apiKey).toBe("fromfile1");
  });
});
