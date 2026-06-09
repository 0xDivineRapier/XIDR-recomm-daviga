import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';

vi.mock('../src/db/index.js', () => ({
  db: {
    query: {
      users: { findFirst: vi.fn() },
      kycSubmissions: { findFirst: vi.fn() },
      transactions: { findFirst: vi.fn() },
    },
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) }),
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({ offset: vi.fn().mockResolvedValue([]) }),
        orderBy: vi.fn().mockResolvedValue([]),
      }),
    }),
  },
}));

vi.mock('../src/services/kyc.service.js', () => ({
  kycService: {
    createIndividualInquiry: vi.fn(),
    verifyWebhookSignature: vi.fn(),
  },
}));

vi.mock('../src/services/aml.service.js', () => ({
  amlService: {
    registerTransaction: vi.fn(),
    verifyWebhookSignature: vi.fn(),
  },
}));

vi.mock('../src/services/notification.service.js', () => ({
  notificationService: {
    sendAmlAlertEmail: vi.fn().mockResolvedValue(undefined),
    sendKycApprovalEmail: vi.fn().mockResolvedValue(undefined),
    sendKycRejectionEmail: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../src/jobs/queue.js', () => ({
  kycReviewQueue: { add: vi.fn().mockResolvedValue({}) },
  amlScreeningQueue: { add: vi.fn().mockResolvedValue({}) },
  reserveSyncQueue: { add: vi.fn().mockResolvedValue({}) },
  redis: { disconnect: vi.fn() },
}));

vi.mock('../src/services/blocklist.service.js', () => ({
  blocklistService: {
    isBlocked: vi.fn().mockResolvedValue(false),
    blockAddress: vi.fn().mockResolvedValue('0xdeadbeef'),
    unblockAddress: vi.fn().mockResolvedValue('0xcafebabe'),
  },
}));

vi.mock('../src/services/reserve.service.js', () => ({
  reserveService: {
    getTotalSupply: vi.fn().mockResolvedValue({
      totalSupply: 1000000000n,
      blockNumber: 12345n,
      timestamp: 1700000000,
    }),
  },
}));

import { buildApp } from '../src/api/server.js';
import { kycService } from '../src/services/kyc.service.js';
import { amlService } from '../src/services/aml.service.js';
import { kycReviewQueue, amlScreeningQueue } from '../src/jobs/queue.js';
import { db } from '../src/db/index.js';

describe('Webhook routes', () => {
  let app: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.JWT_SECRET = 'test-secret-min-32-chars-for-testing!';
    app = await buildApp();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  // --- Persona webhook ---
  it('POST /v1/webhooks/persona returns 200 for valid payload', async () => {
    vi.mocked(kycService.verifyWebhookSignature).mockReturnValue(true);
    vi.mocked(db.query.kycSubmissions.findFirst).mockResolvedValue(undefined);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/persona',
      headers: { 'content-type': 'application/json', 'persona-signature': 'valid-sig' },
      body: JSON.stringify({ type: 'inquiry.approved', data: {} }),
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ received: true });
  });

  it('POST /v1/webhooks/persona rejects tampered payload (signature mismatch)', async () => {
    vi.mocked(kycService.verifyWebhookSignature).mockReturnValue(false);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/persona',
      headers: { 'content-type': 'application/json', 'persona-signature': 'tampered-sig' },
      body: JSON.stringify({ type: 'inquiry.approved', data: {} }),
    });
    expect(response.statusCode).toBe(401);
  });

  // --- Chainalysis webhook ---
  it('POST /v1/webhooks/chainalysis returns 200 for valid payload', async () => {
    vi.mocked(amlService.verifyWebhookSignature).mockReturnValue(true);
    vi.mocked(db.query.transactions.findFirst).mockResolvedValue(undefined);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/chainalysis',
      headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
      body: JSON.stringify({ transferReference: '0xabc', riskScore: 30 }),
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ received: true });
  });

  it('POST /v1/webhooks/chainalysis rejects tampered payload (signature mismatch)', async () => {
    vi.mocked(amlService.verifyWebhookSignature).mockReturnValue(false);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/chainalysis',
      headers: { 'content-type': 'application/json', 'x-api-key': 'tampered-key' },
      body: JSON.stringify({ transferReference: '0xabc', riskScore: 95 }),
    });
    expect(response.statusCode).toBe(401);
  });

  // --- Full flow: approved KYC via webhook ---
  it('Persona inquiry.approved webhook enqueues kycReviewQueue job', async () => {
    vi.mocked(kycService.verifyWebhookSignature).mockReturnValue(true);
    vi.mocked(db.query.kycSubmissions.findFirst).mockResolvedValue({
      id: 'sub-999',
      userId: 'user-999',
      personaInquiryId: 'inq_flow_test',
      status: 'pending',
    } as any);
    vi.mocked(db.query.users.findFirst).mockResolvedValue({
      id: 'user-999',
      email: 'flow@test.com',
    } as any);

    const payload = {
      data: {
        attributes: { name: 'inquiry.approved' },
        relationships: { inquiry: { data: { id: 'inq_flow_test' } } },
      },
    };

    const response = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/persona',
      headers: { 'content-type': 'application/json', 'persona-signature': 'valid' },
      body: JSON.stringify(payload),
    });

    expect(response.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 80));
    expect(kycReviewQueue.add).toHaveBeenCalledWith(
      'review',
      expect.objectContaining({
        userId: 'user-999',
        kycSubmissionId: 'sub-999',
        personaInquiryId: 'inq_flow_test',
      })
    );
  });

  // --- Critical AML auto-blocks ---
  it('Chainalysis webhook with critical risk enqueues amlScreeningQueue job', async () => {
    vi.mocked(amlService.verifyWebhookSignature).mockReturnValue(true);
    vi.mocked(db.query.transactions.findFirst).mockResolvedValue({
      id: 'tx-crit',
      txHash: '0xcritical',
      fromAddress: '0xbadactor',
      chainId: 8453,
      amount: '5000000',
    } as any);

    const payload = { transferReference: '0xcritical', riskScore: 95, alertType: 'sanctions' };

    const response = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/chainalysis',
      headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
      body: JSON.stringify(payload),
    });

    expect(response.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 80));
    expect(amlScreeningQueue.add).toHaveBeenCalled();
  });
});
