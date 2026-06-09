import { test, expect } from "bun:test";
import { run } from "../../src/cli/runner";

// Live smoke test against a REAL Seerr server. This hits the network and uses the
// real resolved config, so it only runs when SEERR_API_KEY is set AND we are not
// in CI. In every other case it is skipped.
const SKIP = !process.env.SEERR_API_KEY || !!process.env.CI;

test.skipIf(SKIP)(
  "live: doctor reaches the real Seerr and validates the key",
  async () => {
    const res = await run(["doctor"]);
    expect(res.exitCode).toBe(0);
    const out = JSON.parse(res.stdout);
    expect(out.ok).toBe(true);
    expect(out.data.connectivity).toBe("ok");
  },
  15000,
);
