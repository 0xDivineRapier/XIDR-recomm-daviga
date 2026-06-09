import { readPoolState } from "./pool.js";
import { computeSlippage } from "./slippage.js";
import { triggerAlert } from "./alert.js";
import { sign } from "../lib/hmac.js";
import { env } from "../lib/env.js";

export interface PoolReport {
  pool_address: string;
  tvl_idr: number;
  volume_24h_idr: number;
  slippage_500m_pct: number;
  slippage_100m_pct: number;
  last_updated: string;
}

export interface SignedPoolReport extends PoolReport {
  signature: string;
}

export async function getPoolReport(): Promise<SignedPoolReport> {
  const state = await readPoolState();
  const { slippage_500m_pct, slippage_100m_pct } = computeSlippage(state.tvl_idr);

  const report: PoolReport = {
    pool_address: env.AERODROME_POOL_ADDRESS,
    tvl_idr: state.tvl_idr,
    volume_24h_idr: state.volume_24h_idr,
    slippage_500m_pct,
    slippage_100m_pct,
    last_updated: new Date().toISOString(),
  };

  // Fire-and-forget — must not block API response
  triggerAlert(state.tvl_idr).catch(() => {});

  return { ...report, signature: sign(report) };
}
