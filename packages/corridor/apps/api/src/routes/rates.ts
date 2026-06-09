import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { redis } from '../jobs/queue.js';
import { FxRateService } from '../services/fx-rate.service.js';

const fxRateService = new FxRateService(redis);

export async function ratesRoutes(fastify: FastifyInstance) {
  // GET /v1/rates/current — public
  fastify.get('/current', async (_request: FastifyRequest, reply: FastifyReply) => {
    let rate = await fxRateService.getCachedRate();
    if (!rate) {
      rate = await fxRateService.refreshRate();
    }
    if (!rate) return reply.code(503).send({ error: 'Rate feed unavailable' });

    const validUntil = new Date(Date.now() + 60000).toISOString();
    reply.send({
      sgd_idr: parseFloat(rate.sgdIdr.toFixed(4)),
      effective_rate: parseFloat(rate.effectiveRate.toFixed(4)),
      spread_pct: parseFloat((rate.spreadApplied * 100).toFixed(2)),
      valid_until: validUntil,
      source: rate.source,
    });
  });

  // POST /v1/rates/quote — JWT required
  fastify.post('/quote', {
    preHandler: async (req, rep) => { try { await req.jwtVerify(); } catch { rep.code(401).send({ error: 'Unauthorized' }); } },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { sgd_amount } = request.body as { sgd_amount: number };
    if (!sgd_amount || sgd_amount < 10 || sgd_amount > 10000) {
      return reply.code(400).send({ error: 'sgd_amount must be between 10 and 10000' });
    }

    let rate = await fxRateService.getCachedRate();
    if (!rate) rate = await fxRateService.refreshRate();
    if (!rate) return reply.code(503).send({ error: 'Rate feed unavailable' });

    const { sgdFee, sgdNet } = fxRateService.calculateFee(sgd_amount);
    const idrAmount = Math.round(sgdNet * rate.effectiveRate);
    const rateLocked = new Date();
    const rateLockedUntil = new Date(rateLocked.getTime() + 15 * 60 * 1000);

    // Cache quote in Redis keyed by sender_id
    const senderId = (request.user as any).id;
    await redis.setex(`corridor:quote:${senderId}`, 900, JSON.stringify({
      sgd_amount, sgdFee, sgdNet, effectiveRate: rate.effectiveRate, idrAmount,
      lockedAt: rateLocked.toISOString(), expiresAt: rateLockedUntil.toISOString(),
    }));

    reply.send({
      sgd_amount,
      sgd_fee: sgdFee,
      sgd_net: sgdNet,
      effective_rate: rate.effectiveRate,
      idr_amount: idrAmount,
      rate_locked_until: rateLockedUntil.toISOString(),
    });
  });
}
