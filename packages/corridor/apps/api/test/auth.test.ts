import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/db/index.js', () => ({
  db: {
    query: { senders: { findFirst: vi.fn() } },
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 'new-sender-id', phoneNumber: '+6591234567', kycStatus: 'none' }]) }) }),
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
  },
}));
vi.mock('../src/jobs/queue.js', () => ({
  redis: { get: vi.fn().mockResolvedValue(null), setex: vi.fn().mockResolvedValue('OK'), disconnect: vi.fn() },
  swapQueue: { add: vi.fn() },
  disburseQueue: { add: vi.fn() },
  rateCacheQueue: { add: vi.fn() },
  scheduleRateRefresh: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../src/services/otp.service.js', () => ({
  otpService: {
    sendOTP: vi.fn().mockResolvedValue('VS123'),
    verifyOTP: vi.fn(),
  },
}));
vi.mock('../src/services/fx-rate.service.js', () => ({
  FxRateService: vi.fn().mockImplementation(() => ({
    getCachedRate: vi.fn().mockResolvedValue({ effectiveRate: 11741, spreadApplied: 0.005, source: 'pyth', capturedAt: new Date().toISOString() }),
    refreshRate: vi.fn().mockResolvedValue(null),
    calculateFee: vi.fn().mockReturnValue({ sgdFee: 2.50, sgdNet: 97.50 }),
  })),
}));
vi.mock('../src/services/paynow.service.js', () => ({ paynowService: { generateQR: vi.fn(), verifyWebhookSignature: vi.fn() } }));
vi.mock('../src/services/stripe.service.js', () => ({ stripeService: { createPaymentIntent: vi.fn(), cancelPaymentIntent: vi.fn(), verifyWebhookSignature: vi.fn() } }));
vi.mock('../src/services/sms.service.js', () => ({ smsService: { sendPaymentReceivedSMS: vi.fn(), sendTransferCompletedSMS: vi.fn(), sendTransferFailedSMS: vi.fn() } }));

import { buildApp } from '../src/server.js';
import { db } from '../src/db/index.js';
import { otpService } from '../src/services/otp.service.js';

describe('Auth routes', () => {
  let app: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.JWT_SECRET = 'corridor-test-secret-min-32-chars!!';
    app = await buildApp();
    await app.ready();
  });
  afterEach(async () => { await app.close(); });

  it('POST /v1/auth/otp/send rejects non-Singapore numbers', async () => {
    const response = await app.inject({
      method: 'POST', url: '/v1/auth/otp/send',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone_number: '+62812345678' }),
    });
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.error).toContain('Singapore');
  });

  it('POST /v1/auth/otp/send accepts Singapore number and sends OTP', async () => {
    const response = await app.inject({
      method: 'POST', url: '/v1/auth/otp/send',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone_number: '+6591234567' }),
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.verification_sid).toBe('VS123');
    expect(otpService.sendOTP).toHaveBeenCalledWith('+6591234567');
  });

  it('POST /v1/auth/otp/verify valid OTP issues JWT and creates sender', async () => {
    vi.mocked(otpService.verifyOTP).mockResolvedValue('approved');
    vi.mocked(db.query.senders.findFirst).mockResolvedValue(null);

    const response = await app.inject({
      method: 'POST', url: '/v1/auth/otp/verify',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone_number: '+6591234567', code: '123456' }),
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.access_token).toBeDefined();
    expect(body.is_new_user).toBe(true);
    expect(db.insert).toHaveBeenCalled();
  });

  it('POST /v1/auth/otp/verify invalid OTP returns 401', async () => {
    vi.mocked(otpService.verifyOTP).mockResolvedValue('expired');
    const response = await app.inject({
      method: 'POST', url: '/v1/auth/otp/verify',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone_number: '+6591234567', code: '000000' }),
    });
    expect(response.statusCode).toBe(401);
  });
});
