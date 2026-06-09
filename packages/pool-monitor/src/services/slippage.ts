/**
 * Slippage estimation using the constant-product invariant (x·y = k).
 *
 * Approximation notes:
 * - Aerodrome CL pools use a concentrated-liquidity model (Uniswap V3 math)
 *   where liquidity is distributed across ticks, not uniformly. True slippage
 *   requires iterating over active ticks, which needs the full tick bitmap.
 * - We model the pool as a single constant-product AMM with reserves equal to
 *   the in-range virtual reserves. This *underestimates* slippage for large
 *   swaps that cross tick boundaries, so treat the output as a lower bound.
 * - For classic Aerodrome stable/volatile pools the formula is exact (k = x·y).
 */

export interface SlippageResult {
  slippage_500m_pct: number;
  slippage_100m_pct: number;
}

/**
 * Estimate price impact of swapping `amountIn` (in IDR units) against a pool
 * with reserves expressed in the same IDR-equivalent units.
 *
 * Formula:
 *   amountOut = (reserveOut × amountIn) / (reserveIn + amountIn)
 *   price impact = 1 − (amountOut / amountIn) × (reserveIn / reserveOut)
 *               = amountIn / (reserveIn + amountIn)
 */
export function estimateSlippage(reserveIn: number, amountIn: number): number {
  if (reserveIn <= 0) return 1; // pool is empty — 100% slippage
  return amountIn / (reserveIn + amountIn);
}

export function computeSlippage(tvl_idr: number): SlippageResult {
  // Symmetric pool: each side holds half the TVL
  const reserveIn = tvl_idr / 2;

  const slippage_500m_pct = estimateSlippage(reserveIn, 500_000_000) * 100;
  const slippage_100m_pct = estimateSlippage(reserveIn, 100_000_000) * 100;

  return {
    slippage_500m_pct: Number(slippage_500m_pct.toFixed(4)),
    slippage_100m_pct: Number(slippage_100m_pct.toFixed(4)),
  };
}
