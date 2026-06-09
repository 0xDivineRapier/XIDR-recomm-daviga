import Fastify from 'fastify';
import fastifyJwt from '@fastify/jwt';
import fastifyHelmet from '@fastify/helmet';
import fastifyCors from '@fastify/cors';
import { authRoutes } from './routes/auth.js';
import { ratesRoutes } from './routes/rates.js';
import { senderRoutes } from './routes/sender.js';
import { recipientRoutes } from './routes/recipient.js';
import { transferRoutes } from './routes/transfer.js';
import { webhookRoutes } from './routes/webhooks.js';

export async function buildApp() {
  const fastify = Fastify({ logger: { level: process.env.LOG_LEVEL || 'info' } });

  await fastify.register(fastifyHelmet);
  await fastify.register(fastifyCors, {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  });
  await fastify.register(fastifyJwt, {
    secret: process.env.JWT_SECRET || 'corridor-secret-min-32-chars-dev!!',
  });

  // Store raw body for webhook signature verification
  fastify.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    (req as any).rawBody = body;
    try { done(null, JSON.parse(body.toString())); } catch (e) { done(e as Error); }
  });

  fastify.get('/health', async () => ({ status: 'ok', service: 'xidr-corridor', timestamp: new Date().toISOString() }));

  await fastify.register(async (v1) => {
    await v1.register(authRoutes, { prefix: '/auth' });
    await v1.register(ratesRoutes, { prefix: '/rates' });
    await v1.register(senderRoutes, { prefix: '/sender' });
    await v1.register(recipientRoutes, { prefix: '/recipients' });
    await v1.register(transferRoutes, { prefix: '/transfers' });
  }, { prefix: '/v1' });

  await fastify.register(async (wh) => {
    await wh.register(webhookRoutes);
  }, { prefix: '/webhooks' });

  return fastify;
}

const isMain = process.argv[1]?.includes('server');
if (isMain) {
  const app = await buildApp();
  const port = parseInt(process.env.PORT || '3002');
  await app.listen({ port, host: '0.0.0.0' });
  console.log(`[corridor] Listening on port ${port}`);
}
