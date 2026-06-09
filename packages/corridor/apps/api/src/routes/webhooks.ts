import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import { db } from '../db/index.js';
import { transfers, senders } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { swapQueue } from '../jobs/queue.js';
import { smsService } from '../services/sms.service.js';
import { stripeService } from '../services/stripe.service.js';
import { paynowService } from '../services/paynow.service.js';

export async function webhookRoutes(fastify: FastifyInstance) {
  // POST /webhooks/paynow
  fastify.post('/paynow', {
    config: { rawBody: true },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const token = (request.headers['x-callback-token'] || '') as string;
    if (!paynowService.verifyWebhookSignature('', token)) {
      return reply.code(401).send({ error: 'Invalid webhook signature' });
    }
    reply.code(200).send({ received: true });

    // Async processing
    setImmediate(async () => {
      try {
        const body = request.body as any;
        const { reference, amount, status } = body;
        if (status !== 'COMPLETED') return;

        const transfer = await db.query.transfers.findFirst({
          where: eq(transfers.paynowReference, reference),
        });
        if (!transfer || transfer.status !== 'pending_payment') return;

        const expectedAmount = parseFloat(transfer.sgdNet);
        const paidAmount = parseFloat(amount);
        if (Math.abs(paidAmount - expectedAmount) > 0.01) {
          console.error(`[webhook/paynow] Amount mismatch: expected ${expectedAmount}, got ${paidAmount}`);
          return;
        }

        await db.update(transfers).set({
          status: 'payment_received',
          paymentReceivedAt: new Date(),
        }).where(eq(transfers.id, transfer.id));

        await swapQueue.add('swap', { transfer_id: transfer.id }, { attempts: 2 });

        const sender = await db.query.senders.findFirst({ where: eq(senders.id, transfer.senderId) });
        if (sender) await smsService.sendPaymentReceivedSMS(sender.phoneNumber, transfer.id, parseFloat(transfer.sgdAmount));
      } catch (e) {
        console.error('[webhook/paynow] Processing error:', e);
      }
    });
  });

  // POST /webhooks/stripe
  fastify.post('/stripe', {
    config: { rawBody: true },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    reply.code(200).send({ received: true });

    setImmediate(async () => {
      try {
        const rawBody = (request as any).rawBody as Buffer;
        const sig = request.headers['stripe-signature'] as string;
        let event: any;
        try {
          event = stripeService.verifyWebhookSignature(rawBody, sig);
        } catch (e) {
          console.error('[webhook/stripe] Invalid signature:', e);
          return;
        }

        if (event.type === 'payment_intent.succeeded') {
          const pi = event.data.object;
          const transferId = pi.metadata?.transfer_id;
          if (!transferId) return;
          const transfer = await db.query.transfers.findFirst({ where: eq(transfers.id, transferId) });
          if (!transfer || transfer.status !== 'pending_payment') return;

          await db.update(transfers).set({ status: 'payment_received', paymentReceivedAt: new Date() }).where(eq(transfers.id, transferId));
          await swapQueue.add('swap', { transfer_id: transferId }, { attempts: 2 });

          const sender = await db.query.senders.findFirst({ where: eq(senders.id, transfer.senderId) });
          if (sender) await smsService.sendPaymentReceivedSMS(sender.phoneNumber, transferId, parseFloat(transfer.sgdAmount));
        } else if (event.type === 'payment_intent.payment_failed') {
          const pi = event.data.object;
          const transferId = pi.metadata?.transfer_id;
          if (!transferId) return;
          await db.update(transfers).set({ status: 'failed', failureReason: 'card_payment_failed' }).where(eq(transfers.id, transferId));
        }
      } catch (e) {
        console.error('[webhook/stripe] Processing error:', e);
      }
    });
  });

  // POST /webhooks/corridor-redeem — from Fix 3 outbound webhook
  fastify.post('/corridor-redeem', async (request: FastifyRequest, reply: FastifyReply) => {
    const sig = (request.headers['x-xidr-signature'] || '') as string;
    const event = (request.headers['x-xidr-event'] || '') as string;
    const body = JSON.stringify(request.body);

    // Verify Fix 3 outbound webhook signature
    const secret = process.env.FIX3_WEBHOOK_SECRET || '';
    if (secret) {
      const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
      const provided = sig.replace('sha256=', '');
      try {
        if (!crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) {
          return reply.code(401).send({ error: 'Invalid signature' });
        }
      } catch {
        return reply.code(401).send({ error: 'Invalid signature' });
      }
    }

    reply.code(200).send({ received: true });

    setImmediate(async () => {
      try {
        const payload = request.body as any;
        const transferId = payload?.metadata?.transfer_id || payload?.idempotency_key;
        if (!transferId) return;

        const transfer = await db.query.transfers.findFirst({ where: eq(transfers.id, transferId) });
        if (!transfer) return;

        if (event === 'redeem.completed') {
          await db.update(transfers).set({
            status: 'completed',
            completedAt: new Date(),
            disbursedAt: new Date(),
          }).where(eq(transfers.id, transferId));

          const sender = await db.query.senders.findFirst({ where: eq(senders.id, transfer.senderId) });
          if (sender) {
            const { recipients } = await import('../db/schema.js');
            const recipient = await db.query.recipients.findFirst({ where: eq(recipients.id, transfer.recipientId) });
            await smsService.sendTransferCompletedSMS(
              sender.phoneNumber,
              transferId,
              parseFloat(transfer.idrAmount),
              recipient?.fullName || 'Recipient'
            );
          }
        } else if (event === 'redeem.failed') {
          await db.update(transfers).set({ status: 'failed', failureReason: 'Disbursement failed' }).where(eq(transfers.id, transferId));
          const sender = await db.query.senders.findFirst({ where: eq(senders.id, transfer.senderId) });
          if (sender) await smsService.sendTransferFailedSMS(sender.phoneNumber, transferId, 'Bank transfer failed');
        }
      } catch (e) {
        console.error('[webhook/corridor-redeem] Processing error:', e);
      }
    });
  });
}
