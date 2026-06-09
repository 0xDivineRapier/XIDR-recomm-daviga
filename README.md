# XIDR on Base

**This repo is a 5-part rebuild of XIDR, StraitsX's Indonesian Rupiah stablecoin.**

Before getting into what's here, it's worth explaining why it exists.

---

## What's broken with XIDR (and why this matters)

XIDR launched in 2021 with big ambitions. Today it has less than $130K in total market value, zero daily trading volume, and doesn't appear anywhere on StraitsX's current roadmap. Meanwhile the global stablecoin market keeps growing. Something went wrong. Actually, five things went wrong.

### Problem 1: it's running on the wrong roads

Imagine building a fast food delivery business with bicycle couriers while everyone else uses motorcycles. That's XIDR on Ethereum and Zilliqa. Ethereum fees eat small transfers whole. Zilliqa is a blockchain nobody uses anymore.

StraitsX moved their other stablecoins — XSGD, XUSD — to modern, cheap chains: Base, Arbitrum, Solana. XIDR never got the upgrade.

**The fix:** Move XIDR to Base (Coinbase's L2). Fast, cheap, and where the actual DeFi activity is. Nothing else on this list can be fixed until this one is done first.

---

### Problem 2: it has no legal home in Indonesia

XIDR is an Indonesian Rupiah token whose legal credibility comes entirely from a Singapore MAS license. OJK and Bank Indonesia — the regulators who actually matter in Indonesia — have never formally recognized it. Any Indonesian company or bank that wants to use XIDR needs to know it's clean with local regulators. Right now it isn't.

It's like opening a restaurant in Jakarta with only a Singapore food hygiene certificate. Local inspectors don't care about that.

**The fix:** A compliance layer — KYC/KYB identity checks, transaction monitoring, suspicious activity reports, and a reserve attestation dashboard showing regulators exactly how many XIDR are circulating versus how much IDR sits in reserve.

---

### Problem 3: it was built for the wrong customer

XIDR launched with a story about helping Indonesia's unbanked population. Noble goal — but unbanked people don't self-custody ERC-20 tokens. The actual volume in stablecoin markets comes from businesses: remittance companies, crypto exchanges, fintech apps doing payouts.

XIDR never built B2B tools. No API, no bulk transfers, no developer documentation worth using. A token with no product around it.

**The fix (Fix 3, coming):** A proper B2B payment API so Indonesian fintechs can integrate XIDR the way they'd integrate Xendit or Midtrans. Virtual Account IDR on-ramp, Flip.id off-ramp, webhooks, a developer sandbox, SNAP-compliant authentication.

---

### Problem 4: Indonesia is missing from the map

StraitsX built a cross-border payment network connecting Singapore, Thailand, Taiwan, and Japan. Indonesia — the largest economy in Southeast Asia, and the country XIDR is literally named after — is not in it.

**The fix (Fix 4, coming):** A SG-to-ID remittance corridor. Sender in Singapore pays in SGD, it converts to XIDR on-chain, recipient in Indonesia gets IDR to their bank account or GoPay/OVO/DANA wallet.

---

### Problem 5: nobody has a reason to hold it

Even if all four problems above get fixed, you still need liquidity. There are no trading pools with meaningful depth, so DeFi protocols won't integrate it.

**The fix (Fix 5, parallel track):** Seed a Uniswap v3 pool on Base with XIDR/USDC for real tradable depth, plus a yield/float incentive for B2B partners.

---

### Why the order matters

```
Fix 1: New Chain (Base)          ✅ complete
  ├── Fix 2: Compliance Layer    ✅ complete — packages/compliance/
  │     └── Fix 3: B2B API       ✅ complete — (see idrxpay repo)
  │           └── Fix 4: SG↔ID Corridor   ✅ complete — packages/corridor/
  └── Fix 5: Liquidity Pool      ✅ complete — contracts/ + scripts/ + dashboard/
```

---

## Repo structure

```
xidr-base/
├── contracts/
│   ├── XIdrToken.sol          # Fix 1 — UUPS ERC-20, 0 decimals, role-based AML blocklist
│   └── FloatIncentive.sol     # Fix 5 — UUPS yield contract for B2B float holders
├── scripts/
│   ├── deploy.ts              # Deploy XIdrToken proxy (Sepolia)
│   ├── deploy-mainnet.ts      # Deploy XIdrToken proxy (Mainnet)
│   ├── upgrade.ts             # UUPS upgrade
│   ├── seed-liquidity.ts      # Fix 5 — seed XIDR/USDC Uniswap v3 pool (idempotent)
│   ├── manage-pool.ts         # Fix 5 — add-liquidity / collect-fees / rebalance / pool-stats
│   ├── deploy-float-incentive.ts  # Fix 5 — deploy FloatIncentive proxy + fund treasury
│   └── keeper.ts              # Fix 5 — cron bot: accrue yield, treasury check, collect fees
├── test/
│   ├── XIdrToken.test.ts      # 50 tests
│   ├── FloatIncentive.test.ts # 37 tests
│   └── pool.test.ts           # 12 math helper tests
├── dashboard/                 # Fix 5 — React liquidity dashboard
│   ├── src/
│   │   ├── components/        # PoolStats, IncentiveStats, PartnerDashboard, RateChart, TVLChart
│   │   ├── hooks/             # usePoolData, useIncentiveData, usePartnerData
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   └── wagmi.ts           # wagmi v2 + viem config
│   ├── index.html
│   ├── vite.config.ts
│   └── package.json
├── packages/
│   ├── compliance/            # Fix 2 — compliance service (KYC, AML, reserves)
│   └── corridor/              # Fix 4 — SG↔ID remittance corridor
│       ├── apps/api/          # Fastify corridor API
│       └── apps/web/          # Next.js sender UI
└── deployments/               # gitignored — written at deploy time
    ├── base-sepolia.json       # proxy, pool, floatIncentive addresses
    └── base-mainnet.json
```

---

## Fix 1 — Smart Contract (`contracts/XIdrToken.sol`)

Solidity 0.8.24, OpenZeppelin 5.x UUPS proxy pattern.

| Property | Value |
|---|---|
| Name | StraitsX Indonesian Rupiah |
| Symbol | XIDR |
| Decimals | 0 (1 XIDR = 1 IDR) |
| Chain | Base Mainnet (8453) / Base Sepolia (84532) |

**Roles:**

| Role | Holder | Capability |
|---|---|---|
| `DEFAULT_ADMIN_ROLE` | Multisig | Grant/revoke roles, authorize upgrades, set mint cap |
| `MINTER_ROLE` | Reserve custodian | Mint XIDR up to cap |
| `PAUSER_ROLE` | Compliance officer | Emergency pause/unpause all transfers |
| `BLOCKLIST_ROLE` | AML officer / compliance service | Block/unblock addresses |

**Key functions:** `mint`, `redeem`, `blockAddress`, `unblockAddress`, `pause`, `unpause`, `updateMintCap`

### Fix 1 setup

```bash
npm install
cp .env.example .env   # fill in PRIVATE_KEY, BASESCAN_API_KEY, role addresses
npm run compile
npm test               # 50 tests
npm run deploy:testnet # → deployments/base-sepolia.json
npm run deploy:mainnet # → deployments/base-mainnet.json (prompts for confirmation)
npm run upgrade        # upgrades UUPS proxy
npm run seed           # seeds Uniswap v3 XIDR/USDC pool
```

---

## Fix 2 — Compliance Layer (`packages/compliance/`)

The compliance infrastructure that makes XIDR trustworthy to OJK, Bank Indonesia, and institutional B2B customers. Without this layer, no Indonesian fintech, bank, or exchange will integrate XIDR.

### Components

| Component | Description |
|---|---|
| KYC/KYB service | Persona-hosted identity verification for individuals and businesses |
| Transaction monitoring | Chainalysis KYT webhook receiver — AML screening with risk scores |
| Reserve attestation | Public dashboard proving XIDR supply = IDR reserves, with SHA256 integrity hash |
| Compliance admin panel | Internal React SPA for the compliance team |

### Tech stack

- **Runtime:** Node.js 20 + TypeScript (NodeNext modules)
- **Framework:** Fastify 4.x
- **Database:** PostgreSQL 15 via Drizzle ORM
- **Queue:** BullMQ + Redis for async compliance jobs
- **Blockchain reads/writes:** viem v2 (reads `totalSupply`, writes `blockAddress`/`unblockAddress` on XIdrToken)
- **KYC provider:** [Persona](https://withpersona.com) hosted verification flow
- **AML screening:** Chainalysis KYT webhook receiver
- **Email:** Nodemailer (compliance alerts)
- **Auth:** JWT + Bank Indonesia SNAP two-phase auth (asymmetric RSA + symmetric HMAC-SHA512)
- **Frontend:** React 18 + Tailwind CSS

### Database schema

| Table | Purpose |
|---|---|
| `users` | Accounts with role (`individual`, `business`, `admin`) and KYC status |
| `kyc_submissions` | Persona inquiry records with raw webhook payloads |
| `transactions` | XIDR on-chain transactions with AML status and risk scores |
| `aml_alerts` | Chainalysis alerts — severity, assignment, resolution tracking |
| `reserve_attestations` | Timestamped supply vs. reserve records with attestation hash |
| `blocklist_sync_log` | Audit trail of every on-chain block/unblock action |

### API surface

**KYC**
```
POST /v1/kyc/individual/start      Start Persona individual verification → returns hosted flow URL
POST /v1/kyc/business/start        Start Persona KYB flow
GET  /v1/kyc/status                Current KYC status for authenticated user
GET  /v1/kyc/submissions           Admin: paginated submission queue
PATCH /v1/kyc/submissions/:id/review  Admin: approve or reject with reason
```

**Webhooks** (signature-verified, return 200 immediately, process async)
```
POST /webhooks/persona             Persona events: inquiry.approved → update DB + enqueue job
POST /webhooks/chainalysis         KYT alerts → create aml_alert, enqueue screening job
```

**Transactions & AML**
```
GET  /v1/transactions              Paginated XIDR transactions with AML status filters
GET  /v1/transactions/:tx_hash     Transaction detail with alert history
POST /v1/transactions/screen       Admin: manually trigger Chainalysis screening
GET  /v1/transactions/alerts       Admin: paginated AML alert queue
PATCH /v1/transactions/alerts/:id  Admin: update alert status, assign, resolve
```

**Reserves** (public — no auth required)
```
GET /v1/reserves/latest            Latest attestation — supply, reserves, ratio, hash
GET /v1/reserves/history           Paginated attestation history
POST /v1/reserves/attest           Admin: read live totalSupply via viem, compute SHA256 hash, save
GET  /v1/reserves/live-supply      Admin: real-time totalSupply from Base
```

**Admin**
```
POST   /v1/admin/blocklist              Block wallet on-chain + log to DB
DELETE /v1/admin/blocklist/:address     Unblock wallet on-chain + log
GET    /v1/admin/blocklist              Paginated blocked address list
GET    /v1/admin/dashboard-stats        Aggregate stats for admin dashboard
```

**Auth**
```
POST /v1/auth/login              Email/password → JWT
POST /v1/auth/access-token       SNAP Phase 1 — asymmetric RSA signature → short-lived token
```

### SNAP authentication

Bank Indonesia's SNAP standard requires two-phase auth on all B2B routes:

- **Phase 1 (asymmetric):** Client signs `clientKey|timestamp` with their RSA private key. Server verifies with client's public key. Returns a 15-minute access token.
- **Phase 2 (symmetric):** Client signs `METHOD:path:accessToken:sha256(body):timestamp` with HMAC-SHA512. Server verifies on every request.

### Workers (BullMQ)

| Worker | Trigger | Action |
|---|---|---|
| `kyc-review` | Persona `inquiry.approved` webhook | Fetch full inquiry from Persona, mark user approved, send welcome email |
| `aml-screening` | Chainalysis alert or manual screen | Register tx with Chainalysis, update risk score; auto-block wallet on-chain if score > 90 |
| `reserve-sync` | Every hour (recurring job) | Compare live `totalSupply()` to last attestation; email team if >1% drift |

### Functional requirements

| ID | Requirement | Status |
|---|---|---|
| FR-001 | Individual and business KYC via Persona hosted flow | ✅ |
| FR-002 | All webhooks verified by signature before processing | ✅ |
| FR-003 | High/critical AML alerts trigger immediate compliance team email | ✅ |
| FR-004 | Critical AML alerts auto-block the offending wallet address on-chain | ✅ |
| FR-005 | Reserve attestation publicly accessible with SHA256 integrity hash | ✅ |
| FR-006 | SNAP-compliant auth on all B2B-facing routes | ✅ |
| FR-007 | All webhook endpoints return 200 immediately; processing is async | ✅ |
| FR-008 | Admin panel shows live reserve ratio with color-coded health indicator | ✅ |
| FR-009 | Reserve sync worker alerts team when supply changes >1% without re-attestation | ✅ |

### Fix 2 setup

**Prerequisites:** Docker + Docker Compose, Node.js 20+

```bash
cd packages/compliance
cp .env.example .env   # fill in credentials (see below)
npm install
docker-compose up -d postgres redis
npm run db:migrate
npm run dev            # API on :3001
npm run dev:worker     # Workers in separate terminal
npm test               # 19 tests, all passing
```

**Environment variables (`.env`):**

```bash
# Database + Redis
DATABASE_URL=postgresql://postgres:password@localhost:5432/xidr_compliance
REDIS_URL=redis://localhost:6379

# JWT
JWT_SECRET=<min 32 chars>

# Persona KYC
PERSONA_API_KEY=
PERSONA_INDIVIDUAL_TEMPLATE_ID=tmpl_...
PERSONA_BUSINESS_TEMPLATE_ID=tmpl_...
PERSONA_WEBHOOK_SECRET=

# Chainalysis KYT
CHAINALYSIS_API_KEY=
CHAINALYSIS_WEBHOOK_SECRET=

# Blockchain (from Fix 1 deployment)
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
XIDR_CONTRACT_ADDRESS=      # from deployments/base-sepolia.json
COMPLIANCE_SIGNER_PRIVATE_KEY=  # wallet with BLOCKLIST_ROLE

# Email
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=compliance@xidr.id
SMTP_PASS=
COMPLIANCE_TEAM_EMAIL=team@xidr.id

# SNAP B2B auth
SNAP_CLIENT_PUBLIC_KEY=-----BEGIN PUBLIC KEY-----...
```

**Full Docker stack:**

```bash
docker-compose up   # postgres + redis + api + worker
```

### Project structure

```
packages/compliance/
├── src/
│   ├── api/
│   │   ├── middleware/    auth.ts, snap-auth.ts, rate-limit.ts
│   │   ├── routes/        kyc.ts, transactions.ts, reserves.ts, admin.ts, webhooks.ts
│   │   └── server.ts
│   ├── services/          kyc, aml, reserve, blocklist, notification
│   ├── workers/           kyc-review, aml-screening, reserve-sync
│   ├── jobs/queue.ts      BullMQ queue definitions + recurring reserve-sync schedule
│   ├── db/
│   │   ├── schema.ts      Drizzle table + enum definitions
│   │   └── index.ts       pg Pool + Drizzle client
│   └── frontend/
│       ├── reserve-dashboard/   Public reserve attestation page (React)
│       └── admin/               Internal compliance admin SPA (React, 6 pages)
└── test/
    ├── kyc.test.ts        (5 tests)
    ├── aml.test.ts        (4 tests)
    ├── reserve.test.ts    (4 tests)
    └── webhooks.test.ts   (6 tests)
```

---

## Fix 4 — SG↔ID Remittance Corridor (`packages/corridor/`)

The consumer-facing product that puts XIDR in front of real users: Indonesian migrant workers in Singapore sending money home. Sender pays SGD via PayNow or card; recipient in Indonesia receives IDR to their bank account, GoPay, OVO, or DANA.

### Transfer flow

```
Sender pays SGD (PayNow QR or Stripe card)
  → Stripe/PayNow webhook confirms payment
  → swap.worker: XSGD→XIDR via Uniswap v3 two-hop (XSGD→USDC→XIDR)
  → disburse.worker: calls Fix 3 /v1/redeem/request → Flip.id IDR disbursement
  → Fix 3 outbound webhook fires corridor-redeem event → status = completed
  → SMS sent to sender confirming delivery
```

### Key components

| Component | Description |
|---|---|
| FX rate service | Pyth Network price feed (SGD/USD + USD/IDR) with CoinGecko fallback, Redis-cached at 60s TTL |
| Rate lock | Quote locked for 15 minutes — sender pays locked rate even if market moves |
| PayNow QR | EMVCo-compliant SGQR string generated server-side |
| Stripe | SGD card payments with 3DS support |
| Uniswap v3 | Two-hop swap: XSGD → USDC → XIDR via 0.05% fee pools on Base |
| Disbursement | Calls Fix 3 B2B API `/v1/redeem/request` with corridor API key |
| SMS | Twilio bilingual notifications (English + Bahasa Indonesia) |
| Phone OTP auth | Twilio Verify — appropriate for TKI demographic (no email required) |

### FX fee structure (configurable via env)

```
CORRIDOR_SPREAD=0.005          # 0.5% margin on rate
CORRIDOR_FEE_FLAT_SGD=1.50    # flat per-transfer fee
CORRIDOR_FEE_PCT=0.01          # 1% of send amount
CORRIDOR_FEE_MAX_SGD=15.00    # fee cap

Example: SGD 100 → fee SGD 2.50 → recipient gets IDR 1,149,622
```

### API surface

```
POST /v1/auth/otp/send          Send OTP to Singapore number (+65 only)
POST /v1/auth/otp/verify        Verify OTP → JWT
POST /v1/auth/refresh           Refresh access token

GET  /v1/rates/current          Live SGD/IDR rate (public, <50ms from Redis)
POST /v1/rates/quote            Calculate exact transfer breakdown with fee

GET  /v1/sender/profile         Sender profile + KYC status
POST /v1/sender/kyc/start       Start Persona KYC

POST /v1/recipients             Add recipient (bank or e-wallet, verified via Flip)
GET  /v1/recipients             List saved recipients

POST /v1/transfers              Initiate transfer — returns PayNow QR or Stripe client secret
GET  /v1/transfers/:id          Poll transfer status
GET  /v1/transfers              Transfer history
POST /v1/transfers/:id/cancel   Cancel if still pending_payment
GET  /v1/transfers/track/:id    Public tracker — no auth required

POST /webhooks/paynow           PayNow payment confirmed → enqueues swap
POST /webhooks/stripe           Stripe payment → enqueues swap
POST /webhooks/corridor-redeem  Fix 3 webhook → marks transfer completed
```

### Transfer statuses (append-only)

```
pending_payment → payment_received → swapping → swap_complete → disbursing → completed
                                                                            ↘ failed (ops alert)
```

If disbursement fails after swap completes, the job does **not** retry automatically — XIDR is in the corridor wallet and the ops team resolves it manually. This prevents double-disburse.

### Functional requirements

| ID | Requirement | Status |
|---|---|---|
| FR-001 | FX rate locked for 15 min from quote — sender pays locked rate | ✅ |
| FR-002 | PayNow and Stripe both supported as SGD on-ramp | ✅ |
| FR-003 | XSGD→XIDR swap via Uniswap v3 with 0.5% slippage protection | ✅ |
| FR-004 | IDR disbursement via Fix 3 — XIDR burned before Flip payout | ✅ |
| FR-005 | Transfer expires if no payment within 30 minutes | ✅ |
| FR-006 | Sender phone KYC (Persona) required before first transfer | ✅ |
| FR-007 | SMS at payment_received and completed/failed (bilingual) | ✅ |
| FR-008 | Rate refreshes every 60s from Pyth with CoinGecko fallback | ✅ |
| FR-009 | Disbursement failure after swap: ops alert, no auto-retry | ✅ |
| FR-010 | Public transfer tracker page works without auth | ✅ |

### Fix 4 setup

```bash
cd packages/corridor/apps/api
cp .env.example .env   # fill in Stripe, Twilio, Pyth, CORRIDOR_WALLET_PRIVATE_KEY
npm install
# from project root:
docker-compose up -d postgres redis
npm run db:migrate
npm run dev            # API on :3002
npm run dev:worker
npm test               # 20 tests, all passing
```

```bash
cd packages/corridor/apps/web
npm install
npm run dev            # Next.js UI on :3000
```

### Project structure

```
packages/corridor/
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── routes/    auth, rates, sender, recipient, transfer, webhooks
│   │   │   ├── services/  fx-rate, swap, paynow, stripe, disbursement, otp, sms
│   │   │   ├── workers/   swap, disburse, rate-cache
│   │   │   ├── jobs/      queue.ts (BullMQ: corridor-swap, corridor-disburse, corridor-rate-cache)
│   │   │   └── db/        schema.ts (senders, recipients, transfers, rate_snapshots, otp_sessions)
│   │   └── test/          auth (4), rates (4), transfer (7), webhooks (5)
│   └── web/
│       ├── app/
│       │   ├── (auth)/login/    Phone OTP login
│       │   ├── (app)/send/      4-step transfer flow (amount → payment → processing → complete)
│       │   ├── (app)/history/   Transfer history
│       │   └── track/[id]/      Public transfer tracker (no auth)
│       └── components/
│           ├── RateDisplay.tsx       Live rate with 60s countdown, flash on >1% change
│           ├── PayNowQR.tsx          EMVCo QR with countdown timer, copy reference, deep link
│           └── TransferStatus.tsx    Step-by-step progress tracker
```

---

## Fix 5 — Liquidity Pool + Float Incentives (`contracts/` · `scripts/` · `dashboard/`)

Solves the cold-start liquidity problem: seeds a real Uniswap v3 XIDR/USDC pool on Base and gives B2B partners a financial reason to hold XIDR float instead of converting it immediately.

### Two mechanisms

**Uniswap v3 pool (XIDR/USDC)**

A concentrated-liquidity position centered at the live XIDR/IDR → USDC rate, with a ±5% price range. Any DeFi protocol or aggregator can route through this pool. A keeper bot monitors tick range health and triggers a rebalance when the position drifts out of range.

**FloatIncentive — B2B yield contract**

B2B partners (remittance providers, exchanges, fintechs) that integrate XIDR naturally hold a float balance. `FloatIncentive.sol` pays them continuous yield for doing so — measured from the moment they register, claimable any time.

```
yield = stakedBalance × apyBps × timeElapsed / (10_000 × 365 days)
```

Yield is paid from a treasury wallet funded at deploy time. The partner never locks tokens — they hold XIDR in their own wallet; the contract reads the live balance.

### FloatIncentive contract

`contracts/FloatIncentive.sol` — 335 lines, UUPS upgradeable, OpenZeppelin 5.x

| Property | Value |
|---|---|
| Decimals | 0 (matches XIDR) |
| Yield formula | `balance × apyBps × elapsed / (10_000 × 365 days)` |
| Default APY | 500 bps (5%) — configurable by `MANAGER_ROLE` |
| Claim pattern | CEI (checks-effects-interactions) — no re-entrancy |
| Token transfer | `SafeERC20.safeTransfer` from treasury |

**Roles:**

| Role | Capability |
|---|---|
| `DEFAULT_ADMIN_ROLE` | Grant/revoke roles, authorize upgrades |
| `MANAGER_ROLE` | Register/remove partners, set APY per partner, pause |
| `TREASURY_ROLE` | Fund and withdraw from reward treasury |

**Key functions:** `registerPartner`, `removePartner`, `claimYield`, `pendingYield`, `setPartnerApy`, `fundTreasury`, `withdrawTreasury`

**Struct:**
```solidity
struct PartnerStake {
    address wallet;
    uint256 stakedAt;
    uint256 lastClaimAt;
}
```

### Pool management CLI (`scripts/manage-pool.ts`)

```bash
npx ts-node scripts/manage-pool.ts <command> [options]

Commands:
  add-liquidity   --amount-xidr <n> --amount-usdc <n>   Add liquidity at current price ±5%
  collect-fees                                           Collect accumulated swap fees to treasury
  rebalance                                              Remove out-of-range position, re-center ±5%
  pool-stats                                             Print tick range, TVL, fee tier, current price
```

### Keeper bot (`scripts/keeper.ts`)

Runs on a cron schedule (default: every 15 minutes). Each tick:

1. **Accrue yield** — iterates registered partners, checks `pendingYield()` vs. treasury balance
2. **Treasury health** — alerts if treasury balance falls below 7-day runway
3. **Pool tick check** — reads current tick from Uniswap v3 slot0; triggers `rebalance` if position is >80% out of range
4. **Fee collection** — collects fees once per day

```bash
# Run once (CI / manual trigger)
npx ts-node scripts/keeper.ts --once

# Daemon mode (15-min interval)
npx ts-node scripts/keeper.ts
```

### Liquidity dashboard (`dashboard/`)

React 18 + Vite + wagmi v2 single-page app. Connect a wallet to see partner-specific yield data.

| Component | What it shows |
|---|---|
| `PoolStats` | Current price, tick range, TVL, 24h fees, fee tier |
| `TVLChart` | 30-day TVL history (recharts area chart) |
| `RateChart` | XIDR/USDC price over time |
| `IncentiveStats` | Total partners, total yield paid, treasury balance, treasury runway |
| `PartnerDashboard` | Connected wallet: pending yield, APY, balance, last claim |

```bash
cd dashboard
npm install
npm run dev   # Vite dev server on :5173
npm run build
```

### Functional requirements

| ID | Requirement | Status |
|---|---|---|
| FR-5-001 | XIDR/USDC Uniswap v3 pool seeded idempotently (no double-seed) | ✅ |
| FR-5-002 | Concentrated liquidity position at live rate ±5% | ✅ |
| FR-5-003 | Partner yield accrues continuously from registration; claimable any time | ✅ |
| FR-5-004 | `claimYield` uses CEI pattern — no re-entrancy vector | ✅ |
| FR-5-005 | Keeper bot rebalances pool when position drifts out of range | ✅ |
| FR-5-006 | Treasury health alert when balance < 7-day runway | ✅ |
| FR-5-007 | Dashboard shows live pool stats and per-partner yield without page reload | ✅ |
| FR-5-008 | `FloatIncentive.sol` UUPS upgradeable — same proxy pattern as XIdrToken | ✅ |
| FR-5-009 | Per-partner APY override — different rates for anchor partners | ✅ |
| FR-5-010 | Deploy script funds treasury and registers initial partners atomically | ✅ |

### Fix 5 setup

**Deploy FloatIncentive:**

```bash
# Ensure deployments/base-sepolia.json exists from Fix 1 deploy
npx ts-node scripts/deploy-float-incentive.ts --network base-sepolia
# → writes floatIncentive address to deployments/base-sepolia.json
```

**Seed the pool:**

```bash
npm run seed   # idempotent — safe to re-run
```

**Run the keeper:**

```bash
# .env must have KEEPER_WALLET_PRIVATE_KEY, FLOAT_INCENTIVE_ADDRESS, UNISWAP_POOL_ADDRESS
npx ts-node scripts/keeper.ts
```

**Dashboard:**

```bash
cd dashboard
cp .env.example .env   # set VITE_FLOAT_INCENTIVE_ADDRESS, VITE_XIDR_ADDRESS, VITE_POOL_ADDRESS
npm install && npm run dev
```

**Environment variables (root `.env`):**

```bash
# Pool management + keeper
KEEPER_WALLET_PRIVATE_KEY=    # wallet with MANAGER_ROLE + TREASURY_ROLE
FLOAT_INCENTIVE_ADDRESS=      # from deployments/base-sepolia.json
UNISWAP_POOL_ADDRESS=         # from deployments/base-sepolia.json
UNISWAP_POSITION_TOKEN_ID=    # NFT token ID of the LP position

# Alerts
OPS_ALERT_WEBHOOK_URL=        # Slack / PagerDuty incoming webhook
TREASURY_RUNWAY_DAYS=7        # alert threshold
```

**Tests:**

```bash
npm test   # 107 total: 50 XIdrToken + 45 FloatIncentive + 12 pool math
```

### Fix 5 tech stack

- Solidity 0.8.24 + OpenZeppelin Contracts Upgradeable 5.x (UUPS)
- Uniswap v3 core/periphery (NonfungiblePositionManager, SwapRouter02)
- Hardhat + TypeScript + Chai + hardhat-network-helpers
- viem v2 (keeper + deploy scripts)
- React 18 + Vite 5 + wagmi v2 + viem + recharts
- RainbowKit (wallet connect in dashboard)

---

## Contract addresses

Auto-generated at deploy time. After running the deploy script:

- Base Sepolia: `deployments/base-sepolia.json`
- Base Mainnet: `deployments/base-mainnet.json`

These files are gitignored. The deployer is responsible for storing them securely. The compliance service reads `XIDR_CONTRACT_ADDRESS` from its `.env`.

---

## Fix 1 tech stack

- Solidity 0.8.24
- OpenZeppelin Contracts Upgradeable 5.x (UUPS proxy)
- Hardhat + TypeScript
- ethers v6
- Base Mainnet (chainId 8453) / Base Sepolia (84532)
- Uniswap v3 on Base for XIDR/USDC pool

## Fix 4 tech stack

- Node.js 20 + TypeScript, Fastify 4.x
- PostgreSQL 15 + Drizzle ORM
- BullMQ + Redis (3 queues: swap, disburse, rate-cache)
- viem v2 (Uniswap v3 two-hop swap on Base)
- Pyth Network price feeds (with CoinGecko fallback)
- Stripe SDK (SGD card payments)
- Twilio Verify + SMS (phone OTP + bilingual notifications)
- Next.js 14 (App Router) + Tailwind CSS + qrcode.react

## Fix 2 tech stack

- Node.js 20 + TypeScript
- Fastify 4.x
- PostgreSQL 15 + Drizzle ORM
- BullMQ + Redis
- viem v2
- React 18 + Tailwind CSS
- Docker + docker-compose

---

## Out of scope

All five fixes are now complete. See roadmap tree above.
