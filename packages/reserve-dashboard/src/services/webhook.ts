import { env } from "../lib/env.js";

const ALERT_THRESHOLD = 0.99;
const DEBOUNCE_MS = 5 * 60 * 1000;

let lastFiredAt = 0;

export function isUnderCollateralised(ratio: number): boolean {
  return ratio < ALERT_THRESHOLD;
}

export async function triggerWebhook(ratio: number): Promise<void> {
  if (!env.WEBHOOK_URL) return;
  if (!isUnderCollateralised(ratio)) return;

  const now = Date.now();
  if (now - lastFiredAt < DEBOUNCE_MS) return;
  lastFiredAt = now;

  const payload = {
    event_type: "reserve_undercollateralised",
    current_ratio: ratio,
    timestamp: new Date().toISOString(),
    severity: ratio < 0.95 ? "critical" : "warning",
  };

  try {
    await fetch(env.WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    console.warn("[webhook] alert fired — ratio", ratio.toFixed(4));
  } catch (err: any) {
    console.error("[webhook] delivery failed:", err.message);
  }
}
