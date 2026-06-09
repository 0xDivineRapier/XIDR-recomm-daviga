import { createAdapter } from "../adapters/RailAdapterFactory.js";
import { cacheStatus, getCachedStatus } from "../lib/redis.js";
import { env } from "../lib/env.js";
import type {
  SettlementParams,
  SettlementResult,
  SettlementStatusResult,
  CancelResult,
} from "../adapters/types.js";

function getAdapter() {
  return createAdapter(env.SETTLEMENT_RAIL);
}

export async function initiateSettlement(params: SettlementParams): Promise<SettlementResult> {
  const adapter = getAdapter();
  const result = await adapter.initiate(params);
  // Warm the status cache immediately
  await cacheStatus(result.settlement_id, {
    settlement_id: result.settlement_id,
    status: result.status,
    rail_id: result.rail_id,
    updated_at: result.initiated_at,
  });
  return result;
}

export async function getSettlementStatus(id: string): Promise<SettlementStatusResult> {
  const cached = await getCachedStatus<SettlementStatusResult>(id);
  if (cached) return cached;

  const adapter = getAdapter();
  const status = await adapter.getStatus(id);
  await cacheStatus(id, status);
  return status;
}

export async function cancelSettlement(id: string): Promise<CancelResult> {
  const adapter = getAdapter();
  return adapter.cancel(id);
}
