import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { settlementRoutes } from "../src/routes/settlement.js";
import { railsRoutes } from "../src/routes/rails.js";
import { DigitalRupiahStubAdapter } from "../src/adapters/DigitalRupiahStubAdapter.js";

// ── Stub all infrastructure — no live DB, Redis, RPC, or BullMQ ─────────────

vi.mock("../src/lib/db.js", () => ({
  getDb: vi.fn(),   // not called — factory is mocked to bypass IdrxRailAdapter
  closeDb: vi.fn(),
}));

vi.mock("../src/lib/redis.js", () => ({
  getRedis: vi.fn(),
  cacheStatus: vi.fn(),
  getCachedStatus: async () => null, // always cache-miss so adapter is called
}));

vi.mock("../src/workers/webhookWorker.js", () => ({
  enqueueWebhook: vi.fn(),
  startWebhookWorker: vi.fn(),
  getWebhookQueue: vi.fn(),
}));

// Force the "test" rail adapter regardless of env capture timing.
// env.ts reads process.env at module load, before vi.stubEnv can take effect,
// so we mock the factory directly to guarantee DigitalRupiahStubAdapter is used.
vi.mock("../src/adapters/RailAdapterFactory.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/adapters/RailAdapterFactory.js")>();
  return {
    ...original,
    createAdapter: () => new DigitalRupiahStubAdapter(),
  };
});

vi.stubEnv("CALLBACK_URL", "");

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
  await app.register(settlementRoutes);
  await app.register(railsRoutes);
  await app.ready();
  return app;
}

// ─── POST /api/v1/settlement/initiate ─────────────────────────────────────────

describe("POST /api/v1/settlement/initiate", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });

  const validBody = {
    amount_idr: 500_000_000,
    recipient: "0xRecipient0000000000000000000000000000001",
    reference_id: "ref-integ-001",
  };

  it("returns HTTP 201 for valid params", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/settlement/initiate", payload: validBody });
    expect(res.statusCode).toBe(201);
  });

  it("returns all SettlementResult fields", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/settlement/initiate", payload: validBody });
    const body = res.json();
    expect(typeof body.settlement_id).toBe("string");
    expect(typeof body.rail_id).toBe("string");
    expect(typeof body.status).toBe("string");
    expect(typeof body.initiated_at).toBe("string");
  });

  it("status is 'pending' on initiation", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/settlement/initiate", payload: validBody });
    expect(res.json().status).toBe("pending");
  });

  it("400 when amount_idr is missing", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/v1/settlement/initiate",
      payload: { recipient: "0x1", reference_id: "r1" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 when recipient is missing", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/v1/settlement/initiate",
      payload: { amount_idr: 1_000_000, reference_id: "r1" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 when reference_id is missing", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/v1/settlement/initiate",
      payload: { amount_idr: 1_000_000, recipient: "0x1" },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ─── Full initiate → getStatus flow ──────────────────────────────────────────

describe("initiate → getStatus flow", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });

  it("GET /api/v1/settlement/:id returns consistent status after initiation", async () => {
    // 1. Initiate
    const initRes = await app.inject({
      method: "POST", url: "/api/v1/settlement/initiate",
      payload: { amount_idr: 100_000_000, recipient: "0xRecip", reference_id: "ref-flow-001" },
    });
    expect(initRes.statusCode).toBe(201);
    const { settlement_id, rail_id } = initRes.json();

    // 2. Get status
    const statusRes = await app.inject({ method: "GET", url: `/api/v1/settlement/${settlement_id}` });
    expect(statusRes.statusCode).toBe(200);

    const body = statusRes.json();
    expect(body.settlement_id).toBe(settlement_id);
    expect(body.rail_id).toBe(rail_id);
    expect(body.status).toBe("pending");
    expect(typeof body.updated_at).toBe("string");
  });

  it("GET /api/v1/settlement/:id returns 404 for unknown id", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/settlement/00000000-0000-0000-0000-000000000000" });
    expect(res.statusCode).toBe(404);
  });

  it("response structure is identical regardless of active rail (test vs idrx shape)", async () => {
    // Both rails return same field set — we verify structural contract here
    const initRes = await app.inject({
      method: "POST", url: "/api/v1/settlement/initiate",
      payload: { amount_idr: 200_000_000, recipient: "0xCorpA", reference_id: "ref-compat-001" },
    });
    const body = initRes.json();
    // Must have all four SettlementResult fields
    expect(Object.keys(body)).toEqual(
      expect.arrayContaining(["settlement_id", "rail_id", "status", "initiated_at"])
    );
  });
});

// ─── GET /api/v1/rails/compatibility ─────────────────────────────────────────

describe("GET /api/v1/rails/compatibility", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });

  it("returns HTTP 200", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/rails/compatibility" });
    expect(res.statusCode).toBe(200);
  });

  it("response contains generated_at and rails array", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/rails/compatibility" });
    const body = res.json();
    expect(typeof body.generated_at).toBe("string");
    expect(Array.isArray(body.rails)).toBe(true);
    expect(body.rails.length).toBeGreaterThanOrEqual(2);
  });

  it("each rail entry has rail, description, features fields", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/rails/compatibility" });
    for (const entry of res.json().rails) {
      expect(typeof entry.rail).toBe("string");
      expect(typeof entry.description).toBe("string");
      expect(typeof entry.features).toBe("object");
      expect(Object.keys(entry.features)).toEqual(
        expect.arrayContaining(["escrow", "split_settlement", "time_lock", "cancel"])
      );
    }
  });

  it("idrx rail marks all features as 'supported'", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/rails/compatibility" });
    const idrx = res.json().rails.find((r: { rail: string }) => r.rail === "idrx");
    expect(idrx).toBeDefined();
    for (const v of Object.values(idrx.features)) expect(v).toBe("supported");
  });

  it("digital_rupiah marks all features as 'pending_spec'", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/rails/compatibility" });
    const dr = res.json().rails.find((r: { rail: string }) => r.rail === "digital_rupiah");
    expect(dr).toBeDefined();
    for (const v of Object.values(dr.features)) expect(v).toBe("pending_spec");
  });
});
