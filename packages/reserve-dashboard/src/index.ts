import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import staticFiles from "@fastify/static";
import path from "path";
import { fileURLToPath } from "url";
import { env } from "./lib/env.js";
import { reservesRoute } from "./routes/reserves.js";
import { badgeRoute } from "./routes/badge.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = Fastify({ logger: { level: "info" } });

await app.register(rateLimit, {
  max: 60,
  timeWindow: "1 minute",
  keyGenerator: (req) => req.ip,
});

await app.register(staticFiles, {
  root: path.join(__dirname, "public"),
  prefix: "/",
  decorateReply: false,
});

await app.register(reservesRoute);
await app.register(badgeRoute);

// Root serves the dashboard HTML (static plugin handles it via index.html)

try {
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  console.log(`Reserve dashboard listening on port ${env.PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
