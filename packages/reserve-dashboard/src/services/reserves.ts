import { createHmac } from "crypto";
import { readTotalSupply } from "./onchain.js";
import { getReserveSource } from "./custodian.js";
import { env } from "../lib/env.js";
import { triggerWebhook } from "./webhook.js";

export interface ReserveData {
  total_supply: number;
  idr_reserve_balance: number;
  ratio: number;
  last_updated: string;
  data_sources: string[];
}

export interface SignedReserveData extends ReserveData {
  signature: string;
}

export function computeRatio(supply: number, reserve: number): number {
  if (supply === 0) return 1;
  return reserve / supply;
}

export function signPayload(payload: ReserveData): string {
  const body = JSON.stringify(payload);
  return createHmac("sha256", env.HMAC_SECRET).update(body).digest("hex");
}

export async function fetchReserves(): Promise<SignedReserveData> {
  const source = getReserveSource();

  const [supplyBig, custodian] = await Promise.all([
    readTotalSupply(),
    source.getBalance(),
  ]);

  const total_supply = Number(supplyBig);
  const idr_reserve_balance = custodian.idr_balance;
  const ratio = computeRatio(total_supply, idr_reserve_balance);
  const last_updated = new Date().toISOString();
  const data_sources = ["onchain_base", source.name];

  const payload: ReserveData = {
    total_supply,
    idr_reserve_balance,
    ratio,
    last_updated,
    data_sources,
  };

  // Async fire-and-forget — webhook should not block the API response
  triggerWebhook(ratio).catch(() => {});

  return { ...payload, signature: signPayload(payload) };
}
