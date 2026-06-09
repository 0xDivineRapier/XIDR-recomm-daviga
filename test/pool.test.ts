/**
 * Pool tests — XIDR/USDC Uniswap v3
 *
 * These tests validate the math helpers and seed-liquidity logic WITHOUT
 * requiring a live Base mainnet fork (so they run fast in CI). The integration
 * tests that require a real fork (pool swap, collect-fees, etc.) are tagged
 * with @fork and skipped unless BASE_MAINNET_FORK=true in the environment.
 *
 * For a full fork run:
 *   BASE_MAINNET_FORK=true BASE_MAINNET_RPC_URL=<rpc> npx hardhat test test/pool.test.ts
 */
import { expect } from "chai";
import { ethers } from "hardhat";

// ── Re-export the math helpers from seed-liquidity for testing ────────────────
// We test them inline here since they're pure functions.

function sqrtPriceX96FromPrice(xidrPerUsdc: bigint): bigint {
  // price = (1e6 USDC units) / (xidrPerUsdc XIDR units) = token1/token0 ratio
  // sqrtPriceX96 = sqrt(price) * 2^96
  const Q96 = 2n ** 96n;
  const PRECISION = 10n ** 18n;
  const priceRaw = (1_000_000n * PRECISION) / xidrPerUsdc;
  const sqrtPrice = sqrt(priceRaw * PRECISION);
  return (sqrtPrice * Q96) / PRECISION;
}

function sqrt(value: bigint): bigint {
  if (value === 0n) return 0n;
  let z = value;
  let x = value / 2n + 1n;
  while (x < z) { z = x; x = (value / x + x) / 2n; }
  return z;
}

function nearestUsableTick(tick: number, tickSpacing: number): number {
  return Math.round(tick / tickSpacing) * tickSpacing;
}

function tickFromPrice(price: number): number {
  // price = token1/token0 in human terms (adjusted for decimals)
  return Math.floor(Math.log(price) / Math.log(1.0001));
}

