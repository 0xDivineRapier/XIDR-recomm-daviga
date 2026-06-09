import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eq, desc, count } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { users, kycSubmissions } from '../../db/schema.js';
import { kycService } from '../../services/kyc.service.js';
import { notificationService } from '../../services/notification.service.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

export async function kycRoutes(fastify: FastifyInstance) {
  // POST /v1/kyc/individual/start
  fastify.post(
    '/individual/start',
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = (request.user as any).id;

      // Check if user already has an approved KYC
      const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
      if (!user) return reply.code(404).send({ error: 'User not found' });
      if (user.kycStatus === 'approved') {
        return reply.code(400).send({ error: 'KYC already approved' });
      }

      const { inquiryId, hostedFlowUrl } = await kycService.createIndividualInquiry(userId);

      await db.insert(kycSubmissions).values({
        userId,
        type: 'individual',
        personaInquiryId: inquiryId,
        status: 'pending',
      });

      await db.update(users)
        .set({ personaInquiryId: inquiryId, kycStatus: 'submitted', updatedAt: new Date() })
        .where(eq(users.id, userId));

      reply.code(201).send({ inquiry_id: inquiryId, hosted_flow_url: hostedFlowUrl });
    }
  );

  // POST /v1/kyc/business/start
  fastify.post(
    '/business/start',
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = (request.user as any).id;

      const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
      if (!user) return reply.code(404).send({ error: 'User not found' });
      if (user.kycStatus === 'approved') {
        return reply.code(400).send({ error: 'KYC already approved' });
      }

      const { inquiryId, hostedFlowUrl } = await kycService.createBusinessInquiry(userId);

      await db.insert(kycSubmissions).values({
        userId,
        type: 'business',
        personaInquiryId: inquiryId,
        status: 'pending',
      });

      await db.update(users)
        .set({ personaInquiryId: inquiryId, kycStatus: 'submitted', updatedAt: new Date() })
        .where(eq(users.id, userId));

      reply.code(201).send({ inquiry_id: inquiryId, hosted_flow_url: hostedFlowUrl });
    }
  );

  // GET /v1/kyc/status
  fastify.get(
    '/status',
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = (request.user as any).id;

      const submissions = await db.query.kycSubmissions.findMany({
        where: eq(kycSubmissions.userId, userId),
        orderBy: [desc(kycSubmissions.createdAt)],
      });

      const user = await db.query.users.findFirst({ where: eq(users.id, userId) });

      reply.send({
        kyc_status: user?.kycStatus ?? 'pending',
        submissions: submissions.map((s) => ({
          id: s.id,
          type: s.type,
          status: s.status,
          persona_inquiry_id: s.personaInquiryId,
          rejection_reason: s.rejectionReason,
          submitted_at: s.submittedAt,
          reviewed_at: s.reviewedAt,
          created_at: s.createdAt,
        })),
      });
    }
  );

  // GET /v1/kyc/submissions — admin only, paginated
  fastify.get(
    '/submissions',
    { preHandler: requireAdmin },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { page = '1', limit = '20', status } = request.query as {
        page?: string;
        limit?: string;
        status?: string;
      };
      const pageNum = Math.max(1, parseInt(page));
      const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
      const offset = (pageNum - 1) * limitNum;

      const query = db.query.kycSubmissions.findMany({
        limit: limitNum,
        offset,
        orderBy: [desc(kycSubmissions.createdAt)],
        with: { userId: true } as any,
      });

      const rows = await db
        .select()
        .from(kycSubmissions)
        .limit(limitNum)
        .offset(offset)
        .orderBy(desc(kycSubmissions.createdAt));

      const [{ total }] = await db.select({ total: count() }).from(kycSubmissions);

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

  // PATCH /v1/kyc/submissions/:id/review — admin only
  fastify.patch(
    '/submissions/:id/review',
    { preHandler: requireAdmin },
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: { action: 'approve' | 'reject'; rejection_reason?: string } }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;
      const { action, rejection_reason } = request.body;

      const submission = await db.query.kycSubmissions.findFirst({
        where: eq(kycSubmissions.id, id),
      });
      if (!submission) return reply.code(404).send({ error: 'Submission not found' });

      if (action === 'approve') {
        await db.update(kycSubmissions)
          .set({ status: 'approved', reviewedAt: new Date() })
          .where(eq(kycSubmissions.id, id));

        await db.update(users)
          .set({ kycStatus: 'approved', updatedAt: new Date() })
          .where(eq(users.id, submission.userId));

        const user = await db.query.users.findFirst({ where: eq(users.id, submission.userId) });
        if (user) {
          await notificationService.sendKycApprovalEmail(user.email).catch(() => {});
        }
      } else if (action === 'reject') {
        await db.update(kycSubmissions)
          .set({
            status: 'rejected',
            rejectionReason: rejection_reason || 'Did not meet requirements',
            reviewedAt: new Date(),
          })
          .where(eq(kycSubmissions.id, id));

        await db.update(users)
          .set({ kycStatus: 'rejected', updatedAt: new Date() })
          .where(eq(users.id, submission.userId));

        const user = await db.query.users.findFirst({ where: eq(users.id, submission.userId) });
        if (user) {
          await notificationService
            .sendKycRejectionEmail(user.email, rejection_reason || 'Did not meet requirements')
            .catch(() => {});
        }
      } else {
        return reply.code(400).send({ error: 'Invalid action. Must be approve or reject' });
      }

      reply.send({ success: true, action });
    }
  );
}
