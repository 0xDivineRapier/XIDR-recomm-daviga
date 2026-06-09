import { createPublicClient, createWalletClient, http, parseAbi, encodeFunctionData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia } from 'viem/chains';

const SWAP_ROUTER_ABI = parseAbi([
  'function exactInput(tuple(bytes path, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum) params) external payable returns (uint256 amountOut)',
  'function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) external payable returns (uint256 amountOut)',
]);

const ERC20_ABI = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
]);

// Uniswap SwapRouter02 on Base
const SWAP_ROUTER = '0x2626664c2603336E57B271c5C0b26F421741e481' as const;

// Known token addresses on Base (mainnet)
const TOKENS = {
  XSGD: (process.env.XSGD_ADDRESS || '0x0fD0a0fd4eB2f5Da7c66A2A2E76C1B22D1739F6d') as `0x${string}`,
  USDC: (process.env.USDC_ADDRESS || '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913') as `0x${string}`,
  XIDR: (process.env.XIDR_CONTRACT_ADDRESS || '0x0000000000000000000000000000000000000001') as `0x${string}`,
};

export class SwapService {
  private publicClient;
  private walletClient;
  private corridorAddress: `0x${string}`;

  constructor() {
    const isTestnet = process.env.NODE_ENV !== 'production';
    const chain = isTestnet ? baseSepolia : base;
    const rpc = isTestnet ? process.env.BASE_SEPOLIA_RPC_URL : process.env.BASE_MAINNET_RPC_URL;
    const account = privateKeyToAccount(
      (process.env.CORRIDOR_WALLET_PRIVATE_KEY || '0x' + '1'.repeat(64)) as `0x${string}`
    );
    this.corridorAddress = account.address;
    this.publicClient = createPublicClient({ chain, transport: http(rpc) });
    this.walletClient = createWalletClient({ account, chain, transport: http(rpc) });
  }

  async executeSwap(params: {
    transferId: string;
    xsgdAmount: bigint;
    minXidrOut: bigint;
    deadline: number;
  }): Promise<{ txHash: string; xidrReceived: bigint }> {
    // Approve SwapRouter to spend XSGD
    const approveTx = await this.walletClient.writeContract({
      address: TOKENS.XSGD,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [SWAP_ROUTER, params.xsgdAmount],
    });
    await this.publicClient.waitForTransactionReceipt({ hash: approveTx });

    // Two-hop: XSGD → USDC → XIDR
    // Encode path: tokenIn (XSGD) + fee + tokenMid (USDC) + fee + tokenOut (XIDR)
    const path = encodePath([TOKENS.XSGD, TOKENS.USDC, TOKENS.XIDR], [500, 500]);

    const xidrBefore = await this.publicClient.readContract({
      address: TOKENS.XIDR,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [this.corridorAddress],
    }) as bigint;

    const swapTx = await this.walletClient.writeContract({
      address: SWAP_ROUTER,
      abi: SWAP_ROUTER_ABI,
      functionName: 'exactInput',
      args: [{
        path,
        recipient: this.corridorAddress,
        deadline: BigInt(params.deadline),
        amountIn: params.xsgdAmount,
        amountOutMinimum: params.minXidrOut,
      }],
    });
    await this.publicClient.waitForTransactionReceipt({ hash: swapTx });

    const xidrAfter = await this.publicClient.readContract({
      address: TOKENS.XIDR,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [this.corridorAddress],
    }) as bigint;

    const xidrReceived = xidrAfter - xidrBefore;
    return { txHash: swapTx, xidrReceived };
  }

  getCorridorAddress(): `0x${string}` {
    return this.corridorAddress;
  }
}

// Encode Uniswap v3 multi-hop path
function encodePath(tokens: `0x${string}`[], fees: number[]): `0x${string}` {
  let encoded = tokens[0].slice(2);
  for (let i = 0; i < fees.length; i++) {
    encoded += fees[i].toString(16).padStart(6, '0');
    encoded += tokens[i + 1].slice(2);
  }
  return ('0x' + encoded) as `0x${string}`;
}

export const swapService = new SwapService();
