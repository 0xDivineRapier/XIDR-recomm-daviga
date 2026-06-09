import { describe, it, expect, vi, beforeAll } from "vitest";
import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import { reservesRoute } from "../src/routes/reserves.js";
import { setReserveSource } from "../src/services/custodian.js";

// Mock on-chain read so no real RPC is needed
vi.mock("../src/services/onchain.js", () => ({
  readTotalSupply: async () => 1_000_000n,
}));

// Mock Redis — cache always misses in tests
vi.mock("../src/lib/redis.js", () => ({
  cacheGet: async () => null,
  cacheSet: async () => {},
}));

// Stub env
vi.stubEnv("HMAC_SECRET", "integration-test-secret");
vi.stubEnv("WEBHOOK_URL", "");

const mockSource = {
  name: "mock",
  getBalance: async () => ({ idr_balance: 1_050_000, updated_at: "2026-06-09T00:00:00Z" }),
};

describe("GET /api/v1/reserves", () => {
  let app: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    setReserveSource(mockSource);
    app = Fastify();
    await app.register(rateLimit, { max: 60, timeWindow: "1 minute" });
    await app.register(reservesRoute);
    await app.ready();
  });

  it("returns all required fields with correct types", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/reserves" });
    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(typeof body.total_supply).toBe("number");
    expect(typeof body.idr_reserve_balance).toBe("number");
    expect(typeof body.ratio).toBe("number");
    expect(typeof body.last_updated).toBe("string");
    expect(Array.isArray(body.data_sources)).toBe(true);
    expect(body.data_sources.length).toBeGreaterThan(0);
  });

  it("includes X-Reserve-Signature header (64-char hex)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/reserves" });
    const sig = res.headers["x-reserve-signature"] as string;
    expect(sig).toHaveLength(64);
    expect(sig).toMatch(/^[0-9a-f]+$/);
  });

  it("computes ratio correctly from mocked data", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/reserves" });
    const body = res.json();
    // reserve 1_050_000 / supply 1_000_000 = 1.05
    expect(body.ratio).toBeCloseTo(1.05);
  });

  it("last_updated is a valid ISO 8601 string", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/reserves" });
    const { last_updated } = res.json();
    expect(() => new Date(last_updated).toISOString()).not.toThrow();
  });
});
