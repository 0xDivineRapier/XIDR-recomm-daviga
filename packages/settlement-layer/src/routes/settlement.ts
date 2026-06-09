import type { FastifyInstance } from "fastify";
import {
  initiateSettlement,
  getSettlementStatus,
  cancelSettlement,
} from "../services/settlement.js";
import type { SettlementParams } from "../adapters/types.js";

export async function settlementRoutes(app: FastifyInstance) {
  // POST /api/v1/settlement/initiate
  app.post<{ Body: SettlementParams }>("/api/v1/settlement/initiate", async (req, reply) => {
    const { amount_idr, recipient, reference_id, conditions } = req.body ?? {};

    if (!amount_idr || typeof amount_idr !== "number" || amount_idr <= 0)
      return reply.code(400).send({ error: "amount_idr must be a positive number" });
    if (!recipient || typeof recipient !== "string")
      return reply.code(400).send({ error: "recipient is required" });
    if (!reference_id || typeof reference_id !== "string")
      return reply.code(400).send({ error: "reference_id is required" });

    const result = await initiateSettlement({ amount_idr, recipient, reference_id, conditions });
    return reply.code(201).send(result);
  });

  // GET /api/v1/settlement/:id
  app.get<{ Params: { id: string } }>("/api/v1/settlement/:id", async (req, reply) => {
    try {
      const status = await getSettlementStatus(req.params.id);
      return reply.send(status);
    } catch (err: any) {
      if (err.message?.includes("not found"))
        return reply.code(404).send({ error: err.message });
      throw err;
    }
  });

  // POST /api/v1/settlement/:id/cancel
  app.post<{ Params: { id: string } }>("/api/v1/settlement/:id/cancel", async (req, reply) => {
    const result = await cancelSettlement(req.params.id);
    return reply.send(result);
  });
}
