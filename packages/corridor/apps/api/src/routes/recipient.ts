import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../db/index.js';
import { recipients } from '../db/schema.js';
import { eq, and, isNull } from 'drizzle-orm';

const requireAuth = async (req: FastifyRequest, rep: FastifyReply) => {
  try { await req.jwtVerify(); } catch { rep.code(401).send({ error: 'Unauthorized' }); }
};

async function verifyWithFlip(accountNumber: string, bankCode: string | undefined, payoutType: string): Promise<{ isVerified: boolean; accountName: string }> {
  const flipKey = process.env.FLIP_SECRET_KEY;
  if (!flipKey) return { isVerified: false, accountName: '' };
  try {
    const base64 = Buffer.from(`${flipKey}:`).toString('base64');
    const isEwallet = ['gopay', 'ovo', 'dana'].includes(payoutType);
    const url = isEwallet
      ? `https://bigflip.id/big_sandbox_api/v2/disbursement/ewallet-payment?account_number=${accountNumber}&account_type=${payoutType.toUpperCase()}`
      : `https://bigflip.id/big_sandbox_api/v2/disbursement/bank-account-inquiry?account_number=${accountNumber}&bank_code=${bankCode}`;
    const resp = await fetch(url, { headers: { 'Authorization': `Basic ${base64}` } });
    if (!resp.ok) return { isVerified: false, accountName: '' };
    const data = await resp.json() as any;
    return { isVerified: true, accountName: data.account_name || '' };
  } catch {
    return { isVerified: false, accountName: '' };
  }
}

export async function recipientRoutes(fastify: FastifyInstance) {
  fastify.post('/', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const senderId = (request.user as any).id;
    const { nickname, full_name, payout_type, bank_code, account_number } = request.body as any;

    if (!nickname || !full_name || !payout_type || !account_number) {
      return reply.code(400).send({ error: 'nickname, full_name, payout_type, account_number required' });
    }
    if (payout_type === 'bank_transfer' && !bank_code) {
      return reply.code(400).send({ error: 'bank_code required for bank_transfer' });
    }

    const { isVerified, accountName } = await verifyWithFlip(account_number, bank_code, payout_type);

    const [recipient] = await db.insert(recipients).values({
      senderId,
      nickname,
      fullName: full_name,
      payoutType: payout_type,
      bankCode: bank_code || null,
      accountNumber: account_number,
      isVerified,
    }).returning();

    reply.code(201).send({ recipient_id: recipient.id, is_verified: isVerified, account_name: accountName });
  });

  fastify.get('/', { preHandler: requireAuth }, async (request, reply) => {
    const senderId = (request.user as any).id;
    const rows = await db.select().from(recipients)
      .where(and(eq(recipients.senderId, senderId), isNull(recipients.deletedAt)));
    reply.send(rows);
  });

  fastify.delete('/:id', { preHandler: requireAuth }, async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const senderId = (request.user as any).id;
    const { id } = request.params;
    await db.update(recipients).set({ deletedAt: new Date() })
      .where(and(eq(recipients.id, id), eq(recipients.senderId, senderId)));
    reply.code(204).send();
  });
}
