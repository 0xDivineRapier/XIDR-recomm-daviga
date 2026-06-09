import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Mocks ---
vi.mock('../src/db/index.js', () => ({
  db: {
    query: {
      users: {
        findFirst: vi.fn(),
      },
      kycSubmissions: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
    },
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) }),
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          offset: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([]),
          }),
        }),
        orderBy: vi.fn().mockResolvedValue([]),
      }),
    }),
  },
}));

vi.mock('../src/services/kyc.service.js', () => ({
  kycService: {
    createIndividualInquiry: vi.fn(),
    createBusinessInquiry: vi.fn(),
    verifyWebhookSignature: vi.fn(),
    getInquiry: vi.fn(),
  },
}));

vi.mock('../src/services/notification.service.js', () => ({
  notificationService: {
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
    getBalanceOf: vi.fn().mockResolvedValue(0n),
  },
}));

// Import after mocks
import { buildApp } from '../src/api/server.js';
import { kycService } from '../src/services/kyc.service.js';
import { kycReviewQueue } from '../src/jobs/queue.js';
import { db } from '../src/db/index.js';

// Helper to generate a valid JWT for tests
async function getTestToken(app: any, role = 'individual') {
  return app.jwt.sign({ id: 'test-user-id', email: 'test@example.com', role });
}

describe('KYC routes', () => {
  let app: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Set JWT_SECRET before building app
    process.env.JWT_SECRET = 'test-secret-min-32-chars-for-testing!';
    app = await buildApp();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('POST /v1/kyc/individual/start returns 401 without JWT', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/kyc/individual/start',
    });
    expect(response.statusCode).toBe(401);
  });

  it('POST /v1/kyc/individual/start returns inquiry_id with valid JWT', async () => {
    const mockUser = { id: 'test-user-id', email: 'test@example.com', kycStatus: 'pending', role: 'individual' };
    vi.mocked(db.query.users.findFirst).mockResolvedValueOnce(mockUser as any);
    vi.mocked(kycService.createIndividualInquiry).mockResolvedValueOnce({
      inquiryId: 'inq_abc123',
      hostedFlowUrl: 'https://withpersona.com/verify?inquiry-id=inq_abc123',
    });

    const token = await getTestToken(app);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/kyc/individual/start',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.inquiry_id).toBe('inq_abc123');
    expect(body.hosted_flow_url).toContain('withpersona.com');
  });

  it('POST /v1/kyc/individual/start returns 400 if KYC already approved', async () => {
    const mockUser = { id: 'test-user-id', email: 'test@example.com', kycStatus: 'approved', role: 'individual' };
    vi.mocked(db.query.users.findFirst).mockResolvedValueOnce(mockUser as any);

    const token = await getTestToken(app);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/kyc/individual/start',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('Persona webhook', () => {
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

  it('POST /v1/webhooks/persona rejects invalid signature', async () => {
    vi.mocked(kycService.verifyWebhookSignature).mockReturnValue(false);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/persona',
      headers: {
        'content-type': 'application/json',
        'persona-signature': 'bad-sig',
      },
      body: JSON.stringify({ type: 'inquiry.approved' }),
    });
    expect(response.statusCode).toBe(401);
  });

  it('POST /v1/webhooks/persona with valid inquiry.approved event updates DB and enqueues job', async () => {
    vi.mocked(kycService.verifyWebhookSignature).mockReturnValue(true);
    const mockSubmission = {
      id: 'sub-001',
      userId: 'user-001',
      personaInquiryId: 'inq_test123',
      status: 'pending',
    };
    vi.mocked(db.query.kycSubmissions.findFirst).mockResolvedValue(mockSubmission as any);
    vi.mocked(db.query.users.findFirst).mockResolvedValue({
      id: 'user-001',
      email: 'test@example.com',
    } as any);

    const payload = {
      type: 'inquiry.approved',
      data: {
        relationships: { inquiry: { data: { id: 'inq_test123' } } },
        attributes: { name: 'inquiry.approved' },
      },
    };

    const response = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/persona',
      headers: {
        'content-type': 'application/json',
        'persona-signature': 'valid-sig',
      },
      body: JSON.stringify(payload),
    });

    expect(response.statusCode).toBe(200);
    // Wait for async processing
    await new Promise((r) => setTimeout(r, 50));
    expect(kycReviewQueue.add).toHaveBeenCalledWith(
      'review',
      expect.objectContaining({ personaInquiryId: 'inq_test123' })
    );
  });
});
