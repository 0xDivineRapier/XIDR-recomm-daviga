import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/db/index.js', () => ({
  db: {
    query: {
      users: { findFirst: vi.fn() },
      reserveAttestations: { findFirst: vi.fn() },
    },
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([
          {
            id: 'attest-001',
            xidrTotalSupply: '1000000000',
            idrReserveAmount: '1000000000',
            reserveRatio: '1.000000',
            reserveBankName: 'Bank Central Asia',
            attestationHash: 'abcdef1234567890',
            attestedAt: new Date('2024-01-01'),
            attestedBy: 'admin-id',
          },
        ]),
      }),
    }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            offset: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    }),
  },
}));

vi.mock('../src/services/reserve.service.js', () => ({
  reserveService: {
    getTotalSupply: vi.fn().mockResolvedValue({
      totalSupply: 1000000000n,
      blockNumber: 12345n,
      timestamp: 1700000000,
    }),
    getBalanceOf: vi.fn().mockResolvedValue(0n),
  },
}));

vi.mock('../src/services/kyc.service.js', () => ({
  kycService: {
    createIndividualInquiry: vi.fn(),
    verifyWebhookSignature: vi.fn().mockReturnValue(false),
  },
}));

vi.mock('../src/services/aml.service.js', () => ({
  amlService: {
    registerTransaction: vi.fn(),
    verifyWebhookSignature: vi.fn().mockReturnValue(false),
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

import { buildApp } from '../src/api/server.js';
import { reserveService } from '../src/services/reserve.service.js';
import { db } from '../src/db/index.js';

async function getAdminToken(app: any) {
  return app.jwt.sign({ id: 'admin-id', email: 'admin@xidr.id', role: 'admin' });
}

async function getUserToken(app: any) {
  return app.jwt.sign({ id: 'user-id', email: 'user@xidr.id', role: 'individual' });
}

describe('Reserve routes', () => {
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

  it('GET /v1/reserves/latest returns latest attestation', async () => {
    vi.mocked(db.query.reserveAttestations.findFirst).mockResolvedValue({
      id: 'attest-001',
      xidrTotalSupply: '1000000000',
      idrReserveAmount: '1000000000',
      reserveRatio: '1.000000',
      reserveBankName: 'Bank Central Asia',
      attestationHash: 'abcdef1234567890',
      attestedAt: new Date('2024-01-01'),
    } as any);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/reserves/latest',
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.id).toBe('attest-001');
    expect(body.reserveRatio).toBe('1.000000');
  });

  it('GET /v1/reserves/latest returns 404 when no attestation exists', async () => {
    vi.mocked(db.query.reserveAttestations.findFirst).mockResolvedValue(undefined);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/reserves/latest',
    });
    expect(response.statusCode).toBe(404);
  });

  it('POST /v1/reserves/attest returns 403 for non-admin', async () => {
    const token = await getUserToken(app);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/reserves/attest',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        idr_reserve_amount: '1000000000',
        reserve_bank_name: 'Bank Central Asia',
      }),
    });
    expect(response.statusCode).toBe(403);
  });

  it('POST /v1/reserves/attest reads totalSupply (mock viem), saves with correct hash', async () => {
    const token = await getAdminToken(app);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/reserves/attest',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        idr_reserve_amount: '1000000000',
        reserve_bank_name: 'Bank Central Asia',
        notes: 'Monthly attestation',
      }),
    });

    expect(response.statusCode).toBe(201);
    expect(reserveService.getTotalSupply).toHaveBeenCalled();

    const body = JSON.parse(response.body);
    expect(body.xidrTotalSupply).toBe('1000000000');
    expect(body.attestationHash).toBeDefined();
    expect(body.attestationHash).toHaveLength(64); // sha256 hex
  });
});
