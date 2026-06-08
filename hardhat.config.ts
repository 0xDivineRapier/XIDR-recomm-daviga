import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@openzeppelin/hardhat-upgrades";
import "dotenv/config";

const PRIVATE_KEY = process.env.PRIVATE_KEY ?? "0x" + "0".repeat(64);
const BASESCAN_API_KEY = process.env.BASESCAN_API_KEY ?? "";
const BASE_SEPOLIA_RPC_URL = process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org";
const BASE_MAINNET_RPC_URL = process.env.BASE_MAINNET_RPC_URL ?? "https://mainnet.base.org";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      evmVersion: "cancun",
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    "base-sepolia": {
      url: BASE_SEPOLIA_RPC_URL,
      chainId: 84532,
      accounts: [PRIVATE_KEY],
    },
    "base-mainnet": {
      url: BASE_MAINNET_RPC_URL,
      chainId: 8453,
      accounts: [PRIVATE_KEY],
    },
  },
  etherscan: {
    apiKey: {
      "base-sepolia": BASESCAN_API_KEY,
      "base-mainnet": BASESCAN_API_KEY,
    },
    customChains: [
      {
        network: "base-sepolia",
        chainId: 84532,
        urls: {
          apiURL: "https://api-sepolia.basescan.org/api",
          browserURL: "https://sepolia.basescan.org",
        },
      },
      {
        network: "base-mainnet",
        chainId: 8453,
        urls: {
          apiURL: "https://api.basescan.org/api",
          browserURL: "https://basescan.org",
        },
      },
    ],
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  typechain: {
    outDir: "typechain-types",
    target: "viem-v2",
  },
};

export default config;
