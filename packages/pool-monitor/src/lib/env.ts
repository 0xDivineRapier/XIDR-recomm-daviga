export const env = {
  ALCHEMY_RPC_URL: process.env.ALCHEMY_RPC_URL ?? "",
  AERODROME_POOL_ADDRESS: (process.env.AERODROME_POOL_ADDRESS ?? "") as `0x${string}`,
  REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
  ALERT_WEBHOOK_URL: process.env.ALERT_WEBHOOK_URL ?? "",
  LOW_TVL_THRESHOLD_IDR: Number(process.env.LOW_TVL_THRESHOLD_IDR ?? 3_000_000_000),
  HMAC_SECRET: process.env.HMAC_SECRET ?? "dev-secret",
  PORT: Number(process.env.PORT ?? 3001),
};
