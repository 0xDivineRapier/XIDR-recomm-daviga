import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { users, kycSubmissions, transactions, amlAlerts } from '../../db/schema.js';
import { kycService } from '../../services/kyc.service.js';
import { amlService } from '../../services/aml.service.js';
import { notificationService } from '../../services/notification.service.js';
import { kycReviewQueue, amlScreeningQueue } from '../../jobs/queue.js';

export async function webhookRoutes(fastify: FastifyInstance) {
  // Store raw body for signature verification
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (req, body, done) => {
      try {
        const parsed = JSON.parse(body as string);
        (req as any).rawBody = body as string;
        done(null, parsed);
      } catch (err: any) {
        done(err, undefined);
      }
    }
  );

  // POST /v1/webhooks/persona
  fastify.post('/persona', async (request: FastifyRequest, reply: FastifyReply) => {
    const rawBody = (request as any).rawBody as string || '';
    const signature = (request.headers['persona-signature'] as string) || '';

    // Verify signature
    if (!kycService.verifyWebhookSignature(rawBody, signature)) {
      return reply.code(401).send({ error: 'Invalid signature' });
    }

    // Respond 200 immediately, process async
    reply.code(200).send({ received: true });

    const event = request.body as any;
    const eventName: string = event?.data?.attributes?.name || event?.type || '';
    const inquiryId: string =
      event?.data?.attributes?.payload?.data?.id ||
      event?.data?.relationships?.inquiry?.data?.id ||
      '';

    try {
      if (!inquiryId) return;

      const submission = await db.query.kycSubmissions.findFirst({
        where: eq(kycSubmissions.personaInquiryId, inquiryId),
      });

      if (!submission) return;

      if (eventName === 'inquiry.approved' || eventName === 'inquiry.completed') {
        await db.update(kycSubmissions)
          .set({ status: 'approved', submittedAt: new Date(), rawPersonaResponse: event })
          .where(eq(kycSubmissions.id, submission.id));

        await db.update(users)
          .set({ kycStatus: 'approved', updatedAt: new Date() })
          .where(eq(users.id, submission.userId));

        await kycReviewQueue.add('review', {
          userId: submission.userId,
          kycSubmissionId: submission.id,
          personaInquiryId: inquiryId,
        });
      } else if (eventName === 'inquiry.declined') {
        const reason = event?.data?.attributes?.payload?.data?.attributes?.['rejection-reason'] || 'Declined by Persona';
        await db.update(kycSubmissions)
          .set({ status: 'rejected', rejectionReason: reason, reviewedAt: new Date(), rawPersonaResponse: event })
          .where(eq(kycSubmissions.id, submission.id));

        await db.update(users)
          .set({ kycStatus: 'rejected', updatedAt: new Date() })
          .where(eq(users.id, submission.userId));

        const user = await db.query.users.findFirst({ where: eq(users.id, submission.userId) });
        if (user) {
          await notificationService.sendKycRejectionEmail(user.email, reason).catch(() => {});
        }
      } else if (eventName === 'inquiry.expired') {
        await db.update(kycSubmissions)
          .set({ status: 'needs_review', rawPersonaResponse: event })
          .where(eq(kycSubmissions.id, submission.id));
      }
    } catch (err) {
      fastify.log.error({ err }, '[webhook/persona] Processing error');
    }
  });

  // POST /v1/webhooks/chainalysis
  fastify.post('/chainalysis', async (request: FastifyRequest, reply: FastifyReply) => {
    const rawBody = (request as any).rawBody as string || '';
    const providedSecret = (request.headers['x-api-key'] as string) || '';

    if (!amlService.verifyWebhookSignature(rawBody, providedSecret)) {
      return reply.code(401).send({ error: 'Invalid signature' });
    }

    // Respond 200 immediately
    reply.code(200).send({ received: true });

    const event = request.body as any;
    const txHash: string = event?.transferReference || event?.txHash || '';
    const riskScore: number = event?.riskScore ?? 0;
    const alertType: string = event?.alertType || 'risk_score';

    try {
      if (!txHash) return;

      const tx = await db.query.transactions.findFirst({
        where: eq(transactions.txHash, txHash),
      });

      if (!tx) return;

      const severity: 'low' | 'medium' | 'high' | 'critical' =
        riskScore > 90 ? 'critical' : riskScore > 70 ? 'high' : riskScore > 50 ? 'medium' : 'low';

      // Create or update AML alert
      await db.insert(amlAlerts).values({
        transactionId: tx.id,
        alertType,
        severity,
        chainalysisData: event,
        status: 'open',
      });

      // Update transaction risk score
      await db.update(transactions)
        .set({
          riskScore,
          amlStatus: riskScore > 90 ? 'blocked' : riskScore > 70 ? 'flagged' : 'cleared',
          screenedAt: new Date(),
        })
        .where(eq(transactions.id, tx.id));

      if (severity === 'high' || severity === 'critical') {
        await amlScreeningQueue.add('screen', {
          transactionId: tx.id,
          txHash,
          alertId: null,
        });

        await notificationService.sendAmlAlertEmail({
          txHash,
          severity,
          alertType,
          riskScore,
        }).catch(() => {});
      }
    } catch (err) {
      fastify.log.error({ err }, '[webhook/chainalysis] Processing error');
    }
  });
}