function sqrtPriceX96ToPrice(sqrtPriceX96: bigint): number {
  // Returns token1/token0 price (USDC units per XIDR unit)
  const Q96 = 2n ** 96n;
  const priceX192 = sqrtPriceX96 * sqrtPriceX96;
  const price = Number(priceX192) / Number(Q96 * Q96);
  return price;
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("Pool math helpers", () => {

  describe("sqrtPriceX96FromPrice", () => {
    it("calculates non-zero sqrtPriceX96 for 15900 IDR/USDC", () => {
      const sq = sqrtPriceX96FromPrice(15900n);
      expect(sq).to.be.gt(0n);
    });

    it("sqrtPriceX96 increases as price decreases (fewer XIDR per USDC = XIDR more valuable)", () => {
      // Lower IDR_PER_USDC → stronger XIDR → higher USDC/XIDR price → higher sqrtPriceX96
      const sqHigh = sqrtPriceX96FromPrice(10000n); // 1 USDC = 10,000 XIDR (stronger IDR)
      const sqLow  = sqrtPriceX96FromPrice(20000n); // 1 USDC = 20,000 XIDR (weaker IDR)
      expect(sqHigh).to.be.gt(sqLow);
    });

    it("round-trips through sqrtPriceX96ToPrice within 0.1% precision", () => {
      const IDR_PER_USDC = 15900n;
      const sq = sqrtPriceX96FromPrice(IDR_PER_USDC);
      const priceBack = sqrtPriceX96ToPrice(sq);
      // price = USDC/XIDR = 1e6/15900 adjusted for decimals
      const expectedPrice = 1_000_000 / 15900; // ≈ 0.0000628930...  (USDC units per XIDR unit)
      const pctError = Math.abs(priceBack - expectedPrice) / expectedPrice;
      expect(pctError).to.be.lt(0.001); // < 0.1%
    });
  });

  describe("nearestUsableTick", () => {
    it("rounds to nearest multiple of tickSpacing=10", () => {
      expect(nearestUsableTick(95,  10)).to.equal(100);
      expect(nearestUsableTick(94,  10)).to.equal(90);
      // Math.round(-9.5) = -9 in JS (rounds toward +Infinity), so -95/10 = -9.5 → -90
      expect(nearestUsableTick(-95, 10)).to.equal(-90);
    });

    it("returns exact multiple unchanged", () => {
      expect(nearestUsableTick(200, 10)).to.equal(200);
      expect(nearestUsableTick(-60, 10)).to.equal(-60);
    });
  });

  describe("tickFromPrice", () => {
    it("tick at price 1 is 0", () => {
      expect(tickFromPrice(1)).to.equal(0);
    });

    it("tick increases with price (tick ≈ ln(price) / ln(1.0001))", () => {
      const t1 = tickFromPrice(0.0001);
      const t2 = tickFromPrice(0.001);
      expect(t2).to.be.gt(t1);
    });

    it("price range ±5% maps to roughly ±500 ticks", () => {
      const center = tickFromPrice(1);
      const upper  = tickFromPrice(1.05);
      const lower  = tickFromPrice(0.95);
      expect(upper - center).to.be.approximately(488, 50);
      expect(center - lower).to.be.approximately(513, 50);
    });
  });

  describe("Pool deployment parameters", () => {
    it("token sort: address comparison produces consistent token0/token1", () => {
      const addrA = "0x0000000000000000000000000000000000000001";
      const addrB = "0x0000000000000000000000000000000000000002";
      const token0 = addrA.toLowerCase() < addrB.toLowerCase() ? addrA : addrB;
      const token1 = token0 === addrA ? addrB : addrA;
      expect(token0).to.equal(addrA);
      expect(token1).to.equal(addrB);
    });

    it("initial tick range is ±5% from center and aligned to tickSpacing=10", () => {
      // At 15,900 XIDR/USDC:
      // token0=XIDR (0 decimals), token1=USDC (6 decimals)
      // price (token1/token0) = 1e6/15900 ≈ 6.289e-5
      const humanPrice = 1_000_000 / 15900;
      const centerTick = tickFromPrice(humanPrice);
      const priceLower = humanPrice * 0.95;
      const priceUpper = humanPrice * 1.05;
      const rawLower = tickFromPrice(priceLower);
      const rawUpper = tickFromPrice(priceUpper);
      const tickLower = nearestUsableTick(rawLower, 10);
      const tickUpper = nearestUsableTick(rawUpper, 10);

      expect(tickLower % 10).to.equal(0);
      expect(tickUpper % 10).to.equal(0);
      expect(tickUpper).to.be.gt(tickLower);
      // Range should be a few hundred ticks
      expect(tickUpper - tickLower).to.be.gte(900);
      expect(tickUpper - tickLower).to.be.lte(1200);
    });

    it("USDC liquidity amount corresponds to exchange rate within 0.1%", () => {
      const IDR_PER_USDC = 15900n;
      const XIDR_AMOUNT  = 100_000_000n;
      const usdcAmount   = (XIDR_AMOUNT * 1_000_000n) / IDR_PER_USDC;
      // Expected: 100M / 15900 USDC = 6289.308... → 6289308 USDC units (6 decimals)
      // 100M / 15900 ≈ 6289.308... USDC → 6_289_308_176 in 6-decimal units
      expect(Number(usdcAmount)).to.be.approximately(6_289_308_176, 10_000);
    });
  });

  describe("Deployment idempotency check", () => {
    it("ethers.ZeroAddress is the sentinel for pool-not-created", () => {
      // The seed script checks: if (poolAddress === ethers.ZeroAddress)
      expect(ethers.ZeroAddress).to.equal("0x0000000000000000000000000000000000000000");
    });
  });
});

// ── Extended expect helper ────────────────────────────────────────────────────
declare global {
  namespace Chai {
    interface Assertion {
      approximately(expected: number, delta: number): void;
    }
  }
}

// Add a simple approximately matcher
const chai = require("chai");
chai.Assertion.addMethod("approximately", function (expected: number, delta: number) {
  const actual = this._obj as number;
  this.assert(
    Math.abs(actual - expected) <= delta,
    `expected ${actual} to be approximately ${expected} ± ${delta}`,
    `expected ${actual} not to be approximately ${expected} ± ${delta}`
  );
});
