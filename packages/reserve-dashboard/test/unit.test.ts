import { describe, it, expect, vi, beforeEach } from "vitest";
import { computeRatio, signPayload } from "../src/services/reserves.js";
import { isUnderCollateralised } from "../src/services/webhook.js";

// Stub env for deterministic HMAC
vi.stubEnv("HMAC_SECRET", "test-secret");

describe("computeRatio", () => {
  it("returns reserve / supply", () => {
    expect(computeRatio(1_000_000, 1_000_000)).toBe(1);
    expect(computeRatio(1_000_000, 990_000)).toBeCloseTo(0.99);
    expect(computeRatio(1_000_000, 1_050_000)).toBeCloseTo(1.05);
  });

  it("returns 1 when supply is 0 (no tokens minted)", () => {
    expect(computeRatio(0, 500)).toBe(1);
  });
});

describe("signPayload", () => {
  it("produces a deterministic 64-char hex HMAC", () => {
    const payload = {
      total_supply: 1_000_000,
      idr_reserve_balance: 1_000_000,
      ratio: 1,
      last_updated: "2026-06-09T00:00:00.000Z",
      data_sources: ["onchain_base", "file"],
    };
    const sig = signPayload(payload);
    expect(sig).toHaveLength(64);
    expect(sig).toMatch(/^[0-9a-f]+$/);
    // Same input → same output
    expect(signPayload(payload)).toBe(sig);
  });

  it("produces different signatures for different payloads", () => {
    const base = { total_supply: 1_000_000, idr_reserve_balance: 1_000_000, ratio: 1, last_updated: "t", data_sources: [] };
    const altered = { ...base, ratio: 0.98 };
    expect(signPayload(base)).not.toBe(signPayload(altered));
  });
});

describe("isUnderCollateralised (anomaly detection)", () => {
  it("flags ratio below 0.99", () => {
    expect(isUnderCollateralised(0.98)).toBe(true);
    expect(isUnderCollateralised(0.989)).toBe(true);
  });

  it("does not flag ratio at or above 0.99", () => {
    expect(isUnderCollateralised(0.99)).toBe(false);
    expect(isUnderCollateralised(1.0)).toBe(false);
    expect(isUnderCollateralised(1.05)).toBe(false);
  });
});
