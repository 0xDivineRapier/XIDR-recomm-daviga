import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../db/index.js';
import { transfers, senders, recipients } from '../db/schema.js';
import { eq, and, desc } from 'drizzle-orm';
import { redis, swapQueue } from '../jobs/queue.js';
import { FxRateService } from '../services/fx-rate.service.js';
import { paynowService } from '../services/paynow.service.js';
import { stripeService } from '../services/stripe.service.js';
import { smsService } from '../services/sms.service.js';

const fxRateService = new FxRateService(redis);

const requireAuth = async (req: FastifyRequest, rep: FastifyReply) => {
  try { await req.jwtVerify(); } catch { rep.code(401).send({ error: 'Unauthorized' }); }
};

export async function transferRoutes(fastify: FastifyInstance) {
  // POST /v1/transfers
  fastify.post('/', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const senderId = (request.user as any).id;
    const { recipient_id, sgd_amount, payment_method, stripe_payment_method_id } = request.body as any;

    if (!recipient_id || !sgd_amount || !payment_method) {
      return reply.code(400).send({ error: 'recipient_id, sgd_amount, payment_method required' });
    }
    if (sgd_amount < 10 || sgd_amount > 10000) {
      return reply.code(400).send({ error: 'sgd_amount must be between 10 and 10000' });
    }
    if (!['paynow', 'card'].includes(payment_method)) {
      return reply.code(400).send({ error: 'payment_method must be paynow or card' });
    }

    // KYC check
    const sender = await db.query.senders.findFirst({ where: eq(senders.id, senderId) });
    if (!sender) return reply.code(404).send({ error: 'Sender not found' });
    if (sender.kycStatus !== 'approved') {
      return reply.code(403).send({ error: 'KYC approval required before transfers' });
    }

    // Recipient check
    const recipient = await db.query.recipients.findFirst({
      where: and(eq(recipients.id, recipient_id), eq(recipients.senderId, senderId)),
    });
    if (!recipient) return reply.code(404).send({ error: 'Recipient not found' });

    // Get rate
    let rate = await fxRateService.getCachedRate();
    if (!rate) rate = await fxRateService.refreshRate();
    if (!rate) return reply.code(503).send({ error: 'Rate feed unavailable' });

    const { sgdFee, sgdNet } = fxRateService.calculateFee(sgd_amount);
    const idrAmount = Math.round(sgdNet * rate.effectiveRate);
    const fxRateLockedAt = new Date();
    const fxRateExpiresAt = new Date(fxRateLockedAt.getTime() + 15 * 60 * 1000);
    const expiresAt = new Date(fxRateLockedAt.getTime() + 30 * 60 * 1000);

    // Build transfer record
    const transferValues: any = {
      senderId,
      recipientId: recipient_id,
      status: 'pending_payment',
      sgdAmount: sgd_amount.toFixed(2),
      sgdFee: sgdFee.toFixed(2),
      sgdNet: sgdNet.toFixed(2),
      fxRate: rate.effectiveRate.toFixed(4),
      fxRateLockedAt,
      fxRateExpiresAt,
      idrAmount: idrAmount.toFixed(0),
      xidrAmount: idrAmount.toFixed(0),
      paymentMethod: payment_method,
      expiresAt,
      xsgdAmount: sgdNet.toFixed(2),
    };

    let paynowQrString: string | undefined;
    let paynowReference: string | undefined;
    let stripeClientSecret: string | undefined;

    // Insert early to get ID for payment reference
    const [transfer] = await db.insert(transfers).values(transferValues).returning();

    if (payment_method === 'paynow') {
      const { qrString, reference } = paynowService.generateQR({
        sgdAmount: sgdNet,
        reference: transfer.id,
        expiresAt,
      });
      paynowQrString = qrString;
      paynowReference = reference;
      await db.update(transfers).set({ paynowReference: reference, paynowQrString: qrString }).where(eq(transfers.id, transfer.id));
    } else {
      const amountCents = Math.round(sgdNet * 100);
      const { clientSecret, paymentIntentId } = await stripeService.createPaymentIntent({
        amountCents,
        transferId: transfer.id,
        senderEmail: sender.email || undefined,
      });
      stripeClientSecret = clientSecret;
      await db.update(transfers).set({ stripePaymentIntentId: paymentIntentId }).where(eq(transfers.id, transfer.id));
    }

    const response: any = {
      transfer_id: transfer.id,
      status: 'pending_payment',
      sgd_amount,
      sgd_fee: sgdFee,
      idr_amount: idrAmount,
      effective_rate: rate.effectiveRate,
      fx_rate_expires_at: fxRateExpiresAt.toISOString(),
      payment_method,
      expires_at: expiresAt.toISOString(),
    };
    if (paynowQrString) { response.paynow_qr_string = paynowQrString; response.paynow_reference = paynowReference; }
    if (stripeClientSecret) response.stripe_client_secret = stripeClientSecret;

    reply.code(201).send(response);
  });

  // GET /v1/transfers/:id
  fastify.get('/:id', { preHandler: requireAuth }, async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const senderId = (request.user as any).id;
    const { id } = request.params;
    const transfer = await db.query.transfers.findFirst({
      where: and(eq(transfers.id, id), eq(transfers.senderId, senderId)),
    });
    if (!transfer) return reply.code(404).send({ error: 'Transfer not found' });
    reply.send(transfer);
  });

  // GET /v1/transfers
  fastify.get('/', { preHandler: requireAuth }, async (request: FastifyRequest, reply) => {
    const senderId = (request.user as any).id;
    const { page = '1', limit = '20', status } = request.query as any;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(50, parseInt(limit));
    const offset = (pageNum - 1) * limitNum;

    const rows = await db.select().from(transfers)
      .where(eq(transfers.senderId, senderId))
      .orderBy(desc(transfers.createdAt))
      .limit(limitNum).offset(offset);
    reply.send({ data: rows, pagination: { page: pageNum, limit: limitNum } });
  });

  // POST /v1/transfers/:id/cancel
  fastify.post('/:id/cancel', { preHandler: requireAuth }, async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const senderId = (request.user as any).id;
    const { id } = request.params;
    const transfer = await db.query.transfers.findFirst({
      where: and(eq(transfers.id, id), eq(transfers.senderId, senderId)),
    });
    if (!transfer) return reply.code(404).send({ error: 'Transfer not found' });
    if (transfer.status !== 'pending_payment') {
      return reply.code(400).send({ error: `Cannot cancel transfer in status: ${transfer.status}` });
    }
    if (transfer.stripePaymentIntentId) {
      await stripeService.cancelPaymentIntent(transfer.stripePaymentIntentId).catch(() => {});
    }
    await db.update(transfers).set({ status: 'expired' }).where(eq(transfers.id, id));
    reply.send({ status: 'expired' });
  });

  // Public transfer tracker — no auth
  fastify.get('/track/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const { id } = request.params;
    const transfer = await db.query.transfers.findFirst({ where: eq(transfers.id, id) });
    if (!transfer) return reply.code(404).send({ error: 'Transfer not found' });

    const sender = await db.query.senders.findFirst({ where: eq(senders.id, transfer.senderId) });
    const recipient = await db.query.recipients.findFirst({ where: eq(recipients.id, transfer.recipientId) });

    reply.send({
      transfer_id: id,
      status: transfer.status,
      idr_amount: transfer.idrAmount,
      recipient_name: recipient?.fullName,
      sender_first_name: sender?.fullName?.split(' ')[0] || 'Sender',
      created_at: transfer.createdAt,
      completed_at: transfer.completedAt,
    });
  });
}
