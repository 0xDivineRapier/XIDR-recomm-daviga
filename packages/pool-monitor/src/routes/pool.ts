import type { FastifyInstance } from "fastify";
import { getPoolReport } from "../services/monitor.js";

export async function poolRoute(app: FastifyInstance) {
  app.get("/api/v1/pool", async (_req, reply) => {
    const data = await getPoolReport();
    reply
      .header("X-Pool-Signature", data.signature)
      .header("Cache-Control", "public, max-age=600")
      .send(data);
  });
}
