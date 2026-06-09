import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { desc, count } from 'drizzle-orm';
import { createHash } from 'crypto';
import { db } from '../../db/index.js';
import { reserveAttestations } from '../../db/schema.js';
import { reserveService } from '../../services/reserve.service.js';
import { requireAdmin } from '../middleware/auth.js';

export async function reserveRoutes(fastify: FastifyInstance) {
  // GET /v1/reserves/latest — public
  fastify.get('/latest', async (_request: FastifyRequest, reply: FastifyReply) => {
    const latest = await db.query.reserveAttestations.findFirst({
      orderBy: [desc(reserveAttestations.attestedAt)],
    });
    if (!latest) return reply.code(404).send({ error: 'No attestation found' });
    reply.send(latest);
  });

  // GET /v1/reserves/history — public, paginated
  fastify.get('/history', async (request: FastifyRequest, reply: FastifyReply) => {
    const { page = '1', limit = '20' } = request.query as {
      page?: string;
      limit?: string;
    };
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    const rows = await db
      .select()
      .from(reserveAttestations)
      .orderBy(desc(reserveAttestations.attestedAt))
      .limit(limitNum)
      .offset(offset);

    const [{ total }] = await db.select({ total: count() }).from(reserveAttestations);

    reply.send({
      data: rows,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  });

  // POST /v1/reserves/attest — admin only
  fastify.post(
    '/attest',
    { preHandler: requireAdmin },
    async (
      request: FastifyRequest<{
        Body: {
          idr_reserve_amount: string;
          reserve_bank_name: string;
          notes?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      const adminId = (request.user as any).id;
      const { idr_reserve_amount, reserve_bank_name, notes } = request.body;

      const { totalSupply } = await reserveService.getTotalSupply();
      const totalSupplyStr = totalSupply.toString();

      const idrAmount = parseFloat(idr_reserve_amount);
      const supply = parseFloat(totalSupplyStr);
      const ratio = supply > 0 ? (idrAmount / supply) : 0;

      const attestedAt = new Date();
      const attestationHash = createHash('sha256')
        .update(
          JSON.stringify({
            attested_at: attestedAt.toISOString(),
            xidr_total_supply: totalSupplyStr,
            idr_reserve_amount,
            reserve_ratio: ratio.toFixed(6),
          })
        )
        .digest('hex');

      await db
        .insert(reserveAttestations)
        .values({
          attestedAt,
          xidrTotalSupply: totalSupplyStr,
          idrReserveAmount: idr_reserve_amount,
          reserveRatio: ratio.toFixed(6),
          reserveBankName: reserve_bank_name,
          attestationHash,
          attestedBy: adminId,
          notes: notes || null,
        });

      // Return computed values directly (avoids round-trip; hash is deterministic)
      reply.code(201).send({
        attestedAt: attestedAt.toISOString(),
        xidrTotalSupply: totalSupplyStr,
        idrReserveAmount: idr_reserve_amount,
        reserveRatio: ratio.toFixed(6),
        reserveBankName: reserve_bank_name,
        attestationHash,
        attestedBy: adminId,
        notes: notes || null,
      });
    }
  );

  // GET /v1/reserves/live-supply — admin only
  fastify.get(
    '/live-supply',
    { preHandler: requireAdmin },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const { totalSupply, blockNumber, timestamp } = await reserveService.getTotalSupply();
      reply.send({
        total_supply: totalSupply.toString(),
        block_number: blockNumber.toString(),
        timestamp,
      });
    }
  );
}
