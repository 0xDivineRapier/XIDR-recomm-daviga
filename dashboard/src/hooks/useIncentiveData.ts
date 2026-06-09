/**
 * useIncentiveData — reads FloatIncentive contract state on-chain.
 */
import { useReadContracts, useChainId } from "wagmi";
import { base, baseSepolia } from "wagmi/chains";

const FLOAT_INCENTIVE_ADDRESSES: Record<number, `0x${string}`> = {
  [base.id]:        (import.meta.env.VITE_FLOAT_INCENTIVE_ADDRESS_MAINNET
    ?? import.meta.env.NEXT_PUBLIC_FLOAT_INCENTIVE_ADDRESS
    ?? "0x0000000000000000000000000000000000000000") as `0x${string}`,
  [baseSepolia.id]: (import.meta.env.VITE_FLOAT_INCENTIVE_ADDRESS_SEPOLIA
    ?? import.meta.env.NEXT_PUBLIC_FLOAT_INCENTIVE_ADDRESS
    ?? "0x0000000000000000000000000000000000000000") as `0x${string}`,
};

const FLOAT_INCENTIVE_ABI = [
  {
    name: "apyBps",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "minimumFloat",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getPartnerCount",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getTreasuryBalance",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "paused",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export interface IncentiveData {
  address:        `0x${string}`;
  apyBps:         bigint;
  apyPercent:     number;
  minimumFloat:   bigint;
  partnerCount:   bigint;
  treasuryBalance: bigint;
  isPaused:       boolean;
}

export function useIncentiveData() {
  const chainId = useChainId();
  const address = FLOAT_INCENTIVE_ADDRESSES[chainId]
    ?? "0x0000000000000000000000000000000000000000";

  const enabled = address !== "0x0000000000000000000000000000000000000000";

  const { data, isLoading, error } = useReadContracts({
    contracts: [
      { address, abi: FLOAT_INCENTIVE_ABI, functionName: "apyBps"            },
      { address, abi: FLOAT_INCENTIVE_ABI, functionName: "minimumFloat"       },
      { address, abi: FLOAT_INCENTIVE_ABI, functionName: "getPartnerCount"    },
      { address, abi: FLOAT_INCENTIVE_ABI, functionName: "getTreasuryBalance" },
      { address, abi: FLOAT_INCENTIVE_ABI, functionName: "paused"             },
    ],
    query: {
      enabled,
      refetchInterval: 30_000, // 30 s
    },
  });

  let parsed: IncentiveData | undefined;
  if (data && data.every((d) => d.status === "success")) {
    const apyBps = data[0].result as bigint;
    parsed = {
      address,
      apyBps,
      apyPercent:     Number(apyBps) / 100,
      minimumFloat:   data[1].result as bigint,
      partnerCount:   data[2].result as bigint,
      treasuryBalance: data[3].result as bigint,
      isPaused:       data[4].result as boolean,
    };
  }

  return { data: parsed, isLoading, error, address, enabled };
}
