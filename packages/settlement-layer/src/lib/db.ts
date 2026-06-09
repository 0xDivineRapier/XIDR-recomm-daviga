import pg from "pg";
import { env } from "./env.js";

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function getDb(): pg.Pool {
  if (!pool) {
    pool = new Pool({ connectionString: env.DATABASE_URL });
    pool.on("error", (err) => console.error("[db] idle client error:", err.message));
  }
  return pool;
}

export async function closeDb(): Promise<void> {
  if (pool) { await pool.end(); pool = null; }
}

// ─── Typed row shape (mirrors the `settlements` table) ───────────────────────
export interface SettlementRow {
  id: string;
  rail_id: string;
  reference_id: string;
  amount_idr: number;
  recipient: string;
  status: string;
  rail_name: string;
  created_at: Date;
  updated_at: Date;
}
