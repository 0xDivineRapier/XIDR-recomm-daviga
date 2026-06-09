import { createPublicClient, http, parseAbi } from "viem";
import { base } from "viem/chains";
import { env } from "../lib/env.js";
import { cacheGet, cacheSet } from "../lib/redis.js";

const CACHE_KEY = "idrx:total_supply";

const ERC20_ABI = parseAbi([
  "function totalSupply() view returns (uint256)",
  "function decimals() view returns (uint8)",
]);

function buildClient() {
  return createPublicClient({
    chain: base,
    transport: http(env.ALCHEMY_RPC_URL || undefined),
  });
}

export async function readTotalSupply(): Promise<bigint> {
  const cached = await cacheGet<string>(CACHE_KEY);
  if (cached !== null) return BigInt(cached);

  const client = buildClient();
  const [rawSupply, decimals] = await Promise.all([
    client.readContract({ address: env.IDRX_CONTRACT_ADDRESS, abi: ERC20_ABI, functionName: "totalSupply" }),
    client.readContract({ address: env.IDRX_CONTRACT_ADDRESS, abi: ERC20_ABI, functionName: "decimals" }),
  ]);

  // Normalise to human-readable units (IDR has 2 decimals, but honour contract decimals)
  const divisor = 10n ** BigInt(decimals);
  const supply = rawSupply / divisor;

  await cacheSet(CACHE_KEY, supply.toString());
  return supply;
}

// Used in tests / when no real RPC is available
export function mockTotalSupply(value: bigint) {
  return cacheSet(CACHE_KEY, value.toString());
}
