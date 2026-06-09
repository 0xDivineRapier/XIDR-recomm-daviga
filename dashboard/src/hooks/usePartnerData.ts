/**
 * usePartnerData — reads partner-specific stake and claimable yield from
 * FloatIncentive, and provides a claimYield write function.
 */
import { useReadContracts, useWriteContract, useChainId, useAccount } from "wagmi";
import { base, baseSepolia } from "wagmi/chains";

const FLOAT_INCENTIVE_ADDRESSES: Record<number, `0x${string}`> = {
  [base.id]:        (import.meta.env.VITE_FLOAT_INCENTIVE_ADDRESS_MAINNET
    ?? "0x0000000000000000000000000000000000000000") as `0x${string}`,
  [baseSepolia.id]: (import.meta.env.VITE_FLOAT_INCENTIVE_ADDRESS_SEPOLIA
    ?? "0x0000000000000000000000000000000000000000") as `0x${string}`,
};

const FLOAT_INCENTIVE_ABI = [
  {
    name: "stakes",
    type: "function",
    stateMutability: "view",
    inputs:  [{ name: "wallet", type: "address" }],
    outputs: [
      { name: "wallet",       type: "address" },
      { name: "stakedAt",     type: "uint256" },
      { name: "lastClaimAt",  type: "uint256" },
      { name: "accruedYield", type: "uint256" },
      { name: "isActive",     type: "bool"    },
    ],
  },
  {
    name: "getClaimableYield",
    type: "function",
    stateMutability: "view",
    inputs:  [{ name: "wallet", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "claimYield",
    type: "function",
    stateMutability: "nonpayable",
    inputs:  [],
    outputs: [],
  },
] as const;

export interface PartnerStake {
  wallet:       `0x${string}`;
  stakedAt:     bigint;
  lastClaimAt:  bigint;
  accruedYield: bigint;
  isActive:     boolean;
}

export function usePartnerData() {
  const chainId = useChainId();
  const { address: walletAddress } = useAccount();
  const contractAddress = FLOAT_INCENTIVE_ADDRESSES[chainId]
    ?? "0x0000000000000000000000000000000000000000";

  const enabled =
    !!walletAddress &&
    contractAddress !== "0x0000000000000000000000000000000000000000";

  const { data, isLoading, refetch } = useReadContracts({
    contracts: [
      {
        address:      contractAddress,
        abi:          FLOAT_INCENTIVE_ABI,
        functionName: "stakes",
        args:         [walletAddress ?? "0x0000000000000000000000000000000000000000"],
      },
      {
        address:      contractAddress,
        abi:          FLOAT_INCENTIVE_ABI,
        functionName: "getClaimableYield",
        args:         [walletAddress ?? "0x0000000000000000000000000000000000000000"],
      },
    ],
    query: {
      enabled,
      refetchInterval: 15_000,
    },
  });

  const stakeRaw = data?.[0]?.result as readonly [
    `0x${string}`, bigint, bigint, bigint, boolean
  ] | undefined;

  const stake: PartnerStake | undefined = stakeRaw
    ? {
        wallet:       stakeRaw[0],
        stakedAt:     stakeRaw[1],
        lastClaimAt:  stakeRaw[2],
        accruedYield: stakeRaw[3],
        isActive:     stakeRaw[4],
      }
    : undefined;

  const claimableYield = data?.[1]?.result as bigint | undefined;

  // Write: claimYield
  const { writeContract, isPending: isClaiming, data: claimTxHash } = useWriteContract();

  function claimYield() {
    writeContract({
      address:      contractAddress,
      abi:          FLOAT_INCENTIVE_ABI,
      functionName: "claimYield",
    });
  }

  return {
    stake,
    claimableYield,
    isLoading,
    isClaiming,
    claimTxHash,
    claimYield,
    refetch,
    isRegistered: stake !== undefined && stake.stakedAt > 0n,
    isActive:     stake?.isActive ?? false,
  };
}
