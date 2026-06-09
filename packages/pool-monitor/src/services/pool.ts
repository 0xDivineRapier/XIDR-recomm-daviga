import { createPublicClient, http, parseAbi } from "viem";
import { base } from "viem/chains";
import { env } from "../lib/env.js";
import { cacheGet, cacheSet } from "../lib/redis.js";

const CACHE_KEY = "aerodrome:pool";

// Aerodrome CL pools expose the same Uniswap V3 slot0 / liquidity interface.
// For stable pools (non-CL) the relevant reads are reserve0/reserve1.
// We read both and fall back gracefully.
const POOL_ABI = parseAbi([
  // Uniswap V3-style CL pool
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function liquidity() view returns (uint128)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  // Aerodrome stable/volatile pool
  "function reserve0() view returns (uint256)",
  "function reserve1() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
]);

const ERC20_ABI = parseAbi([
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
]);

export interface PoolState {
  tvl_idr: number;
  volume_24h_idr: number;
  sqrtPriceX96: bigint;
  tick: number;
  reserve0: bigint;
  reserve1: bigint;
  token0: `0x${string}`;
  token1: `0x${string}`;
  decimals0: number;
  decimals1: number;
}

function buildClient() {
  return createPublicClient({ chain: base, transport: http(env.ALCHEMY_RPC_URL || undefined) });
}

export async function readPoolState(): Promise<PoolState> {
  const cached = await cacheGet<PoolState>(CACHE_KEY);
  if (cached) return cached;

  const client = buildClient();
  const pool = env.AERODROME_POOL_ADDRESS;

  const [token0, token1] = await Promise.all([
    client.readContract({ address: pool, abi: POOL_ABI, functionName: "token0" }),
    client.readContract({ address: pool, abi: POOL_ABI, functionName: "token1" }),
  ]);

  const [decimals0, decimals1, bal0, bal1] = await Promise.all([
    client.readContract({ address: token0 as `0x${string}`, abi: ERC20_ABI, functionName: "decimals" }),
    client.readContract({ address: token1 as `0x${string}`, abi: ERC20_ABI, functionName: "decimals" }),
    client.readContract({ address: token0 as `0x${string}`, abi: ERC20_ABI, functionName: "balanceOf", args: [pool] }),
    client.readContract({ address: token1 as `0x${string}`, abi: ERC20_ABI, functionName: "balanceOf", args: [pool] }),
  ]);

  // Read CL-style slot0; fall back to zeros if pool is classic AMM
  let sqrtPriceX96 = 0n;
  let tick = 0;
  try {
    const slot0 = await client.readContract({ address: pool, abi: POOL_ABI, functionName: "slot0" });
    sqrtPriceX96 = slot0[0];
    tick = slot0[1];
  } catch { /* classic AMM — sqrtPriceX96 stays 0 */ }

  const reserve0 = bal0 as bigint;
  const reserve1 = bal1 as bigint;

  // TVL: assume token0 is IDRX (pegged 1:1 to IDR, 6 decimals typical).
  // Both sides of the pool contribute; IDRX side × 2 is a conservative symmetric estimate.
  // If neither token is IDRX, the operator should review the pool address.
  const idrxHuman = Number(reserve0) / 10 ** (decimals0 as number);
  const tvl_idr = idrxHuman * 2; // symmetric LP assumption

  // 24h volume: not available from direct contract reads.
  // Set to 0 here; swap in a subgraph call in readVolume24h() when available.
  const volume_24h_idr = 0;

  const state: PoolState = {
    tvl_idr,
    volume_24h_idr,
    sqrtPriceX96,
    tick,
    reserve0,
    reserve1,
    token0: token0 as `0x${string}`,
    token1: token1 as `0x${string}`,
    decimals0: decimals0 as number,
    decimals1: decimals1 as number,
  };

  await cacheSet(CACHE_KEY, {
    ...state,
    // bigints are not JSON-serialisable; store as strings
    sqrtPriceX96: sqrtPriceX96.toString(),
    reserve0: reserve0.toString(),
    reserve1: reserve1.toString(),
  });

  return state;
}

// Inject mock state in tests / local dev without a live RPC
export async function setMockPoolState(state: PoolState): Promise<void> {
  await cacheSet(CACHE_KEY, {
    ...state,
    sqrtPriceX96: state.sqrtPriceX96.toString(),
    reserve0: state.reserve0.toString(),
    reserve1: state.reserve1.toString(),
  });
}
