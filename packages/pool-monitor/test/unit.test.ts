import { describe, it, expect, vi } from "vitest";
import { estimateSlippage, computeSlippage } from "../src/services/slippage.js";
import { isBelowThreshold, resetDebounce } from "../src/services/alert.js";
import { sign } from "../src/lib/hmac.js";

vi.stubEnv("HMAC_SECRET", "test-secret");
vi.stubEnv("LOW_TVL_THRESHOLD_IDR", "3000000000");

// ─── Slippage estimator ────────────────────────────────────────────────────

describe("estimateSlippage", () => {
  it("returns amountIn / (reserveIn + amountIn)", () => {
    // reserve = 5B, swap = 500M  →  500M / 5.5B ≈ 9.09%
    const s = estimateSlippage(5_000_000_000, 500_000_000);
    expect(s).toBeCloseTo(0.0909, 3);
  });

  it("smaller swap = lower slippage", () => {
    const s500 = estimateSlippage(5_000_000_000, 500_000_000);
    const s100 = estimateSlippage(5_000_000_000, 100_000_000);
    expect(s100).toBeLessThan(s500);
  });

  it("returns 1 (100%) when pool reserve is zero", () => {
    expect(estimateSlippage(0, 500_000_000)).toBe(1);
  });

  it("deep pool produces near-zero slippage on small swap", () => {
    // reserve = 100B, swap = 1M  →  negligible
    expect(estimateSlippage(100_000_000_000, 1_000_000)).toBeLessThan(0.0001);
  });
});

describe("computeSlippage", () => {
  it("returns both fields as numbers with 4 decimal precision", () => {
    const result = computeSlippage(10_000_000_000); // TVL = Rp 10B
    expect(typeof result.slippage_500m_pct).toBe("number");
    expect(typeof result.slippage_100m_pct).toBe("number");
  });

  it("Rp 500M slippage > Rp 100M slippage for same pool", () => {
    const result = computeSlippage(10_000_000_000);
    expect(result.slippage_500m_pct).toBeGreaterThan(result.slippage_100m_pct);
  });

  it("reasonable numbers: Rp 10B TVL pool, Rp 500M swap ≈ 9%", () => {
    // Each side = 5B.  500M / (5B + 500M) = 0.0909…
    const result = computeSlippage(10_000_000_000);
    expect(result.slippage_500m_pct).toBeCloseTo(9.09, 1);
  });

  it("reasonable numbers: Rp 10B TVL pool, Rp 100M swap ≈ 1.96%", () => {
    // Each side = 5B.  100M / (5B + 100M) = 0.01960…
    const result = computeSlippage(10_000_000_000);
    expect(result.slippage_100m_pct).toBeCloseTo(1.96, 1);
  });
});

// ─── Alert / anomaly detection ────────────────────────────────────────────

describe("isBelowThreshold", () => {
  it("flags TVL below 3B", () => {
    expect(isBelowThreshold(2_999_999_999)).toBe(true);
    expect(isBelowThreshold(1_000_000_000)).toBe(true);
  });

  it("does not flag TVL at or above 3B", () => {
    expect(isBelowThreshold(3_000_000_000)).toBe(false);
    expect(isBelowThreshold(5_000_000_000)).toBe(false);
  });
});

// ─── HMAC signing ─────────────────────────────────────────────────────────

describe("sign", () => {
  it("produces a deterministic 64-char hex string", () => {
    const payload = { tvl_idr: 10_000_000_000, ratio: 1.05 };
    const sig = sign(payload);
    expect(sig).toHaveLength(64);
    expect(sig).toMatch(/^[0-9a-f]+$/);
    expect(sign(payload)).toBe(sig); // deterministic
  });

  it("different payloads produce different signatures", () => {
    expect(sign({ a: 1 })).not.toBe(sign({ a: 2 }));
  });
});
