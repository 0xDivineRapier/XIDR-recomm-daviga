# IDRXPay — Settlement Abstraction Layer

> Rail-agnostic settlement core for IDRXPay.
> Swap the underlying settlement rail by changing **one env var** — zero client-facing code changes required.

Part of the IDRXPay SNAP-compliant B2B settlement SDK on IDRX (Base L2).

---

## Overview

Indonesian B2B settlement infrastructure is fragmenting. IDRX on Base L2 is live today; Bank Indonesia's Digital Rupiah (BI Project Garuda) is on the horizon. This layer abstracts both — and any future rail — behind a single `RailAdapter` interface so client integrations never need to change rails.

```
Client code
    │
    ▼
Settlement API  (Fastify · POST /api/v1/settlement/initiate)
    │
    ▼
RailAdapterFactory  ← SETTLEMENT_RAIL env var
    ├── IdrxRailAdapter          (live — IDRX on Base L2 via viem v2)
    ├── DigitalRupiahStubAdapter (stub — pending BI Project Garuda API spec)
    └── [your future rail]       (implement RailAdapter, add one case)
```

---

## Quick start

```bash
git clone https://github.com/0xDivineRapier/idrx-settlement-layer
cd idrx-settlement-layer
cp .env.example .env      # fill in ALCHEMY_RPC_URL, IDRX_CONTRACT_ADDRESS, HMAC_SECRET
docker-compose up
```

API available at **http://localhost:3002**

---

## Env vars

| Variable | Required | Default | Description |
|---|---|---|---|
| `SETTLEMENT_RAIL` | No | `idrx` | Active rail: `idrx` \| `digital_rupiah` \| `test` |
| `ALCHEMY_RPC_URL` | Yes (idrx) | — | Alchemy Base mainnet RPC endpoint |
| `IDRX_CONTRACT_ADDRESS` | Yes (idrx) | — | IDRX ERC-20 contract on Base |
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `REDIS_URL` | Yes | `redis://localhost:6379` | Redis connection string |
| `CALLBACK_URL` | No | — | Client webhook endpoint for settlement events |
| `PORT` | No | `3002` | HTTP port |

---

## API reference

### POST `/api/v1/settlement/initiate`

Initiate a new settlement. Idempotent with respect to `reference_id`.

**Request**
```json
{
  "amount_idr": 500000000,
  "recipient": "0xRecipientAddress",
  "reference_id": "inv-2026-001",
  "conditions": []
}
```

**Response `201`**
```json
{
  "settlement_id": "3614ec64-b050-4fd5-949c-1561a9bc4bf6",
  "rail_id": "idrx_mock_a1b2c3d4e5f6g7h8",
  "status": "pending",
  "initiated_at": "2026-06-09T00:00:00.000Z"
}
```

---

### GET `/api/v1/settlement/:id`

Fetch current settlement status.

**Response `200`**
```json
{
  "settlement_id": "3614ec64-b050-4fd5-949c-1561a9bc4bf6",
  "status": "pending",
  "rail_id": "idrx_mock_a1b2c3d4e5f6g7h8",
  "updated_at": "2026-06-09T00:00:00.000Z"
}
```

Status values: `pending` → `processing` → `confirmed` | `failed` | `cancelled`

---

### POST `/api/v1/settlement/:id/cancel`

Cancel a pending or processing settlement.

**Response `200`**
```json
{
  "settlement_id": "3614ec64-b050-4fd5-949c-1561a9bc4bf6",
  "cancelled": true
}
```

Returns `cancelled: false` if already in a terminal state.

---

### GET `/api/v1/rails/compatibility`

Static rail feature matrix — use this in your integration UI to show clients which features are available on the active rail.

