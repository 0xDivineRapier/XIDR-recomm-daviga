import { createPublicClient, http, parseAbi } from 'viem';
import { base, baseSepolia } from 'viem/chains';

const XIDR_ABI = parseAbi([
  'function totalSupply() view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
]);

export class ReserveService {
  private client;
  private contractAddress: `0x${string}`;

  constructor() {
    const isTestnet = process.env.NODE_ENV !== 'production';
    this.contractAddress = (process.env.XIDR_CONTRACT_ADDRESS || '0x0') as `0x${string}`;
    this.client = createPublicClient({
      chain: isTestnet ? baseSepolia : base,
      transport: http(isTestnet ? process.env.BASE_SEPOLIA_RPC_URL : process.env.BASE_MAINNET_RPC_URL),
    });
  }

  async getTotalSupply(): Promise<{ totalSupply: bigint; blockNumber: bigint; timestamp: number }> {
    const [totalSupply, block] = await Promise.all([
      this.client.readContract({
        address: this.contractAddress,
        abi: XIDR_ABI,
        functionName: 'totalSupply',
      }),
      this.client.getBlock(),
    ]);
    return {
      totalSupply: totalSupply as bigint,
      blockNumber: block.number,
      timestamp: Number(block.timestamp),
    };
  }

  async getBalanceOf(address: `0x${string}`): Promise<bigint> {
    return this.client.readContract({
      address: this.contractAddress,
      abi: XIDR_ABI,
      functionName: 'balanceOf',
      args: [address],
    }) as Promise<bigint>;
  }
}

export const reserveService = new ReserveService();
