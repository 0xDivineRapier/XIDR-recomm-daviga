/**
 * usePoolData — reads live Uniswap v3 pool state on-chain + historical data
 * from The Graph Uniswap subgraph.
 */
import { useReadContracts, useChainId } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { base, baseSepolia } from "wagmi/chains";

// ── ABIs ──────────────────────────────────────────────────────────────────────
const POOL_ABI = [
  {
    name: "slot0",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "sqrtPriceX96",               type: "uint160" },
      { name: "tick",                         type: "int24"   },
      { name: "observationIndex",             type: "uint16"  },
      { name: "observationCardinality",       type: "uint16"  },
      { name: "observationCardinalityNext",   type: "uint16"  },
      { name: "feeProtocol",                  type: "uint8"   },
      { name: "unlocked",                     type: "bool"    },
    ],
  },
  {
    name: "liquidity",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint128" }],
  },
  {
    name: "feeGrowthGlobal0X128",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "feeGrowthGlobal1X128",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

// ── The Graph endpoint selection ──────────────────────────────────────────────
const SUBGRAPH_URLS: Record<number, string> = {
  [base.id]: import.meta.env.VITE_THEGRAPH_UNISWAP_BASE_URL
    ?? "https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3-base",
  [baseSepolia.id]: import.meta.env.VITE_THEGRAPH_UNISWAP_BASE_SEPOLIA_URL ?? "",
};

// ── Pool address selection ────────────────────────────────────────────────────
const POOL_ADDRESSES: Record<number, `0x${string}`> = {
  [base.id]:        (import.meta.env.VITE_POOL_ADDRESS_MAINNET ?? "0x0000000000000000000000000000000000000000") as `0x${string}`,
  [baseSepolia.id]: (import.meta.env.VITE_POOL_ADDRESS_SEPOLIA ?? import.meta.env.NEXT_PUBLIC_POOL_ADDRESS ?? "0x0000000000000000000000000000000000000000") as `0x${string}`,
};

// ── Types ─────────────────────────────────────────────────────────────────────
export interface PoolDayData {
  date:         number;  // Unix timestamp
  tvlUSD:       number;
  volumeUSD:    number;
  feesUSD:      number;
  token0Price:  number;  // XIDR per USDC
  token1Price:  number;  // USDC per XIDR
}

export interface PoolOnChainData {
  sqrtPriceX96: bigint;
  tick:         number;
  liquidity:    bigint;
  feeGrowth0:   bigint;
  feeGrowth1:   bigint;
  idrPerUsdc:   number;
}

// ── The Graph query ───────────────────────────────────────────────────────────
const POOL_DAY_DATA_QUERY = (poolAddress: string) => `
  query {
    poolDayDatas(
      first: 30
      orderBy: date
      orderDirection: desc
      where: { pool: "${poolAddress.toLowerCase()}" }
    ) {
      date
      tvlUSD
      volumeUSD
      feesUSD
      token0Price
      token1Price
    }
  }
`;

async function fetchPoolDayData(
  subgraphUrl: string,
  poolAddress: string
): Promise<PoolDayData[]> {
  if (!subgraphUrl || poolAddress === "0x0000000000000000000000000000000000000000") {
    return [];
  }
  const resp = await fetch(subgraphUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: POOL_DAY_DATA_QUERY(poolAddress) }),
  });
  const json = await resp.json();
  const raw: any[] = json?.data?.poolDayDatas ?? [];
  return raw.map((d) => ({
    date:        Number(d.date),
    tvlUSD:      parseFloat(d.tvlUSD),
    volumeUSD:   parseFloat(d.volumeUSD),
    feesUSD:     parseFloat(d.feesUSD),
    token0Price: parseFloat(d.token0Price),
    token1Price: parseFloat(d.token1Price),
  }));
}

// ── Hook ──────────────────────────────────────────────────────────────────────
export function usePoolData() {
  const chainId    = useChainId();
  const poolAddress = POOL_ADDRESSES[chainId] ?? "0x0000000000000000000000000000000000000000";
  const subgraphUrl = SUBGRAPH_URLS[chainId] ?? "";

  // On-chain reads
  const { data: onChain, isLoading: onChainLoading } = useReadContracts({
    contracts: [
      { address: poolAddress, abi: POOL_ABI, functionName: "slot0" },
      { address: poolAddress, abi: POOL_ABI, functionName: "liquidity" },
      { address: poolAddress, abi: POOL_ABI, functionName: "feeGrowthGlobal0X128" },
      { address: poolAddress, abi: POOL_ABI, functionName: "feeGrowthGlobal1X128" },
    ],
    query: {
      enabled: poolAddress !== "0x0000000000000000000000000000000000000000",
      refetchInterval: 12_000, // ~1 block
    },
  });

  const slot0     = onChain?.[0]?.result as readonly [bigint, number, ...unknown[]] | undefined;
  const liquidity = onChain?.[1]?.result as bigint | undefined;
  const fg0       = onChain?.[2]?.result as bigint | undefined;
  const fg1       = onChain?.[3]?.result as bigint | undefined;

  let parsedOnChain: PoolOnChainData | undefined;
  if (slot0 && liquidity !== undefined && fg0 !== undefined && fg1 !== undefined) {
    const sqrtPriceX96 = slot0[0] as bigint;
    const Q192 = 2n ** 192n;
    const priceNum = Number(sqrtPriceX96 * sqrtPriceX96) / Number(Q192);
    // XIDR is token0 (0 decimals), USDC is token1 (6 decimals)
    // priceNum = USDC_raw / XIDR_raw → human IDR/USDC = 1 / (priceNum * 1e6)
    const idrPerUsdc = priceNum > 0 ? 1 / (priceNum * 1e6) : 0;

    parsedOnChain = {
      sqrtPriceX96,
      tick:       slot0[1] as number,
      liquidity,
      feeGrowth0: fg0,
      feeGrowth1: fg1,
      idrPerUsdc,
    };
  }

  // Historical data from The Graph
  const { data: history, isLoading: historyLoading } = useQuery({
    queryKey: ["poolDayData", chainId, poolAddress],
    queryFn:  () => fetchPoolDayData(subgraphUrl, poolAddress),
    staleTime: 5 * 60_000, // 5 min
    enabled:   !!subgraphUrl,
  });

  return {
    poolAddress,
    onChain:        parsedOnChain,
    history:        history ?? [],
    isLoading:      onChainLoading || historyLoading,
    latestTvlUSD:   history?.[0]?.tvlUSD,
    latestVolumeUSD: history?.[0]?.volumeUSD,
  };
}
