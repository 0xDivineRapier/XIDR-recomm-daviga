import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/db/index.js', () => ({
  db: {
    query: {
      users: { findFirst: vi.fn() },
      transactions: { findFirst: vi.fn() },
      amlAlerts: { findFirst: vi.fn() },
      reserveAttestations: { findFirst: vi.fn() },
    },
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) }),
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({ offset: vi.fn().mockResolvedValue([]) }),
          }),
          limit: vi.fn().mockReturnValue({ offset: vi.fn().mockResolvedValue([]) }),
        }),
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({ offset: vi.fn().mockResolvedValue([]) }),
        }),
        limit: vi.fn().mockReturnValue({ offset: vi.fn().mockResolvedValue([]) }),
      }),
    }),
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

vi.mock('../src/services/kyc.service.js', () => ({
  kycService: {
    createIndividualInquiry: vi.fn(),
    verifyWebhookSignature: vi.fn().mockReturnValue(false),
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
import { amlService } from '../src/services/aml.service.js';
import { amlScreeningQueue } from '../src/jobs/queue.js';
import { db } from '../src/db/index.js';
import { notificationService } from '../src/services/notification.service.js';

async function getAdminToken(app: any) {
  return app.jwt.sign({ id: 'admin-id', email: 'admin@xidr.id', role: 'admin' });
}

async function getUserToken(app: any) {
  return app.jwt.sign({ id: 'user-id', email: 'user@xidr.id', role: 'individual' });
}

describe('Chainalysis webhooks', () => {
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

  it('POST /v1/webhooks/chainalysis rejects invalid secret', async () => {
    vi.mocked(amlService.verifyWebhookSignature).mockReturnValue(false);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/chainalysis',
      headers: { 'content-type': 'application/json', 'x-api-key': 'bad-key' },
      body: JSON.stringify({ txHash: '0xabc' }),
    });
    expect(response.statusCode).toBe(401);
  });

  it('POST /v1/webhooks/chainalysis with high severity creates aml_alert and enqueues job', async () => {
    vi.mocked(amlService.verifyWebhookSignature).mockReturnValue(true);
    vi.mocked(db.query.transactions.findFirst).mockResolvedValue({
      id: 'tx-001',
      txHash: '0xdeadbeef',
      fromAddress: '0xabcdef',
      chainId: 84532,
      amount: '1000',
    } as any);

    const payload = {
      transferReference: '0xdeadbeef',
      riskScore: 85,
      alertType: 'risky_counterparty',
    };

    const response = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/chainalysis',
      headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
      body: JSON.stringify(payload),
    });

    expect(response.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    expect(db.insert).toHaveBeenCalled();
    expect(amlScreeningQueue.add).toHaveBeenCalled();
    expect(notificationService.sendAmlAlertEmail).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'high', riskScore: 85 })
    );
  });
});

describe('AML alert routes', () => {
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

  it('GET /v1/transactions/alerts returns paginated alerts for admin', async () => {
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              offset: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      }),
    } as any);

    const token = await getAdminToken(app);
    const response = await app.inject({
      method: 'GET',
      url: '/v1/transactions/alerts',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('data');
    expect(body).toHaveProperty('pagination');
  });

  it('PATCH /v1/transactions/alerts/:id returns 403 for non-admin', async () => {
    const token = await getUserToken(app);
    const response = await app.inject({
      method: 'PATCH',
      url: '/v1/transactions/alerts/some-alert-id',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ status: 'resolved' }),
    });
    expect(response.statusCode).toBe(403);
  });
});
