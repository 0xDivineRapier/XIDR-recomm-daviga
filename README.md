# IDRXPay — SNAP-Compliant B2B Settlement SDK on IDRX (Base L2)

> **Recommendation to IDRX / Kana Labs**
> A complete, production-ready infrastructure layer for enterprise B2B settlement on IDRX (Base L2).

Built by [@0xDivineRapier](https://github.com/0xDivineRapier) as a technical recommendation demonstrating how IDRX can become the default settlement rail for Indonesian fintech — SNAP-compliant, regulator-ready, and extensible to BI's Digital Rupiah when it launches.

---

## Why this exists

Indonesian B2B settlement is stuck between two worlds:

| Today | The gap |
|---|---|
| Traditional interbank (BI-FAST, RTGS) | Slow (T+1 to T+2), batch settlement, no programmability |
| Crypto rails | Fast, programmable — but not SNAP-compliant, not IDR-native |

**IDRX on Base L2 fills that gap** — IDR-pegged, sub-second finality, EVM-programmable. But to sell it to enterprise compliance teams, you need three things: proof of reserves, liquidity guarantees, and a rail-abstraction layer that survives regulatory change. This repo provides all three.

---

## The Five Fixes

### Fix 1 — Chain Migration: Ethereum → Base L2

**Barrier:** IDRX originally deployed on Ethereum mainnet. Gas costs of Rp 50–500k per transaction make micro-B2B settlements uneconomical.

**Solution:** Migrate IDRX to Base L2 (Coinbase's OP Stack chain).
- Gas cost: ~Rp 50 per transaction (1000× cheaper)
- Finality: ~2 seconds
- Full EVM compatibility — no contract rewrites needed

See: `contracts/` + `scripts/` · [PR #1](../../pulls)

---

### Fix 2 — Compliance Layer

**Barrier:** Indonesian fintechs (especially SNAP-licensed PSPs) cannot onboard a settlement provider without KYC, AML screening, and reserve attestation documentation. Without this, the sales cycle stalls at the compliance review.

**Solution:** A compliance module with KYC/AML screening hooks, reserve attestation endpoints, an admin panel for compliance officers, and an audit log formatted for BI reporting.

See: `packages/compliance/` · [PR #2](../../pulls)

---

### Fix 3 — SNAP-Compliant SDK Core (`rupix`)

**Barrier:** Enterprise PSPs won't switch settlement rails if it means rewriting their integration. "SNAP-compliant" must be a verifiable property of the API surface, not just a claim.

**Solution:** `rupix` — a Stripe-style SDK wrapping IDRX settlement behind BI SNAP-compatible endpoints. PSPs call familiar REST APIs; the SDK handles on-chain mechanics invisibly. Existing integrations work unchanged.

See: [0xDivineRapier/rupix](https://github.com/0xDivineRapier/rupix)

---

### Fix 4 — SG↔ID Remittance Corridor

**Barrier:** Cross-border B2B payments between Singapore and Indonesia (PayNow → IDR) carry a 2–5% FX spread and settle T+1. For supply-chain finance and payroll, this is a meaningful cost.

**Solution:** A settlement corridor that accepts SGD via PayNow/Stripe, swaps to IDRX via Uniswap V3 on Base, and disburses IDR to Indonesian bank accounts — reducing FX spread to <0.5% and settling in minutes.

See: `packages/corridor/` · [PR #3](../../pulls)

---

### Fix 5 — Liquidity Pool + B2B Float Incentives

**Barrier:** An IDRX settlement rail is useless if the Aerodrome liquidity pool is too shallow to absorb enterprise-scale swaps without unacceptable slippage. A Rp 500M settlement into a Rp 2B TVL pool creates ~20% price impact — not a settlement, a loss.

**Solution:** A liquidity bootstrapping program seeding the IDRX/USDC pool on Aerodrome Finance, plus float incentives for B2B clients who park settlement float in the pool. Includes the pool monitor (below) so operators know when to top up.

See: `packages/pool-monitor/` · [PR #4](../../pulls)

---

## The Three Infrastructure Packages (this PR)

These packages are the **operational backbone** that enterprise clients and compliance reviewers interact with directly. They work on any fix branch and are rail-independent.

---

### 📊 `packages/reserve-dashboard` — Proof-of-Reserve Dashboard
**Port 3000** · [Full README](packages/reserve-dashboard/README.md)

The single biggest compliance objection to IDRX adoption: *"How do we know it's fully backed?"* This dashboard eliminates that objection with a public, cryptographically signed proof-of-reserve page that any reviewer can bookmark.

**What it provides:**
- Live dashboard at `GET /` showing current ratio, supply, and reserve balance — auto-refreshes every 60 seconds
- `GET /api/v1/reserves` — JSON endpoint returning `total_supply`, `idr_reserve_balance`, `ratio`, `last_updated`, `data_sources[]`. Every response is HMAC-SHA256 signed via `X-Reserve-Signature` so downstream systems can verify the data wasn't tampered with
- `GET /badge` — embeddable iframe badge for client portals and compliance packs
- Webhook alert if ratio drops below 0.99, debounced per 5-minute window
- Red banner on dashboard if ratio < 99% or data source unavailable

**Architecture:**
```
viem v2 → Base L2 RPC (Alchemy)
    ↓ total supply (Redis cached, 5-min TTL)
Fastify API → HMAC-SHA256 sign → JSON response
    ↓
File-based custodian reader (ReserveSource interface — swap in live custodian API later)
```

The `ReserveSource` interface means the custodian data source is swappable without touching the API layer — important when moving from a manual JSON file to a real bank custody API.

```
10/10 tests passing — ratio calculation, HMAC signing, anomaly detection, API field types
```

---

### 🌊 `packages/pool-monitor` — Liquidity Pool Health Monitor
**Port 3001** · [Full README](packages/pool-monitor/README.md)

Operators need to know when the Aerodrome pool can't absorb an enterprise settlement before a client tries to execute one. This monitor surfaces pool depth, TVL, and slippage estimates in real time.

**What it provides:**
- Live dashboard at `GET /` with green/yellow/red pool health status
- `GET /api/v1/pool` — JSON: `tvl_idr`, `volume_24h_idr`, `slippage_500m_pct`, `slippage_100m_pct`, `pool_address`, `last_updated`. HMAC-SHA256 signed.
- Webhook alert when TVL drops below `LOW_TVL_THRESHOLD_IDR` (default Rp 3B), debounced per 30 minutes

**Status thresholds:**
| TVL | Status | Meaning |
|---|---|---|
| > Rp 5B | 🟢 Green | Healthy — pool supports enterprise settlements |
| Rp 3–5B | 🟡 Yellow | Caution — approaching top-up threshold |
| < Rp 3B | 🔴 Red | Alert — pool too shallow for large settlements |

**Slippage model:** Constant-product `x·y=k` approximation. This intentionally uses the simpler formula (not Aerodrome's full CL tick-bitmap math) because: (a) it's auditable, (b) it's a conservative lower bound — real slippage is ≥ the estimate, so operators are never surprised in the bad direction. Add 25% margin for real settlements.

**Reference numbers for a Rp 10B TVL pool:**
- Rp 500M swap → ~9.1% slippage
- Rp 100M swap → ~2.0% slippage

These numbers tell you directly: to keep Rp 100M swaps under 0.5% slippage, you need ~Rp 40B in the pool.

```
21/21 tests passing — slippage math, alert threshold, HMAC signing, API field types
```

---

### 🔀 `packages/settlement-layer` — Rail-Agnostic Settlement API
**Port 3002** · [Full README](packages/settlement-layer/README.md)

The core regulatory future-proofing piece. Bank Indonesia's Digital Rupiah (BI Project Garuda) is in development. When it launches, IDRXPay clients cannot be forced to re-integrate. This layer abstracts the settlement rail completely.

**What it provides:**
- `POST /api/v1/settlement/initiate` — initiate settlement, returns `settlement_id`, `rail_id`, `status`, `initiated_at`
- `GET /api/v1/settlement/:id` — fetch current status
- `POST /api/v1/settlement/:id/cancel` — cancel pending settlement
- `GET /api/v1/rails/compatibility` — static feature matrix: which features (escrow, split, time-lock, cancel) each rail supports
- BullMQ webhook delivery: `settlement.confirmed` / `settlement.failed` events POSTed to `CALLBACK_URL` with 3× exponential retry

**Rail compatibility matrix:**
| Feature | IDRX (Base L2) | BI Digital Rupiah |
|---|---|---|
| Escrow | ✅ supported | ⏳ pending BI spec |
| Split settlement | ✅ supported | ⏳ pending BI spec |
| Time-lock | ✅ supported | ⏳ pending BI spec |
| Cancel | ✅ supported | ⏳ pending BI spec |

**Switching rails — zero code changes:**
```bash
SETTLEMENT_RAIL=idrx           # Live — IDRX on Base L2
SETTLEMENT_RAIL=digital_rupiah # When BI Project Garuda spec ships
SETTLEMENT_RAIL=test           # CI / demos — in-memory stub, no DB or RPC
```

Every rail returns the identical JSON structure. A client that integrated against `SETTLEMENT_RAIL=test` works unchanged in production with `SETTLEMENT_RAIL=idrx`.

**Adding a new rail in 4 steps:**
1. `src/adapters/YourRailAdapter.ts` — implement the `RailAdapter` interface (3 methods)
2. Add one `case` in `RailAdapterFactory.ts`
3. Add one entry to `COMPATIBILITY_MATRIX`
4. Set `SETTLEMENT_RAIL=your_rail` — done

```
34/34 tests passing — factory rail selection, adapter method signatures, status transitions,
full initiate→getStatus flow on both idrx and test rails
```

---

## Running everything

```bash
cp .env.example .env   # fill in ALCHEMY_RPC_URL, IDRX_CONTRACT_ADDRESS, etc.
docker-compose up
```

| Service | URL | Healthcheck |
|---|---|---|
| Reserve Dashboard | http://localhost:3000 | `GET /api/v1/reserves` |
| Pool Monitor | http://localhost:3001 | `GET /api/v1/pool` |
| Settlement Layer | http://localhost:3002 | `GET /api/v1/rails/compatibility` |

Each package has its own `docker-compose.yml` for standalone deployment. The root compose brings all three up with shared Redis and Postgres instances.

---

## Test summary

```
packages/reserve-dashboard  10/10  ✅
packages/pool-monitor        21/21  ✅
packages/settlement-layer    34/34  ✅
─────────────────────────────────────
Total                        65/65  ✅
```

Run all tests:
```bash
cd packages/reserve-dashboard  && npm test
cd packages/pool-monitor       && npm test
cd packages/settlement-layer   && npm test
```

---

## Env vars

| Variable | Package(s) | Description |
|---|---|---|
| `ALCHEMY_RPC_URL` | all | Alchemy Base mainnet RPC |
| `IDRX_CONTRACT_ADDRESS` | reserve-dashboard, settlement-layer | IDRX ERC-20 on Base |
| `AERODROME_POOL_ADDRESS` | pool-monitor | Aerodrome IDRX pool contract |
| `DATABASE_URL` | settlement-layer | PostgreSQL (`postgres://...`) |
| `REDIS_URL` | all | Redis (`redis://...`) |
| `HMAC_SECRET` | all | Secret for HMAC-SHA256 response signing |
| `SETTLEMENT_RAIL` | settlement-layer | `idrx` \| `digital_rupiah` \| `test` |
| `WEBHOOK_URL` | reserve-dashboard | Reserve alert POST target |
| `ALERT_WEBHOOK_URL` | pool-monitor | Low-TVL alert POST target |
| `CALLBACK_URL` | settlement-layer | Client settlement event webhook |
| `LOW_TVL_THRESHOLD_IDR` | pool-monitor | Alert threshold (default `3000000000`) |
| `PORT` | all | HTTP ports: 3000 / 3001 / 3002 |

---

## Repository structure

```
XIDR-recomm-daviga/
├── contracts/                    # IDRX ERC-20 + Hardhat (Fix 1)
├── scripts/                      # Deployment + migration scripts
├── test/                         # Contract tests
├── packages/
│   ├── compliance/               # KYC/AML/attestation layer (Fix 2)
│   ├── corridor/                 # SG↔ID remittance (Fix 4)
│   ├── reserve-dashboard/        # Proof-of-reserve (this PR) ← port 3000
│   ├── pool-monitor/             # Pool health monitor (this PR) ← port 3001
│   └── settlement-layer/         # Rail-agnostic settlement API (this PR) ← port 3002
└── README.md
```

---

## Why IDRX + Base L2 is the right foundation

**1. IDR-native peg** — Enterprise clients invoice in IDR, settle in IDR. Zero FX exposure, zero conversion friction.

**2. SNAP-compatible surface** — BI's API standard is implementable on top of EVM. `rupix` already proves this. Existing PSP integrations don't need rewrites.

**3. Programmable settlement conditions** — Escrow, time-lock, and split payment are native to EVM smart contracts. None of these exist in BI-FAST or RTGS. This is the product differentiation.

**4. Transparent reserves** — The reserve dashboard gives compliance officers the one artefact that always gets asked for: a public, tamper-evident proof that every IDRX in circulation is backed 1:1 by IDR. This page alone unblocks most compliance reviews.

**5. Regulatory runway** — The `RailAdapter` pattern means when BI Digital Rupiah launches, the migration is a config change (`SETTLEMENT_RAIL=digital_rupiah`), not a re-integration project. Clients never notice. This is the argument that converts cautious CTOs.
