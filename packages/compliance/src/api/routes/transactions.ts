import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eq, desc, count, and, ilike } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { transactions, amlAlerts } from '../../db/schema.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

export async function transactionRoutes(fastify: FastifyInstance) {
  // GET /v1/transactions — authenticated user sees own transactions; admin sees all
  fastify.get(
    '/',
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as { id: string; role: string };
      const { page = '1', limit = '20', status, address } = request.query as {
        page?: string;
        limit?: string;
        status?: string;
        address?: string;
      };

      const pageNum = Math.max(1, parseInt(page));
      const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
      const offset = (pageNum - 1) * limitNum;

      const filters: any[] = [];
      if (status) filters.push(eq(transactions.amlStatus, status as any));
      if (address) {
        filters.push(ilike(transactions.fromAddress, `%${address}%`));
      }

      const rows = await db
        .select()
        .from(transactions)
        .where(filters.length > 0 ? and(...filters) : undefined)
        .orderBy(desc(transactions.createdAt))
        .limit(limitNum)
        .offset(offset);

      const [{ total }] = await db
        .select({ total: count() })
        .from(transactions)
        .where(filters.length > 0 ? and(...filters) : undefined);

      reply.send({
        data: rows,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum),
        },
      });
    }
  );

  // GET /v1/transactions/:txHash — get single transaction
  fastify.get(
    '/:txHash',
    { preHandler: requireAuth },
    async (
      request: FastifyRequest<{ Params: { txHash: string } }>,
      reply: FastifyReply
    ) => {
      const { txHash } = request.params;
      const tx = await db.query.transactions.findFirst({
        where: eq(transactions.txHash, txHash),
      });
      if (!tx) return reply.code(404).send({ error: 'Transaction not found' });
      reply.send(tx);
    }
  );

  // GET /v1/transactions/:txHash/alerts — get AML alerts for a transaction
  fastify.get(
    '/:txHash/alerts',
    { preHandler: requireAdmin },
    async (
      request: FastifyRequest<{ Params: { txHash: string } }>,
      reply: FastifyReply
    ) => {
      const { txHash } = request.params;
      const tx = await db.query.transactions.findFirst({
        where: eq(transactions.txHash, txHash),
      });
      if (!tx) return reply.code(404).send({ error: 'Transaction not found' });

      const alerts = await db
        .select()
        .from(amlAlerts)
        .where(eq(amlAlerts.transactionId, tx.id))
        .orderBy(desc(amlAlerts.createdAt));

      reply.send({ data: alerts });
    }
  );

  // GET /v1/alerts — paginated AML alerts (admin)
  fastify.get(
    '/alerts',
    { preHandler: requireAdmin },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { page = '1', limit = '20', severity, status } = request.query as {
        page?: string;
        limit?: string;
        severity?: string;
        status?: string;
      };

      const pageNum = Math.max(1, parseInt(page));
      const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
      const offset = (pageNum - 1) * limitNum;

      const filters: any[] = [];
      if (severity) filters.push(eq(amlAlerts.severity, severity as any));
      if (status) filters.push(eq(amlAlerts.status, status as any));

      const rows = await db
        .select()
        .from(amlAlerts)
        .where(filters.length > 0 ? and(...filters) : undefined)
        .orderBy(desc(amlAlerts.createdAt))
        .limit(limitNum)
        .offset(offset);

      const countResult = await db
        .select({ total: count() })
        .from(amlAlerts)
        .where(filters.length > 0 ? and(...filters) : undefined);
      const total = Array.isArray(countResult) ? (countResult[0]?.total ?? 0) : 0;

      reply.send({
        data: rows,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum),
        },
      });
    }
  );

  // PATCH /v1/alerts/:id — update alert status (admin)
  fastify.patch(
    '/alerts/:id',
    { preHandler: requireAdmin },
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: { status: 'open' | 'under_review' | 'resolved' | 'escalated'; assigned_to?: string };
      }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;
      const { status, assigned_to } = request.body;

      const alert = await db.query.amlAlerts.findFirst({
        where: eq(amlAlerts.id, id),
      });
      if (!alert) return reply.code(404).send({ error: 'Alert not found' });

      const updateData: Record<string, any> = { status };
      if (assigned_to) updateData.assignedTo = assigned_to;
      if (status === 'resolved') updateData.resolvedAt = new Date();

      await db.update(amlAlerts).set(updateData).where(eq(amlAlerts.id, id));

      reply.send({ success: true });
    }
  );
}
