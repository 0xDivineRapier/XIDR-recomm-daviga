import Redis from "ioredis";
import { env } from "./env.js";

let client: Redis | null = null;

export function getRedis(): Redis {
  if (!client) {
    client = new Redis(env.REDIS_URL, { lazyConnect: true, enableOfflineQueue: false });
    client.on("error", (err) => console.error("[redis]", err.message));
  }
  return client;
}

const STATUS_TTL = 600; // 10 min

export async function cacheStatus(id: string, value: unknown): Promise<void> {
  try { await getRedis().set(`settlement:status:${id}`, JSON.stringify(value), "EX", STATUS_TTL); }
  catch { /* best-effort */ }
}

export async function getCachedStatus<T>(id: string): Promise<T | null> {
  try {
    const raw = await getRedis().get(`settlement:status:${id}`);
    return raw ? JSON.parse(raw) as T : null;
  } catch { return null; }
}
