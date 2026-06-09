import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  integer,
  bigint,
  numeric,
  jsonb,
} from 'drizzle-orm/pg-core';

// Enums
export const roleEnum = pgEnum('role', ['individual', 'business', 'admin']);
export const kycStatusEnum = pgEnum('kyc_status', ['pending', 'submitted', 'approved', 'rejected', 'flagged']);
export const kycTypeEnum = pgEnum('kyc_type', ['individual', 'business']);
export const kycSubmissionStatusEnum = pgEnum('kyc_submission_status', ['pending', 'approved', 'rejected', 'needs_review']);
export const amlStatusEnum = pgEnum('aml_status', ['pending', 'cleared', 'flagged', 'blocked']);
export const alertSeverityEnum = pgEnum('alert_severity', ['low', 'medium', 'high', 'critical']);
export const alertStatusEnum = pgEnum('alert_status', ['open', 'under_review', 'resolved', 'escalated']);
export const blocklistActionEnum = pgEnum('blocklist_action', ['block', 'unblock']);

// Tables
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: roleEnum('role').notNull().default('individual'),
  kycStatus: kycStatusEnum('kyc_status').notNull().default('pending'),
  walletAddress: text('wallet_address'),
  personaInquiryId: text('persona_inquiry_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const kycSubmissions = pgTable('kyc_submissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  type: kycTypeEnum('type').notNull(),
  personaInquiryId: text('persona_inquiry_id').notNull(),
  status: kycSubmissionStatusEnum('status').notNull().default('pending'),
  rejectionReason: text('rejection_reason'),
  submittedAt: timestamp('submitted_at'),
  reviewedAt: timestamp('reviewed_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  rawPersonaResponse: jsonb('raw_persona_response'),
});

export const transactions = pgTable('transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  txHash: text('tx_hash').notNull().unique(),
  fromAddress: text('from_address').notNull(),
  toAddress: text('to_address').notNull(),
  amount: numeric('amount').notNull(),
  blockNumber: bigint('block_number', { mode: 'bigint' }).notNull(),
  chainId: integer('chain_id').notNull(),
  amlStatus: amlStatusEnum('aml_status').notNull().default('pending'),
  chainalysisAlertId: text('chainalysis_alert_id'),
  riskScore: integer('risk_score'),
  screenedAt: timestamp('screened_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const amlAlerts = pgTable('aml_alerts', {
  id: uuid('id').primaryKey().defaultRandom(),
  transactionId: uuid('transaction_id').notNull().references(() => transactions.id),
  alertType: text('alert_type').notNull(),
  severity: alertSeverityEnum('severity').notNull(),
  chainalysisData: jsonb('chainalysis_data'),
  status: alertStatusEnum('status').notNull().default('open'),
  assignedTo: uuid('assigned_to').references(() => users.id),
  resolvedAt: timestamp('resolved_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const reserveAttestations = pgTable('reserve_attestations', {
  id: uuid('id').primaryKey().defaultRandom(),
  attestedAt: timestamp('attested_at').notNull().defaultNow(),
  xidrTotalSupply: numeric('xidr_total_supply').notNull(),
  idrReserveAmount: numeric('idr_reserve_amount').notNull(),
  reserveRatio: numeric('reserve_ratio').notNull(),
  reserveBankName: text('reserve_bank_name').notNull(),
  attestationHash: text('attestation_hash').notNull(),
  attestedBy: uuid('attested_by').notNull().references(() => users.id),
  notes: text('notes'),
});

export const blocklistSyncLog = pgTable('blocklist_sync_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  walletAddress: text('wallet_address').notNull(),
  action: blocklistActionEnum('action').notNull(),
  reason: text('reason').notNull(),
  txHash: text('tx_hash'),
  // nullable to allow system-initiated actions (e.g. auto-block by AML worker)
  initiatedBy: uuid('initiated_by').references(() => users.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// Export DB type helper
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type KycSubmission = typeof kycSubmissions.$inferSelect;
export type NewKycSubmission = typeof kycSubmissions.$inferInsert;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type AmlAlert = typeof amlAlerts.$inferSelect;
export type NewAmlAlert = typeof amlAlerts.$inferInsert;
export type ReserveAttestation = typeof reserveAttestations.$inferSelect;
export type NewReserveAttestation = typeof reserveAttestations.$inferInsert;
export type BlocklistSyncLog = typeof blocklistSyncLog.$inferSelect;
export type NewBlocklistSyncLog = typeof blocklistSyncLog.$inferInsert;
