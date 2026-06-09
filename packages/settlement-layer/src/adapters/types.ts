// ─── Domain types ─────────────────────────────────────────────────────────────

export type SettlementStatus =
  | "pending"
  | "processing"
  | "confirmed"
  | "failed"
  | "cancelled";

export interface SettlementCondition {
  type: "time_lock" | "escrow" | "multi_sig";
  value: string;
}

export interface SettlementParams {
  /** Amount in IDR (integer, no decimals). */
  amount_idr: number;
  /** Recipient wallet address or account identifier. */
  recipient: string;
  /** Client-supplied idempotency / reference key. */
  reference_id: string;
  /** Optional smart-contract conditions (escrow, time-lock, etc.). */
  conditions?: SettlementCondition[];
}

export interface SettlementResult {
  /** Rail-native transaction / instruction identifier. */
  rail_id: string;
  /** Internal IDRXPay settlement UUID. */
  settlement_id: string;
  status: SettlementStatus;
  initiated_at: string; // ISO 8601
}

export interface SettlementStatusResult {
  settlement_id: string;
  status: SettlementStatus;
  /** Rail-native identifier (tx hash, BI instruction ref, etc.). */
  rail_id: string;
  updated_at: string; // ISO 8601
}

export interface CancelResult {
  settlement_id: string;
  cancelled: boolean;
  reason?: string;
}

// ─── RailAdapter interface ────────────────────────────────────────────────────

/**
 * RailAdapter — settlement rail abstraction.
 *
 * Every rail (IDRX on Base, BI Digital Rupiah, future rails) must implement
 * this interface so the client-facing API layer never needs to know which
 * underlying rail is active. Swap rails by changing the SETTLEMENT_RAIL env var.
 */
export interface RailAdapter {
  /** Human-readable rail name. Used in logs and the compatibility matrix. */
  readonly railName: string;

  /**
   * Initiate a new settlement on this rail.
   * Must be idempotent with respect to `params.reference_id`.
   */
  initiate(params: SettlementParams): Promise<SettlementResult>;

  /** Fetch current settlement status from the rail or local store. */
  getStatus(id: string): Promise<SettlementStatusResult>;

  /**
   * Request cancellation of a pending/processing settlement.
   * Returns { cancelled: false } if the rail does not support cancel or the
   * settlement is already terminal.
   */
  cancel(id: string): Promise<CancelResult>;
}

// ─── Rail feature flags (compatibility matrix) ────────────────────────────────

export type FeatureSupport = "supported" | "unsupported" | "pending_spec";

export interface RailFeatures {
  escrow: FeatureSupport;
  split_settlement: FeatureSupport;
  time_lock: FeatureSupport;
  cancel: FeatureSupport;
}

export interface RailCompatibilityEntry {
  rail: string;
  description: string;
  features: RailFeatures;
}