**Response `200`**
```json
{
  "generated_at": "2026-06-09T00:00:00.000Z",
  "rails": [
    {
      "rail": "idrx",
      "description": "IDRX stablecoin on Base L2 via Aerodrome / direct ERC-20 transfer",
      "features": {
        "escrow": "supported",
        "split_settlement": "supported",
        "time_lock": "supported",
        "cancel": "supported"
      }
    },
    {
      "rail": "digital_rupiah",
      "description": "Bank Indonesia Digital Rupiah (e-Rupiah) — stub pending BI Project Garuda public API specification",
      "features": {
        "escrow": "pending_spec",
        "split_settlement": "pending_spec",
        "time_lock": "pending_spec",
        "cancel": "pending_spec"
      }
    }
  ]
}
```

---

## Switching rails

```bash
# Production — IDRX on Base L2
SETTLEMENT_RAIL=idrx docker-compose up

# Demo / CI — stub adapter, no RPC or DB needed
SETTLEMENT_RAIL=test docker-compose up
```

The client receives **identical JSON structure** from every rail. A compliance reviewer or enterprise client sees the same API regardless of which rail is active underneath.

---

## Webhook callbacks

Set `CALLBACK_URL` to receive async settlement lifecycle events. Dispatched via **BullMQ** with 3× exponential retry on failure.

```json
{
  "event_type": "settlement.confirmed",
  "settlement_id": "3614ec64-b050-4fd5-949c-1561a9bc4bf6",
  "rail_id": "idrx_mock_a1b2c3d4e5f6g7h8",
  "status": "confirmed",
  "timestamp": "2026-06-09T00:00:00.000Z"
}
```

`event_type` is `settlement.confirmed` or `settlement.failed`.

---

## Database

PostgreSQL — single `settlements` table. Migration auto-applies via Docker `initdb.d` on first run.

```sql
CREATE TABLE settlements (
  id           UUID PRIMARY KEY,
  rail_id      TEXT        NOT NULL,
  rail_name    TEXT        NOT NULL,
  reference_id TEXT        NOT NULL,
  amount_idr   BIGINT      NOT NULL,
  recipient    TEXT        NOT NULL,
  status       TEXT        NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','processing','confirmed','failed','cancelled')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Run manually:
```bash
psql $DATABASE_URL -f migrations/001_create_settlements.sql
# or
DATABASE_URL=... npm run migrate
```

---

## Adding a new rail

Four steps, zero changes to client code:

1. Create `src/adapters/YourRailAdapter.ts` implementing `RailAdapter`:
   ```ts
   export class YourRailAdapter implements RailAdapter {
     readonly railName = "your_rail";
     async initiate(params: SettlementParams): Promise<SettlementResult> { ... }
     async getStatus(id: string): Promise<SettlementStatusResult> { ... }
     async cancel(id: string): Promise<CancelResult> { ... }
   }
   ```
2. Add a `case` in `RailAdapterFactory.ts`
3. Add an entry to `COMPATIBILITY_MATRIX`
4. Set `SETTLEMENT_RAIL=your_rail` — done.

---

## Architecture decisions

**Why `RailAdapter` instead of a strategy pattern class?**
TypeScript interfaces with no runtime footprint. Adapters are plain classes — easy to unit test in isolation, easy to stub in CI.

**Why BullMQ for webhooks?**
Webhook delivery is inherently unreliable. BullMQ gives persistent job queues backed by Redis with configurable retry logic. If the client's endpoint is down, jobs survive a restart.

**Why PostgreSQL over an event store?**
Settlement records are financial data subject to BI audit requirements. A relational table with a status constraint and update trigger gives a clear, auditable state machine without event-sourcing overhead at this scale.

**Why is `env.ts` a static object?**
Fast startup, single source of truth, type-safe. Trade-off: tests must mock the factory rather than `vi.stubEnv` — documented in `test/integration.test.ts`.

---

## Development

```bash
npm install
npm run dev       # tsx watch — live reloads
npm test          # 34 tests, no live DB / Redis / RPC required
```

---

## Port map — IDRXPay services

| Service | Port | Repo |
|---|---|---|
| Reserve Transparency Dashboard | 3000 | `idrx-reserve-dashboard` |
| Liquidity Pool Monitor | 3001 | `idrx-pool-monitor` |
| **Settlement Abstraction Layer** | **3002** | **this repo** |
