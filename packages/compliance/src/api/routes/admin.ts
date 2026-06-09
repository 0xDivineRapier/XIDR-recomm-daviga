import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eq, count, and } from 'drizzle-orm';
import { desc } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { users, kycSubmissions, amlAlerts, reserveAttestations, blocklistSyncLog } from '../../db/schema.js';
import { blocklistService } from '../../services/blocklist.service.js';
import { reserveService } from '../../services/reserve.service.js';
import { requireAdmin } from '../middleware/auth.js';

export async function adminRoutes(fastify: FastifyInstance) {
  // GET /v1/admin/dashboard-stats
  fastify.get(
    '/dashboard-stats',
    { preHandler: requireAdmin },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const [totalUsersResult] = await db.select({ total: count() }).from(users);
      const [kycPendingResult] = await db
        .select({ total: count() })
        .from(kycSubmissions)
        .where(eq(kycSubmissions.status, 'pending'));
      const [kycApprovedResult] = await db
        .select({ total: count() })
        .from(kycSubmissions)
        .where(eq(kycSubmissions.status, 'approved'));
      const [openAlertsResult] = await db
        .select({ total: count() })
        .from(amlAlerts)
        .where(eq(amlAlerts.status, 'open'));
      const [criticalAlertsResult] = await db
        .select({ total: count() })
        .from(amlAlerts)
        .where(and(eq(amlAlerts.severity, 'critical'), eq(amlAlerts.status, 'open')));

      const latestAttestation = await db.query.reserveAttestations.findFirst({
        orderBy: [desc(reserveAttestations.attestedAt)],
      });

      let totalSupplyStr = '0';
      try {
        const { totalSupply } = await reserveService.getTotalSupply();
        totalSupplyStr = totalSupply.toString();
      } catch {
        // RPC may not be available; return zero
      }

      reply.send({
        total_users: totalUsersResult.total,
        kyc_pending_count: kycPendingResult.total,
        kyc_approved_count: kycApprovedResult.total,
        open_alerts_count: openAlertsResult.total,
        critical_alerts_count: criticalAlertsResult.total,
        latest_reserve_ratio: latestAttestation?.reserveRatio ?? null,
        xidr_total_supply: totalSupplyStr,
      });
    }
  );

  // GET /v1/admin/users — paginated user list
  fastify.get(
    '/users',
    { preHandler: requireAdmin },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { page = '1', limit = '20' } = request.query as { page?: string; limit?: string };
      const pageNum = Math.max(1, parseInt(page));
      const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
      const offset = (pageNum - 1) * limitNum;

      const rows = await db
        .select({
          id: users.id,
          email: users.email,
          role: users.role,
          kycStatus: users.kycStatus,
          walletAddress: users.walletAddress,
          createdAt: users.createdAt,
        })
        .from(users)
        .orderBy(desc(users.createdAt))
        .limit(limitNum)
        .offset(offset);

      const [{ total }] = await db.select({ total: count() }).from(users);

      reply.send({
        data: rows,
        pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
      });
    }
  );

  // GET /v1/admin/blocklist — list blocked addresses
  fastify.get(
    '/blocklist',
    { preHandler: requireAdmin },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { page = '1', limit = '20' } = request.query as { page?: string; limit?: string };
      const pageNum = Math.max(1, parseInt(page));
      const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
      const offset = (pageNum - 1) * limitNum;

      const rows = await db
        .select()
        .from(blocklistSyncLog)
        .orderBy(desc(blocklistSyncLog.createdAt))
        .limit(limitNum)
        .offset(offset);

      const [{ total }] = await db.select({ total: count() }).from(blocklistSyncLog);

      reply.send({
        data: rows,
        pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
      });
    }
  );

  // POST /v1/admin/blocklist — block an address
  fastify.post(
    '/blocklist',
    { preHandler: requireAdmin },
    async (
      request: FastifyRequest<{ Body: { wallet_address: string; reason: string } }>,
      reply: FastifyReply
    ) => {
      const adminId = (request.user as any).id;
      const { wallet_address, reason } = request.body;

      // Check on-chain status first
      const isAlreadyBlocked = await blocklistService.isBlocked(wallet_address).catch(() => false);
      if (isAlreadyBlocked) {
        return reply.code(400).send({ error: 'Address is already blocked on-chain' });
      }

      const txHash = await blocklistService.blockAddress(wallet_address);

      await db.insert(blocklistSyncLog).values({
        walletAddress: wallet_address,
        action: 'block',
        reason,
        txHash,
        initiatedBy: adminId,
      });

      reply.code(201).send({ success: true, tx_hash: txHash });
    }
  );

  // DELETE /v1/admin/blocklist/:address — unblock an address
  fastify.delete(
    '/blocklist/:address',
    { preHandler: requireAdmin },
    async (
      request: FastifyRequest<{ Params: { address: string }; Body: { reason: string } }>,
      reply: FastifyReply
    ) => {
      const adminId = (request.user as any).id;
      const { address } = request.params;
      const { reason } = request.body;

      const isBlocked = await blocklistService.isBlocked(address).catch(() => false);
      if (!isBlocked) {
        return reply.code(400).send({ error: 'Address is not blocked on-chain' });
      }

      const txHash = await blocklistService.unblockAddress(address);

      await db.insert(blocklistSyncLog).values({
        walletAddress: address,
        action: 'unblock',
        reason,
        txHash,
        initiatedBy: adminId,
      });

      reply.send({ success: true, tx_hash: txHash });
    }
  );

  // GET /v1/admin/blocklist/:address/check — check on-chain status
  fastify.get(
    '/blocklist/:address/check',
    { preHandler: requireAdmin },
    async (
      request: FastifyRequest<{ Params: { address: string } }>,
      reply: FastifyReply
    ) => {
      const { address } = request.params;
      const isBlocked = await blocklistService.isBlocked(address);
      reply.send({ address, is_blocked: isBlocked });
    }
  );
}
