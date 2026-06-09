import { describe, it, expect, vi, beforeAll } from "vitest";
import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import { poolRoute } from "../src/routes/pool.js";

// ── Mock Redis — always cache-miss so services run fresh ──────────────────
vi.mock("../src/lib/redis.js", () => ({
  cacheGet: async () => null,
  cacheSet: async () => {},
}));

// ── Mock on-chain pool reader with a realistic Rp 10B pool ───────────────
vi.mock("../src/services/pool.js", () => ({
  readPoolState: async () => ({
    tvl_idr: 10_000_000_000,
    volume_24h_idr: 250_000_000,
    sqrtPriceX96: 0n,
    tick: 0,
    reserve0: 5_000_000_000n,
    reserve1: 5_000_000_000n,
    token0: "0x1234000000000000000000000000000000000000",
    token1: "0x5678000000000000000000000000000000000000",
    decimals0: 6,
    decimals1: 6,
  }),
}));

vi.stubEnv("HMAC_SECRET", "integration-test-secret");
vi.stubEnv("AERODROME_POOL_ADDRESS", "0xdeadbeef00000000000000000000000000000000");
vi.stubEnv("ALERT_WEBHOOK_URL", "");

describe("GET /api/v1/pool", () => {
  let app: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    app = Fastify();
    await app.register(rateLimit, { max: 60, timeWindow: "1 minute" });
    await app.register(poolRoute);
    await app.ready();
  });

  it("returns HTTP 200", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/pool" });
    expect(res.statusCode).toBe(200);
  });

  it("returns all required fields with correct types", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/pool" });
    const body = res.json();

    expect(typeof body.tvl_idr).toBe("number");
    expect(typeof body.volume_24h_idr).toBe("number");
    expect(typeof body.slippage_500m_pct).toBe("number");
    expect(typeof body.slippage_100m_pct).toBe("number");
    expect(typeof body.pool_address).toBe("string");
    expect(typeof body.last_updated).toBe("string");
    expect(typeof body.signature).toBe("string");
  });

  it("slippage_500m_pct > slippage_100m_pct", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/pool" });
    const body = res.json();
    expect(body.slippage_500m_pct).toBeGreaterThan(body.slippage_100m_pct);
  });

  it("slippage values are reasonable for a Rp 10B pool", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/pool" });
    const { slippage_500m_pct, slippage_100m_pct } = res.json();
    // 500M into 5B-per-side pool ≈ 9.09%
    expect(slippage_500m_pct).toBeCloseTo(9.09, 1);
    // 100M into 5B-per-side pool ≈ 1.96%
    expect(slippage_100m_pct).toBeCloseTo(1.96, 1);
  });

  it("includes X-Pool-Signature header (64-char hex)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/pool" });
    const sig = res.headers["x-pool-signature"] as string;
    expect(sig).toHaveLength(64);
    expect(sig).toMatch(/^[0-9a-f]+$/);
  });

  it("last_updated is a valid ISO 8601 timestamp", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/pool" });
    const { last_updated } = res.json();
    expect(() => new Date(last_updated).toISOString()).not.toThrow();
    expect(new Date(last_updated).getFullYear()).toBeGreaterThan(2020);
  });
});

// ── Alert fires when TVL breaches threshold ───────────────────────────────
describe("alert threshold behaviour", () => {
  it("isBelowThreshold fires for Rp 2B TVL against default Rp 3B threshold", async () => {
    const { isBelowThreshold } = await import("../src/services/alert.js");
    // Override env threshold
    vi.stubEnv("LOW_TVL_THRESHOLD_IDR", "3000000000");
    expect(isBelowThreshold(2_000_000_000)).toBe(true);
  });

  it("does not fire for TVL at threshold", async () => {
    const { isBelowThreshold } = await import("../src/services/alert.js");
    expect(isBelowThreshold(3_000_000_000)).toBe(false);
  });

  it("triggerAlert is a no-op when ALERT_WEBHOOK_URL is unset", async () => {
    const { triggerAlert, resetDebounce } = await import("../src/services/alert.js");
    resetDebounce();
    // Should resolve without throwing even at low TVL
    await expect(triggerAlert(1_000_000_000)).resolves.toBeUndefined();
  });
});
