# XIDR on Base

**This repo is Fix 1 of a 5-part rebuild of XIDR, StraitsX's Indonesian Rupiah stablecoin.**

Before getting into what's here, it's worth explaining why it exists.

---

## What's broken with XIDR (and why this matters)

XIDR launched in 2021 with big ambitions. Today it has less than $130K in total market value, zero daily trading volume, and doesn't appear anywhere on StraitsX's current roadmap. Meanwhile the global stablecoin market keeps growing. Something went wrong. Actually, five things went wrong.

### Problem 1: it's running on the wrong roads

Imagine building a fast food delivery business with bicycle couriers while everyone else uses motorcycles. That's XIDR on Ethereum and Zilliqa. Ethereum fees eat small transfers whole. Zilliqa is a blockchain nobody uses anymore.

StraitsX moved their other stablecoins — XSGD, XUSD — to modern, cheap chains: Base, Arbitrum, Solana. XIDR never got the upgrade.

**The fix:** Move XIDR to Base (Coinbase's L2). Fast, cheap, and where the actual DeFi activity is. Nothing else on this list can be fixed until this one is done first.

**This repo is that fix.** A new XIDR smart contract on Base, deployment scripts, and a Uniswap v3 liquidity pool so people can actually trade it.

---

### Problem 2: it has no legal home in Indonesia

XIDR is an Indonesian Rupiah token whose legal credibility comes entirely from a Singapore MAS license. OJK and Bank Indonesia — the regulators who actually matter in Indonesia — have never formally recognized it. Any Indonesian company or bank that wants to use XIDR needs to know it's clean with local regulators. Right now it isn't.

It's like opening a restaurant in Jakarta with only a Singapore food hygiene certificate. Local inspectors don't care about that.

**The fix (Fix 2, separate repo):** A compliance layer — KYC/KYB identity checks, transaction monitoring, suspicious activity reports, and a reserve attestation dashboard showing regulators exactly how many XIDR are circulating versus how much IDR sits in reserve.

---

### Problem 3: it was built for the wrong customer

XIDR launched with a story about helping Indonesia's unbanked population. Noble goal — but unbanked people don't self-custody ERC-20 tokens. The actual volume in stablecoin markets comes from businesses: remittance companies, crypto exchanges, fintech apps doing payouts.

XIDR never built B2B tools. No API, no bulk transfers, no developer documentation worth using. A token with no product around it.

**The fix (Fix 3, separate repo):** A proper B2B payment API so Indonesian fintechs can integrate XIDR the way they'd integrate Xendit or Midtrans. Virtual Account IDR on-ramp, Flip.id off-ramp, webhooks, a developer sandbox, SNAP-compliant authentication.

---

### Problem 4: Indonesia is missing from the map

StraitsX built a cross-border payment network connecting Singapore, Thailand, Taiwan, and Japan. Indonesia — the largest economy in Southeast Asia, and the country XIDR is literally named after — is not in it.

The Singapore-to-Indonesia corridor is enormous. Hundreds of thousands of Indonesian workers in Singapore send money home every month. That market has no XIDR product.

**The fix (Fix 4, separate repo):** A SG-to-ID remittance corridor. Sender in Singapore pays in SGD, it converts to XIDR on-chain, recipient in Indonesia gets IDR to their bank account or GoPay/OVO/DANA wallet. Automatic FX conversion, real-time settlement, transparent rates.

---

### Problem 5: nobody has a reason to hold it

Even if all four problems above get fixed, you still need liquidity. People and protocols need to hold XIDR for it to work as a real currency. There's no incentive to hold XIDR over keeping IDR in a bank. On-chain, there are no trading pools with meaningful depth, so DeFi protocols won't integrate it.

**The fix (Fix 5, runs parallel to Fix 1):** Seed a Uniswap v3 pool on Base with XIDR/USDC for real tradable depth, plus a yield/float incentive for B2B partners — fintechs that keep XIDR float on their platform earn yield on it. Integrators become liquidity holders.

---

### Why the order matters

Everything flows from Fix 1. You can't run compliance on-chain without a modern chain. You can't build a B2B API without the compliance layer. You can't build the corridor without the B2B API as the payout backbone. You can't seed liquidity without the Base pool existing first.

```
Fix 1: New Chain (Base)          ← this repo
  ├── Fix 2: Compliance Layer
  │     └── Fix 3: B2B API
  │           └── Fix 4: SG↔ID Corridor
  └── Fix 5: Liquidity Pool      ← parallel track after Fix 1
```

---

## What's in this repo (Fix 1)

### Smart contract: `contracts/XIdrToken.sol`

Solidity 0.8.24, OpenZeppelin 5.x UUPS proxy pattern.

- **Name:** StraitsX Indonesian Rupiah
- **Symbol:** XIDR
- **Decimals:** 0 — 1 XIDR = 1 IDR. IDR has no fractional unit.
- **Roles:**
  - `DEFAULT_ADMIN_ROLE` — grants/revokes roles, authorizes upgrades
  - `MINTER_ROLE` — mints XIDR (restricted to the reserve custodian)
  - `PAUSER_ROLE` — pauses/unpauses transfers (emergency or compliance freeze)
  - `BLOCKLIST_ROLE` — adds/removes addresses from the AML blocklist
- **Mint cap** — configurable maximum supply, updatable by admin
- **Blocklist** — blocked addresses cannot send or receive. Enforced in `_update()`.
- **Upgradeable** — UUPS proxy; upgrading requires `DEFAULT_ADMIN_ROLE`

### Deployment scripts

| Script | What it does |
|--------|-------------|
| `scripts/deploy.ts` | Deploy to Base Sepolia. Idempotent. Auto-verifies on Basescan. Writes `deployments/base-sepolia.json`. |
| `scripts/deploy-mainnet.ts` | Same, for Base Mainnet. Prompts for confirmation before broadcasting. |
| `scripts/upgrade.ts` | Deploys a new implementation and upgrades the proxy via UUPS. Verifies on Basescan. |
| `scripts/seed-liquidity.ts` | Creates a XIDR/USDC Uniswap v3 pool on Base (fee tier 500, 0.05%). Seeds 100M XIDR at ~15,900 IDR/USDC within a ±2% price range. |

### Tests

`test/XIdrToken.test.ts` — 50 tests, all passing.

Covers: deployment, minting, burning/redeem, pause, blocklist, mint cap, upgrade, transfers, and all custom events.

---

## Setup

### Prerequisites

- Node.js 18+
- An account with ETH on Base Sepolia (get testnet ETH from the [Base faucet](https://www.coinbase.com/faucets/base-ethereum-goerli-faucet))
- A Basescan API key for contract verification

### Install

```bash
cd xidr-base
npm install
```

### Configure

```bash
cp .env.example .env
```

Fill in `.env`:

```
PRIVATE_KEY=your_deployer_private_key
BASESCAN_API_KEY=your_basescan_api_key
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
BASE_MAINNET_RPC_URL=https://mainnet.base.org
ADMIN_ADDRESS=0x...
MINTER_ADDRESS=0x...
PAUSER_ADDRESS=0x...
```

### Compile

```bash
npm run compile
```

### Test

```bash
npm test
```

### Deploy to Base Sepolia

```bash
npm run deploy:testnet
```

Outputs `deployments/base-sepolia.json` with proxy and implementation addresses.

### Deploy to Base Mainnet

```bash
npm run deploy:mainnet
```

Will prompt: `You are about to deploy to BASE MAINNET. Type 'yes' to proceed.`

### Upgrade the contract

```bash
npm run upgrade -- --network base-sepolia
```

### Seed Uniswap v3 liquidity (mainnet only)

```bash
npm run seed
```

Reads `deployments/base-mainnet.json` for the proxy address. Outputs `deployments/liquidity-position.json` with the LP token ID and position details.

---

## Contract addresses

Auto-generated at deploy time. After running the deploy script:

- Base Sepolia: `deployments/base-sepolia.json`
- Base Mainnet: `deployments/base-mainnet.json`

These files are gitignored. The deployer is responsible for storing them securely.

---

## Tech stack

- Solidity 0.8.24
- OpenZeppelin Contracts Upgradeable 5.x (UUPS proxy)
- Hardhat with TypeScript
- ethers v6
- Base Mainnet (chainId 8453) / Base Sepolia (chainId 84532)
- Uniswap v3 on Base for XIDR/USDC pool

---

## Functional requirements

| ID | Requirement |
|----|-------------|
| FR-001 | XIDR minting is restricted to `MINTER_ROLE` only |
| FR-002 | Blocked addresses cannot send or receive XIDR transfers |
| FR-003 | Contract is pausable by `PAUSER_ROLE` for emergency stops |
| FR-004 | Contract is upgradeable via UUPS proxy without losing state |
| FR-005 | Mint cap is enforced and configurable post-deploy |
| FR-006 | All deployments auto-verify on Basescan |
| FR-007 | Liquidity pool seeded at deploy time via seed script |
| FR-008 | Test coverage >= 95% |

---

## Out of scope for this repo

- Ethereum legacy bridge (Fix 2 dependency)
- KYC/KYB compliance layer (Fix 2)
- B2B payment API (Fix 3)
- SG to ID remittance corridor (Fix 4)
- B2B float yield contracts (Fix 5)
- Any frontend
