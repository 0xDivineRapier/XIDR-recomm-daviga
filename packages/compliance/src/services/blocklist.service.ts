import { createPublicClient, createWalletClient, http, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia } from 'viem/chains';

const XIDR_ABI = parseAbi([
  'function blockAddress(address account) external',
  'function unblockAddress(address account) external',
  'function blocked(address) view returns (bool)',
]);

export class BlocklistService {
  private publicClient;
  private walletClient: ReturnType<typeof createWalletClient> | null = null;
  private contractAddress: `0x${string}`;

  constructor() {
    const isTestnet = process.env.NODE_ENV !== 'production';
    const chain = isTestnet ? baseSepolia : base;
    const rpcUrl = isTestnet ? process.env.BASE_SEPOLIA_RPC_URL : process.env.BASE_MAINNET_RPC_URL;
    this.contractAddress = (process.env.XIDR_CONTRACT_ADDRESS || '0x0') as `0x${string}`;
    this.publicClient = createPublicClient({ chain, transport: http(rpcUrl) });

    // Only create wallet client if private key is set
    const privateKey = process.env.COMPLIANCE_SIGNER_PRIVATE_KEY;
    if (privateKey) {
      try {
        const account = privateKeyToAccount(privateKey as `0x${string}`);
        this.walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });
      } catch (e) {
        console.warn('[blocklist] Failed to create wallet client — COMPLIANCE_SIGNER_PRIVATE_KEY may be invalid');
      }
    } else {
      console.warn('[blocklist] COMPLIANCE_SIGNER_PRIVATE_KEY not set — write operations will fail at call time');
    }
  }

  private getWalletClient() {
    if (!this.walletClient) {
      throw new Error('COMPLIANCE_SIGNER_PRIVATE_KEY is not configured');
    }
    return this.walletClient;
  }

  async blockAddress(walletAddress: string): Promise<string> {
    const wc = this.getWalletClient();
    const hash = await wc.writeContract({
      address: this.contractAddress,
      abi: XIDR_ABI,
      functionName: 'blockAddress',
      args: [walletAddress as `0x${string}`],
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  async unblockAddress(walletAddress: string): Promise<string> {
    const wc = this.getWalletClient();
    const hash = await wc.writeContract({
      address: this.contractAddress,
      abi: XIDR_ABI,
      functionName: 'unblockAddress',
      args: [walletAddress as `0x${string}`],
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  async isBlocked(walletAddress: string): Promise<boolean> {
    return this.publicClient.readContract({
      address: this.contractAddress,
      abi: XIDR_ABI,
      functionName: 'blocked',
      args: [walletAddress as `0x${string}`],
    }) as Promise<boolean>;
  }
}

export const blocklistService = new BlocklistService();
