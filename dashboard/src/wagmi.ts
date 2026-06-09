/**
 * wagmi + viem configuration.
 *
 * Supports Base Mainnet and Base Sepolia.
 * Connectors: MetaMask, Coinbase Wallet, WalletConnect.
 */
import { createConfig, http } from "wagmi";
import { base, baseSepolia } from "wagmi/chains";
import { coinbaseWallet, injected, walletConnect } from "wagmi/connectors";

const WALLETCONNECT_PROJECT_ID =
  import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? "YOUR_PROJECT_ID";

export const config = createConfig({
  chains: [base, baseSepolia],
  connectors: [
    injected(),                                         // MetaMask / injected
    coinbaseWallet({ appName: "XIDR Dashboard" }),
    walletConnect({ projectId: WALLETCONNECT_PROJECT_ID }),
  ],
  transports: {
    [base.id]:        http(import.meta.env.VITE_BASE_RPC_URL       ?? undefined),
    [baseSepolia.id]: http(import.meta.env.VITE_BASE_SEPOLIA_RPC_URL ?? undefined),
  },
});
