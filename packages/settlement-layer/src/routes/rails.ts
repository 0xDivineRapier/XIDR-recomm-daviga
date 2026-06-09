import type { FastifyInstance } from "fastify";
import { COMPATIBILITY_MATRIX } from "../adapters/RailAdapterFactory.js";

export async function railsRoutes(app: FastifyInstance) {
  app.get("/api/v1/rails/compatibility", async (_req, reply) => {
    reply
      .header("Cache-Control", "public, max-age=3600")
      .send({
        generated_at: new Date().toISOString(),
        rails: COMPATIBILITY_MATRIX,
      });
  });
}
