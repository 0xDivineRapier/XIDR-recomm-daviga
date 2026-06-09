import { describe, it, expect, vi, beforeEach } from "vitest";
import { createAdapter } from "../src/adapters/RailAdapterFactory.js";
import { DigitalRupiahStubAdapter } from "../src/adapters/DigitalRupiahStubAdapter.js";
import { IdrxRailAdapter } from "../src/adapters/IdrxRailAdapter.js";
import { COMPATIBILITY_MATRIX } from "../src/adapters/RailAdapterFactory.js";

// ─── Factory: rail selection ──────────────────────────────────────────────────

describe("RailAdapterFactory", () => {
  it('returns IdrxRailAdapter for "idrx"', () => {
    expect(createAdapter("idrx")).toBeInstanceOf(IdrxRailAdapter);
  });

  it('returns DigitalRupiahStubAdapter for "digital_rupiah"', () => {
    expect(createAdapter("digital_rupiah")).toBeInstanceOf(DigitalRupiahStubAdapter);
  });

  it('"test" rail is an alias for DigitalRupiahStubAdapter', () => {
    expect(createAdapter("test")).toBeInstanceOf(DigitalRupiahStubAdapter);
  });

  it("throws a descriptive error for unknown rail names", () => {
    expect(() => createAdapter("swift")).toThrowError(/Invalid SETTLEMENT_RAIL/);
    expect(() => createAdapter("")).toThrowError(/Invalid SETTLEMENT_RAIL/);
    expect(() => createAdapter("IDRX")).toThrowError(/Invalid SETTLEMENT_RAIL/);
  });

  it("error message lists valid rail names", () => {
    try { createAdapter("bad"); }
    catch (e: any) {
      expect(e.message).toContain("idrx");
      expect(e.message).toContain("digital_rupiah");
      expect(e.message).toContain("test");
    }
  });
});

// ─── DigitalRupiahStubAdapter (also covers "test" rail) ──────────────────────

describe("DigitalRupiahStubAdapter — method signatures and return shapes", () => {
  const adapter = new DigitalRupiahStubAdapter();

  const params = {
    amount_idr: 500_000_000,
    recipient: "0xRecipient",
    reference_id: "ref-unit-001",
  };

  it("initiate() returns SettlementResult with all required fields", async () => {
    const result = await adapter.initiate(params);
    expect(typeof result.settlement_id).toBe("string");
    expect(typeof result.rail_id).toBe("string");
    expect(result.status).toBe("pending");
    expect(typeof result.initiated_at).toBe("string");
    expect(() => new Date(result.initiated_at).toISOString()).not.toThrow();
  });

  it("initiate() rail_id starts with bi_dr_stub_ prefix", async () => {
    const result = await adapter.initiate(params);
    expect(result.rail_id).toMatch(/^bi_dr_stub_/);
  });

  it("getStatus() returns consistent status for known id", async () => {
    const initiated = await adapter.initiate(params);
    const status = await adapter.getStatus(initiated.settlement_id);
    expect(status.settlement_id).toBe(initiated.settlement_id);
    expect(status.rail_id).toBe(initiated.rail_id);
    expect(status.status).toBe("pending");
    expect(typeof status.updated_at).toBe("string");
  });

  it("getStatus() throws for unknown id", async () => {
    await expect(adapter.getStatus("nonexistent-id")).rejects.toThrow("not found");
  });

  it("cancel() succeeds for pending settlement", async () => {
    const initiated = await adapter.initiate(params);
    const result = await adapter.cancel(initiated.settlement_id);
    expect(result.cancelled).toBe(true);
    expect(result.settlement_id).toBe(initiated.settlement_id);
  });

  it("cancel() returns cancelled:false for unknown settlement", async () => {
    const result = await adapter.cancel("unknown-id");
    expect(result.cancelled).toBe(false);
    expect(typeof result.reason).toBe("string");
  });

  it("status after cancel() is 'cancelled'", async () => {
    const initiated = await adapter.initiate(params);
    await adapter.cancel(initiated.settlement_id);
    const status = await adapter.getStatus(initiated.settlement_id);
    expect(status.status).toBe("cancelled");
  });
});

// ─── IdrxRailAdapter — method signatures only (no live DB) ───────────────────

describe("IdrxRailAdapter — railName and interface surface", () => {
  it("railName is 'idrx'", () => {
    const adapter = new IdrxRailAdapter();
    expect(adapter.railName).toBe("idrx");
  });

  it("exposes initiate, getStatus, cancel methods", () => {
    const adapter = new IdrxRailAdapter();
    expect(typeof adapter.initiate).toBe("function");
    expect(typeof adapter.getStatus).toBe("function");
    expect(typeof adapter.cancel).toBe("function");
  });
});

// ─── Compatibility matrix ─────────────────────────────────────────────────────

describe("COMPATIBILITY_MATRIX", () => {
  it("contains entries for idrx and digital_rupiah", () => {
    const rails = COMPATIBILITY_MATRIX.map((e) => e.rail);
    expect(rails).toContain("idrx");
    expect(rails).toContain("digital_rupiah");
  });

  it("idrx supports all four features", () => {
    const idrx = COMPATIBILITY_MATRIX.find((e) => e.rail === "idrx")!;
    expect(idrx.features.escrow).toBe("supported");
    expect(idrx.features.split_settlement).toBe("supported");
    expect(idrx.features.time_lock).toBe("supported");
    expect(idrx.features.cancel).toBe("supported");
  });

  it("digital_rupiah marks all features as pending_spec", () => {
    const dr = COMPATIBILITY_MATRIX.find((e) => e.rail === "digital_rupiah")!;
    for (const v of Object.values(dr.features)) {
      expect(v).toBe("pending_spec");
    }
  });

  it("each entry has a non-empty description", () => {
    for (const entry of COMPATIBILITY_MATRIX) {
      expect(entry.description.length).toBeGreaterThan(10);
    }
  });
});

// ─── Status transitions ───────────────────────────────────────────────────────

describe("DigitalRupiahStubAdapter — status transitions", () => {
  const adapter = new DigitalRupiahStubAdapter();

  it("cancel() on already-cancelled settlement returns cancelled:false", async () => {
    const { settlement_id } = await adapter.initiate({
      amount_idr: 100_000_000, recipient: "0xA", reference_id: "ref-cancel-double",
    });
    await adapter.cancel(settlement_id);
    // Second cancel attempt
    const result = await adapter.cancel(settlement_id);
    expect(result.cancelled).toBe(false);
  });

  it("two settlements have distinct settlement_ids", async () => {
    const params = { amount_idr: 1_000_000, recipient: "0xB", reference_id: "ref-unique" };
    const a = await adapter.initiate(params);
    const b = await adapter.initiate(params);
    expect(a.settlement_id).not.toBe(b.settlement_id);
  });
});
