import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import { env } from "./lib/env.js";
import { settlementRoutes } from "./routes/settlement.js";
import { railsRoutes } from "./routes/rails.js";
import { startWebhookWorker } from "./workers/webhookWorker.js";
import { createAdapter } from "./adapters/RailAdapterFactory.js";

// Validate rail at startup — fail fast on misconfiguration
try {
  createAdapter(env.SETTLEMENT_RAIL);
} catch (err: any) {
  console.error("[startup] invalid rail configuration:", err.message);
  process.exit(1);
}

const app = Fastify({ logger: { level: "info" } });

await app.register(rateLimit, {
  max: 120,
  timeWindow: "1 minute",
  keyGenerator: (req) => req.ip,
});

await app.register(settlementRoutes);
await app.register(railsRoutes);

// Boot BullMQ webhook worker in-process
startWebhookWorker();

try {
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  console.log(`Settlement layer active — rail: ${env.SETTLEMENT_RAIL} — port: ${env.PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
