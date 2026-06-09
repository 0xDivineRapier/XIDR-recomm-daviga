/**
 * PartnerDashboard — shows the connected wallet's stake status and
 * claimable XIDR yield. Provides a "Claim Yield" button.
 */
import React from "react";
import { useAccount } from "wagmi";
import { usePartnerData } from "../hooks/usePartnerData";

const card: React.CSSProperties = {
  background: "#1a1a2e",
  border: "1px solid #2d2d4e",
  borderRadius: 12,
  padding: "24px",
  maxWidth: 480,
};

const btnBase: React.CSSProperties = {
  display: "inline-block",
  padding: "10px 24px",
  borderRadius: 8,
  border: "none",
  cursor: "pointer",
  fontWeight: 600,
  fontSize: 15,
  transition: "opacity 0.15s",
};

const btnEnabled: React.CSSProperties = {
  ...btnBase,
  background: "#22c55e",
  color: "#0f172a",
};

const btnDisabled: React.CSSProperties = {
  ...btnBase,
  background: "#1e3a2f",
  color: "#475569",
  cursor: "not-allowed",
};

function formatXidr(amount: bigint | undefined): string {
  if (amount === undefined) return "—";
  return Number(amount).toLocaleString("en-US");
}

function formatDate(ts: bigint | undefined): string {
  if (!ts || ts === 0n) return "—";
  return new Date(Number(ts) * 1000).toLocaleString();
}

export function PartnerDashboard() {
  const { address, isConnected } = useAccount();
  const {
    stake,
    claimableYield,
    isLoading,
    isClaiming,
    claimTxHash,
    claimYield,
    isRegistered,
    isActive,
  } = usePartnerData();

  if (!isConnected) {
    return (
      <div style={card}>
        <h2 style={{ margin: "0 0 8px", fontSize: 18, color: "#94a3b8" }}>Your Float Dashboard</h2>
        <p style={{ color: "#64748b" }}>Connect your wallet to view your yield status.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div style={card}>
        <h2 style={{ margin: "0 0 8px", fontSize: 18, color: "#94a3b8" }}>Your Float Dashboard</h2>
        <p style={{ color: "#64748b" }}>Loading…</p>
      </div>
    );
  }

  if (!isRegistered) {
    return (
      <div style={card}>
        <h2 style={{ margin: "0 0 8px", fontSize: 18, color: "#94a3b8" }}>Your Float Dashboard</h2>
        <p style={{ color: "#64748b" }}>
          Wallet <code style={{ fontSize: 12 }}>{address}</code> is not registered as a
          float partner. Contact the XIDR team to register.
        </p>
      </div>
    );
  }

  const canClaim = (claimableYield ?? 0n) > 0n && isActive && !isClaiming;

  return (
    <div style={card}>
      <h2 style={{ margin: "0 0 16px", fontSize: 18, color: "#94a3b8" }}>
        Your Float Dashboard
        {isActive ? (
          <span style={{ marginLeft: 10, fontSize: 11, color: "#22c55e" }}>ACTIVE</span>
        ) : (
          <span style={{ marginLeft: 10, fontSize: 11, color: "#ef4444" }}>DEREGISTERED</span>
        )}
      </h2>

      <table style={{ borderCollapse: "collapse", width: "100%", marginBottom: 20 }}>
        <tbody>
          {[
            ["Wallet",          address?.slice(0, 10) + "…"],
            ["Registered at",   formatDate(stake?.stakedAt)],
            ["Last accrual",    formatDate(stake?.lastClaimAt)],
            ["Accrued (stored)", `${formatXidr(stake?.accruedYield)} XIDR`],
            ["Claimable (live)", `${formatXidr(claimableYield)} XIDR`],
          ].map(([k, v]) => (
            <tr key={k as string}>
              <td style={{ padding: "6px 0", color: "#94a3b8", fontSize: 13, width: "45%" }}>{k}</td>
              <td style={{ padding: "6px 0", color: "#e2e8f0", fontSize: 14, fontWeight: 600 }}>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <button
        style={canClaim ? btnEnabled : btnDisabled}
        disabled={!canClaim}
        onClick={canClaim ? claimYield : undefined}
      >
        {isClaiming ? "Claiming…" : "Claim Yield"}
      </button>

      {claimTxHash && (
        <p style={{ marginTop: 12, fontSize: 12, color: "#64748b" }}>
          Tx: <code>{claimTxHash.slice(0, 18)}…</code>
        </p>
      )}

      {!isActive && (
        <p style={{ marginTop: 12, fontSize: 13, color: "#f97316" }}>
          Your wallet has been deregistered. Unclaimed yield can still be claimed.
        </p>
      )}
    </div>
  );
}
