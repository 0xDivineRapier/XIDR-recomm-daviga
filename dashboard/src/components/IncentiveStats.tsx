/**
 * IncentiveStats — shows FloatIncentive global stats:
 * total treasury, APY, partner count, pause state.
 */
import React from "react";
import { useIncentiveData } from "../hooks/useIncentiveData";

const card: React.CSSProperties = {
  background: "#1a1a2e",
  border: "1px solid #2d2d4e",
  borderRadius: 12,
  padding: "20px 24px",
};

const label: React.CSSProperties = {
  fontSize: 12,
  color: "#94a3b8",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  marginBottom: 6,
};

const valueStyle: React.CSSProperties = {
  fontSize: 28,
  fontWeight: 700,
  color: "#e2e8f0",
};

export function IncentiveStats() {
  const { data, isLoading, enabled } = useIncentiveData();

  if (!enabled) {
    return (
      <div>
        <h2 style={{ margin: "0 0 16px", fontSize: 18, color: "#94a3b8" }}>Float Incentive</h2>
        <p style={{ color: "#475569" }}>
          Set VITE_FLOAT_INCENTIVE_ADDRESS_SEPOLIA / _MAINNET to enable.
        </p>
      </div>
    );
  }

  if (isLoading) return <p style={{ color: "#64748b" }}>Loading incentive data…</p>;

  const treasuryXidr = data ? Number(data.treasuryBalance).toLocaleString() : "—";
  const partnerCount = data ? data.partnerCount.toString() : "—";
  const apy          = data ? `${data.apyPercent.toFixed(2)}%` : "—";
  const minFloat     = data ? Number(data.minimumFloat).toLocaleString() : "—";

  return (
    <div>
      <h2 style={{ margin: "0 0 16px", fontSize: 18, color: "#94a3b8" }}>
        Float Incentive
        {data?.isPaused && (
          <span style={{ marginLeft: 10, fontSize: 11, color: "#f97316", fontWeight: 600 }}>
            PAUSED
          </span>
        )}
      </h2>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
        <div style={card}>
          <p style={label}>Treasury</p>
          <p style={valueStyle}>{treasuryXidr}</p>
          <p style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>XIDR available</p>
        </div>

        <div style={card}>
          <p style={label}>Current APY</p>
          <p style={{ ...valueStyle, color: "#22c55e" }}>{apy}</p>
          <p style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>For qualifying floats</p>
        </div>

        <div style={card}>
          <p style={label}>Partners</p>
          <p style={valueStyle}>{partnerCount}</p>
          <p style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>Registered wallets</p>
        </div>

        <div style={card}>
          <p style={label}>Min Float</p>
          <p style={{ ...valueStyle, fontSize: 22 }}>{minFloat}</p>
          <p style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>XIDR required</p>
        </div>
      </div>
    </div>
  );
}
