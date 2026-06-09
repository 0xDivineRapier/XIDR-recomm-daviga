import { env } from "../lib/env.js";

const DEBOUNCE_MS = 30 * 60 * 1000; // 30 min

let lastFiredAt = 0;

export function isBelowThreshold(tvl: number): boolean {
  return tvl < env.LOW_TVL_THRESHOLD_IDR;
}

export async function triggerAlert(tvl: number): Promise<void> {
  if (!env.ALERT_WEBHOOK_URL) return;
  if (!isBelowThreshold(tvl)) return;

  const now = Date.now();
  if (now - lastFiredAt < DEBOUNCE_MS) return;
  lastFiredAt = now;

  const payload = {
    event_type: "pool_low_tvl",
    tvl_idr: tvl,
    threshold_idr: env.LOW_TVL_THRESHOLD_IDR,
    timestamp: new Date().toISOString(),
    severity: tvl < env.LOW_TVL_THRESHOLD_IDR * 0.5 ? "critical" : "warning",
  };

  try {
    await fetch(env.ALERT_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    console.warn("[alert] low TVL webhook fired — TVL", tvl.toLocaleString("id-ID"));
  } catch (err: any) {
    console.error("[alert] delivery failed:", err.message);
  }
}

// Exposed for testing — resets debounce clock
export function resetDebounce() { lastFiredAt = 0; }
