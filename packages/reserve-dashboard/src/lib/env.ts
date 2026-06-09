export const env = {
  ALCHEMY_RPC_URL: process.env.ALCHEMY_RPC_URL ?? "",
  IDRX_CONTRACT_ADDRESS: (process.env.IDRX_CONTRACT_ADDRESS ?? "") as `0x${string}`,
  REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
  WEBHOOK_URL: process.env.WEBHOOK_URL ?? "",
  HMAC_SECRET: process.env.HMAC_SECRET ?? "dev-secret",
  PORT: Number(process.env.PORT ?? 3000),
};
