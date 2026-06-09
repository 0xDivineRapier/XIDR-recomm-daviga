import crypto from 'crypto';
import { FastifyRequest, FastifyReply, FastifyInstance } from 'fastify';

// Phase 1: POST /v1/auth/access-token
// Verifies SHA256WithRSA signature, issues short-lived access token
export async function snapAccessToken(
  fastify: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply
) {
  const { clientKey, timestamp } = request.body as { clientKey?: string; timestamp?: string };
  if (!clientKey || !timestamp) {
    return reply.code(400).send({ responseCode: '4010000', responseMessage: 'Bad Request' });
  }
  const signature = (request.headers['x-signature'] as string) || '';
  const stringToSign = `${clientKey}|${timestamp}`;
  const clientPublicKey = process.env.SNAP_CLIENT_PUBLIC_KEY!;
  try {
    const verify = crypto.createVerify('SHA256');
    verify.update(stringToSign);
    const isValid = verify.verify(clientPublicKey, signature, 'base64');
    if (!isValid) {
      return reply.code(401).send({ responseCode: '4010000', responseMessage: 'Unauthorized' });
    }
  } catch {
    return reply.code(401).send({ responseCode: '4010000', responseMessage: 'Unauthorized' });
  }
  const accessToken = fastify.jwt.sign(
    { clientKey, type: 'snap' },
    { expiresIn: '15m' }
  );
  reply.send({ accessToken, tokenType: 'Bearer', expiresIn: 900 });
}

// Phase 2: symmetric HMAC-SHA512 verification middleware
export async function snapServiceAuth(request: FastifyRequest, reply: FastifyReply) {
  const accessToken = (request.headers['authorization'] || '').replace('Bearer ', '');
  const timestamp = request.headers['x-timestamp'] as string;
  const clientKey = request.headers['x-client-key'] as string;
  const signature = request.headers['x-signature'] as string;

  if (!accessToken || !timestamp || !clientKey || !signature) {
    return reply.code(401).send({ responseCode: '4010001', responseMessage: 'Missing SNAP headers' });
  }

  const method = request.method.toUpperCase();
  const path = request.url;
  const bodyStr = JSON.stringify(request.body) || '';
  const bodyHash = crypto.createHash('sha256').update(bodyStr).digest('hex').toLowerCase();
  const stringToSign = `${method}:${path}:${accessToken}:${bodyHash}:${timestamp}`;
  const expected = crypto
    .createHmac('sha512', process.env.JWT_SECRET!)
    .update(stringToSign)
    .digest('hex');

  try {
    const sigBuf = Buffer.from(signature, 'hex');
    const expBuf = Buffer.from(expected, 'hex');
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return reply.code(401).send({ responseCode: '4010001', responseMessage: 'Invalid SNAP signature' });
    }
  } catch {
    return reply.code(401).send({ responseCode: '4010001', responseMessage: 'Invalid SNAP signature' });
  }
}
