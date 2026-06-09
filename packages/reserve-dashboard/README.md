# IDRX Reserve Transparency Dashboard

Public proof-of-reserve service for IDRX — rupiah-pegged stablecoin on Base L2.

## Quick start

```bash
cp .env.example .env   # fill in your values
docker-compose up
```

Open http://localhost:3000 for the live dashboard.

---

## Env vars

| Variable | Required | Description |
|---|---|---|
| `ALCHEMY_RPC_URL` | Yes | Alchemy Base mainnet RPC endpoint |
| `IDRX_CONTRACT_ADDRESS` | Yes | IDRX ERC-20 contract address on Base |
| `REDIS_URL` | Yes | Redis connection string (default `redis://localhost:6379`) |
| `HMAC_SECRET` | Yes | Secret key for HMAC-SHA256 response signing — keep long and random |
| `WEBHOOK_URL` | No | POST target for under-collateralisation alerts (omit to disable) |
| `PORT` | No | HTTP port (default `3000`) |

---

## Endpoints

| Route | Description |
|---|---|
| `GET /` | Live dashboard — auto-refreshes every 60 s |
| `GET /api/v1/reserves` | JSON reserves payload (rate-limited: 60 req/min/IP) |
| `GET /badge` | Embeddable iframe badge — refreshes every 5 min |

### `/api/v1/reserves` response shape

```json
{
  "total_supply": 1000000,
  "idr_reserve_balance": 1050000,
  "ratio": 1.05,
  "last_updated": "2026-06-09T00:00:00.000Z",
  "data_sources": ["onchain_base", "file"],
  "signature": "<64-char hex HMAC-SHA256>"
}
```

`X-Reserve-Signature` response header carries the same signature.

**Verifying the signature**

```ts
import { createHmac } from "crypto";

const { signature, ...payload } = responseBody;
const expected = createHmac("sha256", HMAC_SECRET)
  .update(JSON.stringify(payload))
  .digest("hex");
assert(expected === signature);
```

---

## Custodian balance file

Mount a JSON file at `/app/data/custodian-balance.json` (or `./data/custodian-balance.json` in dev):

```json
{
  "idr_balance": 1000000000,
  "updated_at": "2026-06-09T00:00:00Z"
}
```

The server hot-reloads this file every 5 s. To plug in a live custodian API, implement the `ReserveSource` interface in `src/services/custodian.ts` and call `setReserveSource()` at startup.

---

## Webhook alerts

When `WEBHOOK_URL` is set and `ratio < 0.99`, the server POSTs:

```json
{
  "event_type": "reserve_undercollateralised",
  "current_ratio": 0.985,
  "timestamp": "2026-06-09T00:00:00.000Z",
  "severity": "warning"
}
```

`severity` is `"critical"` when `ratio < 0.95`, `"warning"` otherwise.
Alerts are debounced to at most once per 5-minute window.

---

## Development

```bash
npm install
npm run dev        # tsx watch — hot reloads
npm test           # vitest unit + integration
```

No live RPC or Redis is required for tests — both are mocked.

## Embeddable badge

```html
<iframe src="https://your-domain/badge"
        width="200" height="36"
        frameborder="0"
        style="border:none">
</iframe>
```
