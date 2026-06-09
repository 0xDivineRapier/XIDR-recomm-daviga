import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockTransfer = { id: 'transfer-id', senderId: 'sender-id', status: 'pending_payment', sgdNet: '97.50', sgdAmount: '100.00', idrAmount: '1145437', xidrAmount: '1145437', paynowReference: 'XIDR-TRANSFER', stripePaymentIntentId: 'pi_test123', recipientId: 'recipient-id' };
const mockSender = { id: 'sender-id', phoneNumber: '+6591234567', kycStatus: 'approved' };

vi.mock('../src/db/index.js', () => ({
  db: {
    query: {
      transfers: { findFirst: vi.fn() },
      senders: { findFirst: vi.fn() },
      recipients: { findFirst: vi.fn() },
    },
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) }),
  },
}));
vi.mock('../src/jobs/queue.js', () => ({
  redis: { get: vi.fn().mockResolvedValue(null), setex: vi.fn().mockResolvedValue('OK'), disconnect: vi.fn() },
  swapQueue: { add: vi.fn().mockResolvedValue({}) },
  disburseQueue: { add: vi.fn().mockResolvedValue({}) },
  rateCacheQueue: { add: vi.fn().mockResolvedValue({}) },
  scheduleRateRefresh: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../src/services/sms.service.js', () => ({
  smsService: { sendPaymentReceivedSMS: vi.fn().mockResolvedValue(undefined), sendTransferCompletedSMS: vi.fn().mockResolvedValue(undefined), sendTransferFailedSMS: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../src/services/stripe.service.js', () => ({
  stripeService: {
    createPaymentIntent: vi.fn(),
    cancelPaymentIntent: vi.fn(),
    verifyWebhookSignature: vi.fn().mockReturnValue({ type: 'payment_intent.succeeded', data: { object: { metadata: { transfer_id: 'transfer-id' }, id: 'pi_test123' } } }),
  },
}));
vi.mock('../src/services/paynow.service.js', () => ({
  paynowService: {
    generateQR: vi.fn(),
    verifyWebhookSignature: vi.fn().mockReturnValue(true),
  },
}));
vi.mock('../src/services/fx-rate.service.js', () => ({
  FxRateService: vi.fn().mockImplementation(() => ({
    getCachedRate: vi.fn().mockResolvedValue({ effectiveRate: 11741, spreadApplied: 0.005, source: 'pyth', capturedAt: new Date().toISOString() }),
    refreshRate: vi.fn().mockResolvedValue(null),
    calculateFee: vi.fn().mockReturnValue({ sgdFee: 2.50, sgdNet: 97.50 }),
  })),
}));
vi.mock('../src/services/otp.service.js', () => ({ otpService: { sendOTP: vi.fn(), verifyOTP: vi.fn() } }));

import { buildApp } from '../src/server.js';
import { db } from '../src/db/index.js';
import { swapQueue } from '../src/jobs/queue.js';
import { paynowService } from '../src/services/paynow.service.js';
import { stripeService } from '../src/services/stripe.service.js';

describe('Webhook routes', () => {
  let app: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.JWT_SECRET = 'corridor-test-secret-min-32-chars!!';
    app = await buildApp();
    await app.ready();
  });
  afterEach(async () => { await app.close(); });

  it('POST /webhooks/paynow returns 401 for invalid signature', async () => {
    vi.mocked(paynowService.verifyWebhookSignature).mockReturnValue(false);
    process.env.LIQUID_GROUP_WEBHOOK_SECRET = 'real-secret';
    const response = await app.inject({
      method: 'POST', url: '/webhooks/paynow',
      headers: { 'content-type': 'application/json', 'x-callback-token': 'bad-token' },
      body: JSON.stringify({ reference: 'XIDR-TRANSFER', amount: '97.50', status: 'COMPLETED' }),
    });
    expect(response.statusCode).toBe(401);
    delete process.env.LIQUID_GROUP_WEBHOOK_SECRET;
  });

  it('POST /webhooks/paynow valid payment enqueues swap job and updates status', async () => {
    vi.mocked(paynowService.verifyWebhookSignature).mockReturnValue(true);
    vi.mocked(db.query.transfers.findFirst).mockResolvedValue(mockTransfer as any);
    vi.mocked(db.query.senders.findFirst).mockResolvedValue(mockSender as any);

    const response = await app.inject({
      method: 'POST', url: '/webhooks/paynow',
      headers: { 'content-type': 'application/json', 'x-callback-token': 'valid-token' },
      body: JSON.stringify({ reference: 'XIDR-TRANSFER', amount: '97.50', status: 'COMPLETED' }),
    });
    expect(response.statusCode).toBe(200);
    await new Promise(r => setTimeout(r, 50));
    expect(swapQueue.add).toHaveBeenCalledWith('swap', expect.objectContaining({ transfer_id: 'transfer-id' }), expect.any(Object));
  });

  it('POST /webhooks/stripe payment_intent.succeeded enqueues swap job', async () => {
    vi.mocked(db.query.transfers.findFirst).mockResolvedValue(mockTransfer as any);
    vi.mocked(db.query.senders.findFirst).mockResolvedValue(mockSender as any);
    vi.mocked(stripeService.verifyWebhookSignature).mockReturnValue({
      type: 'payment_intent.succeeded',
      data: { object: { metadata: { transfer_id: 'transfer-id' }, id: 'pi_test123' } },
    } as any);

    const response = await app.inject({
      method: 'POST', url: '/webhooks/stripe',
      headers: { 'content-type': 'application/json', 'stripe-signature': 'valid-sig' },
      body: JSON.stringify({ type: 'payment_intent.succeeded' }),
    });
    expect(response.statusCode).toBe(200);
    await new Promise(r => setTimeout(r, 50));
    expect(swapQueue.add).toHaveBeenCalled();
  });

  it('POST /webhooks/stripe payment_intent.payment_failed updates status to failed', async () => {
    vi.mocked(db.query.transfers.findFirst).mockResolvedValue(mockTransfer as any);
    vi.mocked(stripeService.verifyWebhookSignature).mockReturnValue({
      type: 'payment_intent.payment_failed',
      data: { object: { metadata: { transfer_id: 'transfer-id' } } },
    } as any);

    const response = await app.inject({
      method: 'POST', url: '/webhooks/stripe',
      headers: { 'content-type': 'application/json', 'stripe-signature': 'valid-sig' },
      body: JSON.stringify({ type: 'payment_intent.payment_failed' }),
    });
    expect(response.statusCode).toBe(200);
    await new Promise(r => setTimeout(r, 50));
    expect(db.update).toHaveBeenCalled();
  });

  it('POST /webhooks/corridor-redeem redeem.completed updates transfer to completed', async () => {
    vi.mocked(db.query.transfers.findFirst).mockResolvedValue({ ...mockTransfer, status: 'disbursing' } as any);
    vi.mocked(db.query.senders.findFirst).mockResolvedValue(mockSender as any);

    const response = await app.inject({
      method: 'POST', url: '/webhooks/corridor-redeem',
      headers: {
        'content-type': 'application/json',
        'x-xidr-event': 'redeem.completed',
        'x-xidr-signature': 'sha256=placeholder',
      },
      body: JSON.stringify({ idempotency_key: 'transfer-id', status: 'completed' }),
    });
    expect(response.statusCode).toBe(200);
    await new Promise(r => setTimeout(r, 50));
    expect(db.update).toHaveBeenCalled();
  });
});
