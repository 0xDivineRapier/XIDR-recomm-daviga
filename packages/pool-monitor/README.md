# IDRXPay — Liquidity Pool Monitor

Real-time health monitor for the IDRX/USDC pool on Aerodrome Finance (Base L2).
Part of the IDRXPay SNAP-compliant B2B settlement SDK.

## Quick start

```bash
cp .env.example .env      # fill in your values
docker-compose up
```

Open http://localhost:3001 for the live dashboard.

---

## Env vars

| Variable | Required | Default | Description |
|---|---|---|---|
| `ALCHEMY_RPC_URL` | Yes | — | Alchemy Base mainnet RPC endpoint |
| `AERODROME_POOL_ADDRESS` | Yes | — | Aerodrome pool contract address on Base |
| `REDIS_URL` | Yes | `redis://localhost:6379` | Redis connection string |
| `HMAC_SECRET` | Yes | — | Secret for HMAC-SHA256 response signing |
| `ALERT_WEBHOOK_URL` | No | — | POST target for low-TVL alerts (omit to disable) |
| `LOW_TVL_THRESHOLD_IDR` | No | `3000000000` | Alert threshold in IDR (default Rp 3 B) |
| `PORT` | No | `3001` | HTTP port |

---

## Endpoints

| Route | Description |
|---|---|
| `GET /` | Pool health dashboard — auto-refreshes every 60 s |
| `GET /api/v1/pool` | JSON pool report (rate-limited: 60 req/min/IP) |

### `/api/v1/pool` response

```json
{
  "pool_address": "0x...",
  "tvl_idr": 10000000000,
  "volume_24h_idr": 250000000,
  "slippage_500m_pct": 9.0909,
  "slippage_100m_pct": 1.9608,
  "last_updated": "2026-06-09T00:00:00.000Z",
  "signature": "<64-char hex HMAC-SHA256>"
}
```

`X-Pool-Signature` response header carries the same signature.

**Verifying the signature:**

```ts
import { createHmac } from "crypto";

const { signature, ...payload } = responseBody;
const expected = createHmac("sha256", HMAC_SECRET)
  .update(JSON.stringify(payload))
  .digest("hex");
assert(expected === signature);
```

---

## Dashboard status colours

| TVL | Status |
|---|---|
| > Rp 5 B | 🟢 Green — healthy, supports enterprise settlements |
| Rp 3–5 B | 🟡 Yellow — caution, approaching top-up threshold |
| < Rp 3 B | 🔴 Red — alert, pool too shallow for large settlements |

---

## Slippage model

Slippage is estimated using the **constant-product formula** (`x·y = k`):

```
price_impact = amountIn / (reserveIn + amountIn)
```

where `reserveIn` = half of TVL (symmetric LP assumption).

> ⚠ Aerodrome CL pools use concentrated liquidity (Uniswap V3 math) distributed
> across ticks. This formula models only the in-range virtual reserves and
> **underestimates** slippage for large swaps that cross tick boundaries.
> Treat outputs as a lower bound; add a 20–30% safety margin for real settlements.

---

## Webhook alerts

When `ALERT_WEBHOOK_URL` is set and `tvl_idr < LOW_TVL_THRESHOLD_IDR`, the server POSTs:

```json
{
  "event_type": "pool_low_tvl",
  "tvl_idr": 2500000000,
  "threshold_idr": 3000000000,
  "timestamp": "2026-06-09T00:00:00.000Z",
  "severity": "warning"
}
```

`severity` is `"critical"` when TVL < 50% of threshold, `"warning"` otherwise.
Alerts are debounced to at most **once per 30 minutes**.

---

## Development

```bash
npm install
npm run dev       # tsx watch — live reloads on save
npm test          # vitest — no live RPC or Redis needed
```

## Running alongside the Reserve Dashboard

Both services share the same Alchemy key. Run them together:

```
Reserve Dashboard  → http://localhost:3000
Pool Monitor       → http://localhost:3001
```

The pool monitor's docker-compose binds Redis on port **6380** to avoid clashing
with the reserve dashboard's Redis on 6379.
