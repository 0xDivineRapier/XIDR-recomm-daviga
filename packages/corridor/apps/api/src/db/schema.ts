import {
  pgTable, pgEnum, uuid, text, timestamp, numeric, boolean, integer, bigint, date, unique,
} from 'drizzle-orm/pg-core';

export const kycStatusEnum = pgEnum('sender_kyc_status', ['none', 'pending', 'approved', 'rejected']);
export const paymentMethodEnum = pgEnum('payment_method', ['paynow', 'card']);
export const payoutTypeEnum = pgEnum('payout_type', ['bank_transfer', 'gopay', 'ovo', 'dana']);
export const transferStatusEnum = pgEnum('transfer_status', [
  'pending_kyc', 'pending_payment', 'payment_received', 'swapping',
  'swap_complete', 'disbursing', 'completed', 'expired', 'failed', 'refunded',
]);
export const otpStatusEnum = pgEnum('otp_status', ['pending', 'approved', 'expired']);
export const rateSourceEnum = pgEnum('rate_source', ['pyth', 'fallback']);

export const senders = pgTable('senders', {
  id: uuid('id').primaryKey().defaultRandom(),
  phoneNumber: text('phone_number').notNull().unique(),
  fullName: text('full_name'),
  email: text('email'),
  nricFin: text('nric_fin'),
  kycStatus: kycStatusEnum('kyc_status').notNull().default('none'),
  personaInquiryId: text('persona_inquiry_id'),
  defaultPaymentMethod: paymentMethodEnum('default_payment_method'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const recipients = pgTable('recipients', {
  id: uuid('id').primaryKey().defaultRandom(),
  senderId: uuid('sender_id').notNull().references(() => senders.id),
  nickname: text('nickname').notNull(),
  fullName: text('full_name').notNull(),
  payoutType: payoutTypeEnum('payout_type').notNull(),
  bankCode: text('bank_code'),
  accountNumber: text('account_number').notNull(),
  isVerified: boolean('is_verified').notNull().default(false),
  deletedAt: timestamp('deleted_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const transfers = pgTable('transfers', {
  id: uuid('id').primaryKey().defaultRandom(),
  senderId: uuid('sender_id').notNull().references(() => senders.id),
  recipientId: uuid('recipient_id').notNull().references(() => recipients.id),
  status: transferStatusEnum('status').notNull().default('pending_payment'),
  sgdAmount: numeric('sgd_amount').notNull(),
  sgdFee: numeric('sgd_fee').notNull(),
  sgdNet: numeric('sgd_net').notNull(),
  fxRate: numeric('fx_rate').notNull(),
  fxRateLockedAt: timestamp('fx_rate_locked_at').notNull(),
  fxRateExpiresAt: timestamp('fx_rate_expires_at').notNull(),
  idrAmount: numeric('idr_amount').notNull(),
  xidrAmount: numeric('xidr_amount').notNull(),
  paymentMethod: paymentMethodEnum('payment_method').notNull(),
  paynowReference: text('paynow_reference'),
  paynowQrString: text('paynow_qr_string'),
  stripePaymentIntentId: text('stripe_payment_intent_id'),
  xsgdAmount: numeric('xsgd_amount'),
  swapTxHash: text('swap_tx_hash'),
  redeemRequestId: text('redeem_request_id'),
  flipTransactionId: text('flip_transaction_id'),
  paymentReceivedAt: timestamp('payment_received_at'),
  swapCompletedAt: timestamp('swap_completed_at'),
  disbursedAt: timestamp('disbursed_at'),
  completedAt: timestamp('completed_at'),
  expiresAt: timestamp('expires_at').notNull(),
  failureReason: text('failure_reason'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const rateSnapshots = pgTable('rate_snapshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  sgdUsd: numeric('sgd_usd').notNull(),
  usdIdr: numeric('usd_idr').notNull(),
  sgdIdr: numeric('sgd_idr').notNull(),
  spreadApplied: numeric('spread_applied').notNull(),
  effectiveRate: numeric('effective_rate').notNull(),
  source: rateSourceEnum('source').notNull(),
  capturedAt: timestamp('captured_at').notNull().defaultNow(),
});

export const otpSessions = pgTable('otp_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  phoneNumber: text('phone_number').notNull(),
  twilioVerificationSid: text('twilio_verification_sid').notNull(),
  status: otpStatusEnum('status').notNull().default('pending'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  expiresAt: timestamp('expires_at').notNull(),
});

// Type exports
export type Sender = typeof senders.$inferSelect;
export type NewSender = typeof senders.$inferInsert;
export type Recipient = typeof recipients.$inferSelect;
export type NewRecipient = typeof recipients.$inferInsert;
export type Transfer = typeof transfers.$inferSelect;
export type NewTransfer = typeof transfers.$inferInsert;
export type RateSnapshot = typeof rateSnapshots.$inferSelect;
