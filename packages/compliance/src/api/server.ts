import Fastify from 'fastify';
import fastifyJwt from '@fastify/jwt';
import fastifyHelmet from '@fastify/helmet';
import fastifyCors from '@fastify/cors';
import bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { registerRateLimit } from './middleware/rate-limit.js';
import { snapAccessToken } from './middleware/snap-auth.js';
import { kycRoutes } from './routes/kyc.js';
import { transactionRoutes } from './routes/transactions.js';
import { reserveRoutes } from './routes/reserves.js';
import { adminRoutes } from './routes/admin.js';
import { webhookRoutes } from './routes/webhooks.js';

export async function buildApp() {
  const fastify = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
    },
  });

  // Security
  await fastify.register(fastifyHelmet);
  await fastify.register(fastifyCors, {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  });

  // JWT
  await fastify.register(fastifyJwt, {
    secret: process.env.JWT_SECRET || 'changeme-32-chars-minimum-secret!',
  });

  // Rate limiting
  await registerRateLimit(fastify);

  // Health check
  fastify.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  // Auth routes
  fastify.post('/v1/auth/login', async (request, reply) => {
    const { email, password } = request.body as { email: string; password: string };
    const user = await db.query.users.findFirst({ where: eq(users.email, email) });
    if (!user) return reply.code(401).send({ error: 'Invalid credentials' });
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return reply.code(401).send({ error: 'Invalid credentials' });
    const token = fastify.jwt.sign({ id: user.id, email: user.email, role: user.role });
    reply.send({ token, role: user.role });
  });

  // SNAP Phase 1 access token
  fastify.post('/v1/auth/access-token', async (request, reply) => {
    return snapAccessToken(fastify, request, reply);
  });

  // Register route plugins under /v1 prefix
  await fastify.register(
    async (v1) => {
      await v1.register(kycRoutes, { prefix: '/kyc' });
      await v1.register(transactionRoutes, { prefix: '/transactions' });
      await v1.register(reserveRoutes, { prefix: '/reserves' });
      await v1.register(adminRoutes, { prefix: '/admin' });
      await v1.register(webhookRoutes, { prefix: '/webhooks' });
    },
    { prefix: '/v1' }
  );

  return fastify;
}

// Start server if this is the main module
const isMain = process.argv[1]?.includes('server');
if (isMain) {
  const app = await buildApp();
  const port = parseInt(process.env.PORT || '3001');
  await app.listen({ port, host: '0.0.0.0' });
  console.log(`[server] Listening on port ${port}`);
}
