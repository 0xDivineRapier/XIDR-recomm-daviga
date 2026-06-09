import { v4 as uuidv4 } from "uuid";
import { createPublicClient, http, parseAbi } from "viem";
import { base } from "viem/chains";
import type {
  RailAdapter,
  SettlementParams,
  SettlementResult,
  SettlementStatusResult,
  CancelResult,
} from "./types.js";
import { getDb } from "../lib/db.js";
import { env } from "../lib/env.js";

// Minimal ERC-20 ABI — used for future on-chain reads (balance checks, etc.)
const ERC20_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
]);

export class IdrxRailAdapter implements RailAdapter {
  readonly railName = "idrx";

  private buildClient() {
    return createPublicClient({
      chain: base,
      transport: http(env.ALCHEMY_RPC_URL || undefined),
    });
  }

  /**
   * Initiate a settlement via IDRX on Base L2.
   *
   * Current iteration: logs intent and returns a mock rail_id.
   * Real on-chain tx submission (viem `writeContract`) is wired in the next
   * iteration once the IDRX transfer contract ABI is finalised.
   */
  async initiate(params: SettlementParams): Promise<SettlementResult> {
    const settlement_id = uuidv4();
    // Placeholder: in production this becomes a viem writeContract call to the
    // IDRX transfer contract, returning the tx hash as rail_id.
    const rail_id = `idrx_mock_${uuidv4().replace(/-/g, "").slice(0, 16)}`;
    const initiated_at = new Date().toISOString();

    console.info(
      `[IdrxRailAdapter] initiate settlement_id=${settlement_id} ` +
      `ref=${params.reference_id} amount=${params.amount_idr} recipient=${params.recipient}`,
    );

    // Persist to PostgreSQL
    await getDb().query(
      `INSERT INTO settlements
         (id, rail_id, reference_id, amount_idr, recipient, status, rail_name, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,'pending',$6,NOW(),NOW())`,
      [settlement_id, rail_id, params.reference_id, params.amount_idr, params.recipient, this.railName],
    );

    return { rail_id, settlement_id, status: "pending", initiated_at };
  }

  async getStatus(id: string): Promise<SettlementStatusResult> {
    const { rows } = await getDb().query<{
      id: string; rail_id: string; status: string; updated_at: Date;
    }>(
      `SELECT id, rail_id, status, updated_at FROM settlements WHERE id = $1`,
      [id],
    );
    if (!rows.length) throw new Error(`Settlement ${id} not found`);
    const row = rows[0];
    return {
      settlement_id: row.id,
      status: row.status as SettlementStatusResult["status"],
      rail_id: row.rail_id,
      updated_at: row.updated_at.toISOString(),
    };
  }

  async cancel(id: string): Promise<CancelResult> {
    const { rowCount } = await getDb().query(
      `UPDATE settlements
       SET status='cancelled', updated_at=NOW()
       WHERE id=$1 AND status IN ('pending','processing')`,
      [id],
    );
    return {
      settlement_id: id,
      cancelled: (rowCount ?? 0) > 0,
      reason: (rowCount ?? 0) === 0 ? "Settlement not found or already in terminal state" : undefined,
    };
  }
}
