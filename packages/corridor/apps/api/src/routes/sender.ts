import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../db/index.js';
import { senders } from '../db/schema.js';
import { eq } from 'drizzle-orm';

const requireAuth = async (req: FastifyRequest, rep: FastifyReply) => {
  try { await req.jwtVerify(); } catch { rep.code(401).send({ error: 'Unauthorized' }); }
};

export async function senderRoutes(fastify: FastifyInstance) {
  fastify.get('/profile', { preHandler: requireAuth }, async (request, reply) => {
    const senderId = (request.user as any).id;
    const sender = await db.query.senders.findFirst({ where: eq(senders.id, senderId) });
    if (!sender) return reply.code(404).send({ error: 'Sender not found' });
    const { nricFin: _, ...safe } = sender; // never return encrypted NRIC in API
    reply.send(safe);
  });

  fastify.post('/kyc/start', { preHandler: requireAuth }, async (request, reply) => {
    const senderId = (request.user as any).id;
    const sender = await db.query.senders.findFirst({ where: eq(senders.id, senderId) });
    if (!sender) return reply.code(404).send({ error: 'Sender not found' });
    if (sender.kycStatus === 'approved') return reply.code(400).send({ error: 'KYC already approved' });

    // Call Persona KYC — reuse from Fix 2 environment
    const personaKey = process.env.PERSONA_API_KEY;
    const templateId = process.env.PERSONA_INDIVIDUAL_TEMPLATE_ID;
    if (!personaKey || !templateId) return reply.code(503).send({ error: 'KYC service not configured' });

    const resp = await fetch('https://withpersona.com/api/v1/inquiries', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${personaKey}`,
        'Content-Type': 'application/json',
        'Persona-Version': '2023-01-05',
      },
      body: JSON.stringify({
        data: {
          type: 'inquiry',
          attributes: { 'inquiry-template-id': templateId, 'reference-id': senderId },
        },
      }),
    });
    if (!resp.ok) return reply.code(502).send({ error: 'KYC provider unavailable' });
    const data = await resp.json() as any;
    const inquiryId = data.data.id;

    await db.update(senders).set({ personaInquiryId: inquiryId, kycStatus: 'pending', updatedAt: new Date() }).where(eq(senders.id, senderId));
    reply.send({
      inquiry_id: inquiryId,
      persona_hosted_flow_url: `https://withpersona.com/verify?inquiry-id=${inquiryId}`,
    });
  });

  fastify.get('/kyc/status', { preHandler: requireAuth }, async (request, reply) => {
    const senderId = (request.user as any).id;
    const sender = await db.query.senders.findFirst({ where: eq(senders.id, senderId) });
    if (!sender) return reply.code(404).send({ error: 'Sender not found' });
    reply.send({ kyc_status: sender.kycStatus, persona_inquiry_id: sender.personaInquiryId });
  });
}
