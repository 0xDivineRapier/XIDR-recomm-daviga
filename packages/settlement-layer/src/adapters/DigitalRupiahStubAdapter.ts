/**
 * DigitalRupiahStubAdapter
 *
 * Stub implementation of RailAdapter for Bank Indonesia's Digital Rupiah (e-Rupiah).
 *
 * STATUS: STUB — pending BI Project Garuda public API specification.
 *
 * BI has not yet published a production-ready API spec for the Digital Rupiah
 * settlement rail as of 2026. This adapter exists to:
 *   1. Validate that the RailAdapter interface is rail-agnostic.
 *   2. Serve as the secondary rail in all automated tests.
 *   3. Provide a clear integration surface when the BI spec ships.
 *
 * When the official API spec is available, replace the stub bodies below
 * with real HTTP calls to the BI settlement gateway. The rest of the
 * IDRXPay codebase requires ZERO changes.
 */

import { v4 as uuidv4 } from "uuid";
import type {
  RailAdapter,
  SettlementParams,
  SettlementResult,
  SettlementStatusResult,
  CancelResult,
} from "./types.js";

// In-memory store so getStatus() is consistent within a process lifecycle
const store = new Map<string, { rail_id: string; status: SettlementStatusResult["status"]; updated_at: string }>();

export class DigitalRupiahStubAdapter implements RailAdapter {
  readonly railName = "digital_rupiah";

  async initiate(params: SettlementParams): Promise<SettlementResult> {
    const settlement_id = uuidv4();
    const rail_id = `bi_dr_stub_${uuidv4().replace(/-/g, "").slice(0, 16)}`;
    const initiated_at = new Date().toISOString();

    store.set(settlement_id, { rail_id, status: "pending", updated_at: initiated_at });

    console.info(
      `[DigitalRupiahStubAdapter] STUB initiate settlement_id=${settlement_id} ` +
      `ref=${params.reference_id} amount=${params.amount_idr}`,
    );

    return { rail_id, settlement_id, status: "pending", initiated_at };
  }

  async getStatus(id: string): Promise<SettlementStatusResult> {
    const entry = store.get(id);
    if (!entry) throw new Error(`Settlement ${id} not found in DigitalRupiah stub store`);
    return {
      settlement_id: id,
      status: entry.status,
      rail_id: entry.rail_id,
      updated_at: entry.updated_at,
    };
  }

  async cancel(id: string): Promise<CancelResult> {
    const entry = store.get(id);
    if (!entry || !["pending", "processing"].includes(entry.status)) {
      return { settlement_id: id, cancelled: false, reason: "Not found or already terminal" };
    }
    entry.status = "cancelled";
    entry.updated_at = new Date().toISOString();
    return { settlement_id: id, cancelled: true };
  }
}
