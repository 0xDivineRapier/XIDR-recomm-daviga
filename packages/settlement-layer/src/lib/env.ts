export const env = {
  SETTLEMENT_RAIL: (process.env.SETTLEMENT_RAIL ?? "idrx") as "idrx" | "digital_rupiah" | "test",
  ALCHEMY_RPC_URL: process.env.ALCHEMY_RPC_URL ?? "",
  IDRX_CONTRACT_ADDRESS: (process.env.IDRX_CONTRACT_ADDRESS ?? "") as `0x${string}`,
  DATABASE_URL: process.env.DATABASE_URL ?? "postgres://idrx:idrx@localhost:5432/idrx_settlement",
  REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
  CALLBACK_URL: process.env.CALLBACK_URL ?? "",
  PORT: Number(process.env.PORT ?? 3002),
};
