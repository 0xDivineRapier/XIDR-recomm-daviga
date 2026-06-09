import type { FastifyInstance } from "fastify";
import { fetchReserves } from "../services/reserves.js";

export async function reservesRoute(app: FastifyInstance) {
  app.get("/api/v1/reserves", async (_req, reply) => {
    const data = await fetchReserves();
    reply
      .header("X-Reserve-Signature", data.signature)
      .header("Cache-Control", "public, max-age=60")
      .send(data);
  });
}
