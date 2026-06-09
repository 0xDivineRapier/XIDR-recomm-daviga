import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../db/index.js';
import { senders, otpSessions } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { otpService } from '../services/otp.service.js';

export async function authRoutes(fastify: FastifyInstance) {
  // POST /v1/auth/otp/send
  fastify.post('/otp/send', async (request: FastifyRequest, reply: FastifyReply) => {
    const { phone_number } = request.body as { phone_number: string };
    if (!phone_number?.startsWith('+65')) {
      return reply.code(400).send({ error: 'Only Singapore numbers (+65) are supported' });
    }

    const sid = await otpService.sendOTP(phone_number);
    await db.insert(otpSessions).values({
      phoneNumber: phone_number,
      twilioVerificationSid: sid,
      status: 'pending',
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });

    reply.send({ verification_sid: sid, expires_in: 300 });
  });

  // POST /v1/auth/otp/verify
  fastify.post('/otp/verify', async (request: FastifyRequest, reply: FastifyReply) => {
    const { phone_number, code } = request.body as { phone_number: string; code: string };
    if (!phone_number || !code) {
      return reply.code(400).send({ error: 'phone_number and code required' });
    }

    const status = await otpService.verifyOTP(phone_number, code);
    if (status !== 'approved') {
      return reply.code(401).send({ error: 'Invalid or expired OTP' });
    }

    // Create or fetch sender
    let sender = await db.query.senders.findFirst({ where: eq(senders.phoneNumber, phone_number) });
    const isNewUser = !sender;
    if (!sender) {
      const [created] = await db.insert(senders).values({ phoneNumber: phone_number }).returning();
      sender = created;
    }

    const token = fastify.jwt.sign({ id: sender.id, phone: phone_number }, { expiresIn: '15m' });
    const refreshToken = fastify.jwt.sign({ id: sender.id, type: 'refresh' }, { expiresIn: '7d' });

    reply.send({ access_token: token, refresh_token: refreshToken, sender_id: sender.id, is_new_user: isNewUser });
  });

  // POST /v1/auth/refresh
  fastify.post('/refresh', async (request: FastifyRequest, reply: FastifyReply) => {
    const { refresh_token } = request.body as { refresh_token: string };
    try {
      const payload = fastify.jwt.verify(refresh_token) as any;
      if (payload.type !== 'refresh') return reply.code(401).send({ error: 'Invalid token type' });
      const token = fastify.jwt.sign({ id: payload.id, type: 'access' }, { expiresIn: '15m' });
      reply.send({ access_token: token });
    } catch {
      reply.code(401).send({ error: 'Invalid or expired refresh token' });
    }
  });
}
