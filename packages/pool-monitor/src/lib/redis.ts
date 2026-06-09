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

const TTL = 600; // 10 min

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const raw = await getRedis().get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch { return null; }
}

export async function cacheSet(key: string, value: unknown): Promise<void> {
  try { await getRedis().set(key, JSON.stringify(value), "EX", TTL); }
  catch { /* best-effort */ }
}
