import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/db/index.js', () => ({
  db: {
    query: {
      senders: { findFirst: vi.fn() },
      recipients: { findFirst: vi.fn() },
      transfers: { findFirst: vi.fn() },
    },
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 'transfer-id', senderId: 'sender-id', status: 'pending_payment', sgdAmount: '100.00', sgdNet: '97.50', idrAmount: '1145437', xidrAmount: '1145437', stripePaymentIntentId: null, paynowReference: 'XIDR-TRANSFER', expiresAt: new Date(Date.now() + 3600000) }]),
      }),
    }),
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
    select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ offset: vi.fn().mockResolvedValue([]) }) }) }) }) }),
  },
}));
vi.mock('../src/jobs/queue.js', () => ({
  redis: { get: vi.fn().mockResolvedValue(null), setex: vi.fn().mockResolvedValue('OK'), disconnect: vi.fn() },
  swapQueue: { add: vi.fn().mockResolvedValue({}) },
  disburseQueue: { add: vi.fn().mockResolvedValue({}) },
  rateCacheQueue: { add: vi.fn().mockResolvedValue({}) },
  scheduleRateRefresh: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../src/services/fx-rate.service.js', () => ({
  FxRateService: vi.fn().mockImplementation(() => ({
    getCachedRate: vi.fn().mockResolvedValue({ sgdIdr: 11800, effectiveRate: 11741, spreadApplied: 0.005, source: 'pyth', capturedAt: new Date().toISOString() }),
    refreshRate: vi.fn().mockResolvedValue(null),
    calculateFee: vi.fn().mockReturnValue({ sgdFee: 2.50, sgdNet: 97.50 }),
  })),
}));
vi.mock('../src/services/paynow.service.js', () => ({
  paynowService: {
    generateQR: vi.fn().mockReturnValue({ qrString: '000201...6304ABCD', reference: 'XIDR-TRANSFER' }),
    verifyWebhookSignature: vi.fn().mockReturnValue(true),
  },
}));
vi.mock('../src/services/stripe.service.js', () => ({
  stripeService: {
    createPaymentIntent: vi.fn().mockResolvedValue({ clientSecret: 'pi_test_secret', paymentIntentId: 'pi_test123' }),
    cancelPaymentIntent: vi.fn().mockResolvedValue(undefined),
    verifyWebhookSignature: vi.fn(),
  },
}));
vi.mock('../src/services/sms.service.js', () => ({
  smsService: { sendPaymentReceivedSMS: vi.fn(), sendTransferCompletedSMS: vi.fn(), sendTransferFailedSMS: vi.fn() },
}));
vi.mock('../src/services/otp.service.js', () => ({
  otpService: { sendOTP: vi.fn(), verifyOTP: vi.fn() },
}));

import { buildApp } from '../src/server.js';
import { db } from '../src/db/index.js';

const mockSender = { id: 'sender-id', phoneNumber: '+6591234567', kycStatus: 'approved', email: null, fullName: 'Test User' };
const mockRecipient = { id: 'recipient-id', senderId: 'sender-id', fullName: 'Recipient', bankCode: '014', accountNumber: '1234567890', payoutType: 'bank_transfer', isVerified: true, nickname: 'Ibu' };
const mockTransfer = { id: 'transfer-id', senderId: 'sender-id', status: 'pending_payment', sgdAmount: '100.00', sgdNet: '97.50', idrAmount: '1145437', xidrAmount: '1145437', stripePaymentIntentId: null, paynowReference: 'XIDR-TRANSFER', expiresAt: new Date(Date.now() + 3600000) };

describe('Transfer routes', () => {
  let app: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.JWT_SECRET = 'corridor-test-secret-min-32-chars!!';
    app = await buildApp();
    await app.ready();
  });
  afterEach(async () => { await app.close(); });

  const getToken = (app: any) => app.jwt.sign({ id: 'sender-id', phone: '+6591234567' });

  it('POST /v1/transfers returns 403 if KYC not approved', async () => {
    vi.mocked(db.query.senders.findFirst).mockResolvedValueOnce({ ...mockSender, kycStatus: 'pending' } as any);
    const token = getToken(app);
    const response = await app.inject({
      method: 'POST', url: '/v1/transfers',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ recipient_id: 'recipient-id', sgd_amount: 100, payment_method: 'paynow' }),
    });
    expect(response.statusCode).toBe(403);
  });

  it('POST /v1/transfers returns 400 if sgd_amount below minimum', async () => {
    vi.mocked(db.query.senders.findFirst).mockResolvedValueOnce(mockSender as any);
    const token = getToken(app);
    const response = await app.inject({
      method: 'POST', url: '/v1/transfers',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ recipient_id: 'recipient-id', sgd_amount: 5, payment_method: 'paynow' }),
    });
    expect(response.statusCode).toBe(400);
  });

  it('POST /v1/transfers creates PayNow transfer with QR code', async () => {
    vi.mocked(db.query.senders.findFirst).mockResolvedValueOnce(mockSender as any);
    vi.mocked(db.query.recipients.findFirst).mockResolvedValueOnce(mockRecipient as any);

    const token = getToken(app);
    const response = await app.inject({
      method: 'POST', url: '/v1/transfers',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ recipient_id: 'recipient-id', sgd_amount: 100, payment_method: 'paynow' }),
    });
    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.status).toBe('pending_payment');
    expect(body.payment_method).toBe('paynow');
    expect(body.paynow_qr_string).toBeDefined();
    expect(body.sgd_fee).toBe(2.50);
  });

  it('POST /v1/transfers creates Stripe card transfer', async () => {
    vi.mocked(db.query.senders.findFirst).mockResolvedValueOnce(mockSender as any);
    vi.mocked(db.query.recipients.findFirst).mockResolvedValueOnce(mockRecipient as any);

    const token = getToken(app);
    const response = await app.inject({
      method: 'POST', url: '/v1/transfers',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ recipient_id: 'recipient-id', sgd_amount: 100, payment_method: 'card', stripe_payment_method_id: 'pm_test' }),
    });
    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.stripe_client_secret).toBe('pi_test_secret');
  });

  it('GET /v1/transfers/:id returns transfer detail', async () => {
    vi.mocked(db.query.transfers.findFirst).mockResolvedValueOnce(mockTransfer as any);
    const token = getToken(app);
    const response = await app.inject({
      method: 'GET', url: '/v1/transfers/transfer-id',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.id).toBe('transfer-id');
  });

  it('POST /v1/transfers/:id/cancel cancels pending_payment transfer', async () => {
    vi.mocked(db.query.transfers.findFirst).mockResolvedValueOnce(mockTransfer as any);
    const token = getToken(app);
    const response = await app.inject({
      method: 'POST', url: '/v1/transfers/transfer-id/cancel',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe('expired');
  });

  it('POST /v1/transfers/:id/cancel returns 400 if already processing', async () => {
    vi.mocked(db.query.transfers.findFirst).mockResolvedValueOnce({ ...mockTransfer, status: 'swapping' } as any);
    const token = getToken(app);
    const response = await app.inject({
      method: 'POST', url: '/v1/transfers/transfer-id/cancel',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(response.statusCode).toBe(400);
  });
});
