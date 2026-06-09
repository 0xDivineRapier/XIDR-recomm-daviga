import type { RailAdapter, RailCompatibilityEntry } from "./types.js";
import { IdrxRailAdapter } from "./IdrxRailAdapter.js";
import { DigitalRupiahStubAdapter } from "./DigitalRupiahStubAdapter.js";

export type RailName = "idrx" | "digital_rupiah" | "test";

const VALID_RAILS: RailName[] = ["idrx", "digital_rupiah", "test"];

/**
 * Returns the RailAdapter for the given rail name.
 *
 * Rail is chosen at startup via the SETTLEMENT_RAIL env var.
 * All client-facing code calls this factory — never instantiates adapters directly.
 *
 * "test" is an alias for DigitalRupiahStubAdapter so automated tests never
 * need a live DB, RPC, or BI gateway.
 */
export function createAdapter(rail: string): RailAdapter {
  if (!VALID_RAILS.includes(rail as RailName)) {
    throw new Error(
      `Invalid SETTLEMENT_RAIL "${rail}". ` +
      `Valid values: ${VALID_RAILS.join(" | ")}`,
    );
  }
  switch (rail as RailName) {
    case "idrx":           return new IdrxRailAdapter();
    case "digital_rupiah": return new DigitalRupiahStubAdapter();
    case "test":           return new DigitalRupiahStubAdapter();
  }
}

// ─── Compatibility matrix ─────────────────────────────────────────────────────

export const COMPATIBILITY_MATRIX: RailCompatibilityEntry[] = [
  {
    rail: "idrx",
    description: "IDRX stablecoin on Base L2 via Aerodrome / direct ERC-20 transfer",
    features: {
      escrow:           "supported",
      split_settlement: "supported",
      time_lock:        "supported",
      cancel:           "supported",
    },
  },
  {
    rail: "digital_rupiah",
    description:
      "Bank Indonesia Digital Rupiah (e-Rupiah) — stub pending BI Project Garuda public API specification",
    features: {
      escrow:           "pending_spec",
      split_settlement: "pending_spec",
      time_lock:        "pending_spec",
      cancel:           "pending_spec",
    },
  },
];
